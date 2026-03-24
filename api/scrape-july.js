// Vercel Serverless Function: Scrape july.bio/iamsocial roster
// Uses fetch + cheerio — no headless browser needed

const cheerio = require('cheerio');

const ROSTER_URL = 'https://july.bio/iamsocial';

// Parse follower count strings like "348K", "1.2M", "99.5K", "40,700"
function parseCount(text) {
  if (!text) return null;
  const clean = text.replace(/,/g, '').trim();
  const match = clean.match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return null;
  let num = parseFloat(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  if (suffix === 'K') num *= 1000;
  else if (suffix === 'M') num *= 1000000;
  else if (suffix === 'B') num *= 1000000000;
  return Math.round(num);
}

// Detect platform from class names, SVG content, or text context
function detectPlatform(context) {
  const lc = (context || '').toLowerCase();
  if (/instagram|insta(?!ll)/i.test(lc)) return 'Instagram';
  if (/tiktok|tik-tok/i.test(lc)) return 'TikTok';
  if (/youtube|yt\b/i.test(lc)) return 'YouTube';
  return null;
}

// Extract platform handle from a URL
function extractHandle(url) {
  if (!url) return '';
  try {
    // Instagram: instagram.com/username
    const igMatch = url.match(/instagram\.com\/([^/?#]+)/i);
    if (igMatch && igMatch[1] !== 'p' && igMatch[1] !== 'reel') return igMatch[1];

    // TikTok: tiktok.com/@username (skip vm.tiktok.com short links)
    const ttMatch = url.match(/tiktok\.com\/@([^/?#]+)/i);
    if (ttMatch) return ttMatch[1];
    // vm.tiktok.com/CODE — no handle extractable, return empty
    if (/vm\.tiktok\.com/i.test(url)) return '';

    // YouTube: youtube.com/@handle (skip /channel/ID URLs)
    const ytHandle = url.match(/youtube\.com\/@([^/?#]+)/i);
    if (ytHandle) return ytHandle[1];
    // youtube.com/channel/UCXYZ — no human handle, return empty
    if (/youtube\.com\/channel\//i.test(url)) return '';

    return '';
  } catch {
    return '';
  }
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── Step 1: Fetch the roster page HTML ──
    console.log('[scraper] Fetching roster page:', ROSTER_URL);
    const response = await fetch(ROSTER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch roster page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    console.log('[scraper] Got HTML, length:', html.length);

    const $ = cheerio.load(html);

    // ── Step 2: Try to extract data from __NEXT_DATA__ (Next.js SSR) ──
    // Many modern platforms use Next.js, which embeds page data as JSON
    let creatorsFromJson = null;

    const nextDataScript = $('script#__NEXT_DATA__').html();
    if (nextDataScript) {
      console.log('[scraper] Found __NEXT_DATA__, parsing JSON...');
      try {
        const nextData = JSON.parse(nextDataScript);
        // Navigate through Next.js data structure to find creator data
        // The exact path varies by app, so we search recursively
        creatorsFromJson = findCreatorData(nextData);
        if (creatorsFromJson) {
          console.log('[scraper] Extracted', creatorsFromJson.length, 'creators from JSON');
        }
      } catch (e) {
        console.log('[scraper] Failed to parse __NEXT_DATA__:', e.message);
      }
    }

    // Also check for other embedded JSON data patterns
    if (!creatorsFromJson) {
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        // Look for JSON data containing creator-like objects
        if (content.includes('creators') || content.includes('talent') || content.includes('roster')) {
          try {
            // Try to extract JSON from various patterns
            const jsonMatch = content.match(/(?:window\.__data__|window\.__INITIAL_STATE__|var\s+\w+\s*=)\s*({[\s\S]+?});?\s*(?:<\/script>|$)/);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[1]);
              const found = findCreatorData(data);
              if (found && found.length > 0) {
                creatorsFromJson = found;
              }
            }
          } catch { /* skip */ }
        }
      });
    }

    // ── Debug mode: return raw data structure for inspection ──
    const debugMode = req.query.debug === '1';
    if (debugMode && creatorsFromJson && creatorsFromJson.length > 0) {
      // Return first 2 raw creator objects so we can see the actual field names
      const sample = creatorsFromJson.slice(0, 2);
      return res.status(200).json({
        debug: true,
        totalFound: creatorsFromJson.length,
        sampleKeys: Object.keys(creatorsFromJson[0]),
        rawSample: sample
      });
    }

    // ── Step 3: If JSON extraction worked, use that data ──
    if (creatorsFromJson && creatorsFromJson.length > 0) {
      const creators = creatorsFromJson.map(normalizeCreator).filter(Boolean);
      console.log('[scraper] Normalized', creators.length, 'creators from JSON data');

      // Resolve missing handles (TikTok short links, YouTube channel URLs)
      await resolveHandles(creators);

      return res.status(200).json({
        success: true,
        source: 'json',
        scrapedAt: new Date().toISOString(),
        count: creators.length,
        creators
      });
    }

    // ── Step 4: Fall back to HTML parsing with cheerio ──
    console.log('[scraper] No JSON data found, parsing HTML...');
    const creators = [];

    // Try multiple selector strategies for creator cards
    const cardSelectors = [
      '[class*="Card"]', '[class*="card"]',
      '[class*="Creator"]', '[class*="creator"]',
      '[class*="Talent"]', '[class*="talent"]',
      '[class*="Roster"] > div > div', '[class*="roster"] > div > div',
      '[class*="Grid"] > div', '[class*="grid"] > a',
      'a[href*="/creator"]', 'a[href*="/talent"]',
    ];

    let cards = $([]);
    for (const selector of cardSelectors) {
      const found = $(selector);
      if (found.length > cards.length) {
        cards = found;
      }
    }

    // If no cards found by class, try to detect by structure
    // (elements containing both an image and text with numbers)
    if (cards.length === 0) {
      console.log('[scraper] No cards found by class, trying structural detection...');
      $('a, div, article').each((_, el) => {
        const $el = $(el);
        const hasImg = $el.find('img').length > 0;
        const text = $el.text();
        const hasNumbers = /\d+(\.\d+)?[KMB]/i.test(text);
        if (hasImg && hasNumbers && text.length < 500) {
          cards = cards.add(el);
        }
      });
    }

    console.log('[scraper] Found', cards.length, 'potential card elements');

    cards.each((_, card) => {
      try {
        const $card = $(card);

        // Extract name
        const nameEl = $card.find('h2, h3, h4, [class*="name"], [class*="Name"]').first();
        const name = nameEl.length ? nameEl.text().trim() : '';
        if (!name || name.length > 60) return;

        // Extract photo
        const img = $card.find('img').first();
        const photo = img.attr('src') || img.attr('data-src') || null;

        // Extract platforms and follower counts
        const platforms = {};

        // Strategy 1: Find stat elements with platform context
        $card.find('[class*="stat"], [class*="Stat"], [class*="follow"], [class*="metric"], [class*="platform"], [class*="Platform"]').each((_, statEl) => {
          const $stat = $(statEl);
          const text = $stat.text().trim();
          const parentHtml = ($stat.parent().html() || '').toLowerCase();
          const classNames = ($stat.attr('class') || '') + ' ' + ($stat.parent().attr('class') || '');

          const count = parseCount(text);
          if (count === null) return;

          const platform = detectPlatform(classNames + ' ' + parentHtml);
          if (platform) {
            platforms[platform] = { followers: count, handle: '', url: '' };
          }
        });

        // Strategy 2: Find platform links
        $card.find('a[href]').each((_, linkEl) => {
          const href = $(linkEl).attr('href') || '';
          let platform = null;
          if (href.includes('instagram.com')) platform = 'Instagram';
          else if (href.includes('tiktok.com')) platform = 'TikTok';
          else if (href.includes('youtube.com')) platform = 'YouTube';

          if (platform) {
            platforms[platform] = {
              ...(platforms[platform] || {}),
              handle: extractHandle(href),
              url: href
            };
          }
        });

        // Extract niches/tags
        const niches = [];
        $card.find('[class*="tag"], [class*="Tag"], [class*="chip"], [class*="Chip"], [class*="category"], [class*="badge"], [class*="niche"]').each((_, tagEl) => {
          const text = $(tagEl).text().trim();
          if (text && text.length < 40 && !/^\d/.test(text) && !/show.*more/i.test(text)) {
            niches.push(text);
          }
        });

        // Extract detail link
        const detailLink = $card.is('a') ? $card.attr('href') : $card.find('a').first().attr('href');
        let detailUrl = null;
        if (detailLink) {
          detailUrl = detailLink.startsWith('http') ? detailLink : `https://july.bio${detailLink}`;
        }

        creators.push({
          name,
          photo,
          platforms,
          niches: [...new Set(niches)],
          detailUrl
        });
      } catch (e) {
        // Skip malformed cards
      }
    });

    // ── Step 5: Enrich with detail pages (fetch up to 10 concurrently) ──
    const creatorsWithDetails = creators.filter(c => c.detailUrl);
    if (creatorsWithDetails.length > 0) {
      console.log('[scraper] Enriching', creatorsWithDetails.length, 'creators from detail pages...');

      const batchSize = 10;
      for (let i = 0; i < creatorsWithDetails.length; i += batchSize) {
        const batch = creatorsWithDetails.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(async (creator) => {
          try {
            const detailResp = await fetch(creator.detailUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml'
              }
            });
            if (!detailResp.ok) return;

            const detailHtml = await detailResp.text();
            const $d = cheerio.load(detailHtml);

            // Try __NEXT_DATA__ on detail page too
            const detailNextData = $d('script#__NEXT_DATA__').html();
            if (detailNextData) {
              try {
                const dnd = JSON.parse(detailNextData);
                const creatorDetail = findSingleCreator(dnd);
                if (creatorDetail) {
                  Object.assign(creator, normalizeDetailData(creatorDetail, creator));
                  return;
                }
              } catch { /* fall through to HTML parsing */ }
            }

            // Location
            const locEl = $d('[class*="location"], [class*="Location"]').first();
            if (locEl.length) {
              creator.location = locEl.text().replace(/📍|📌|🏠/g, '').trim();
            }

            // Bio
            const bioEl = $d('[class*="bio"], [class*="Bio"], [class*="description"], [class*="about"]').first();
            if (bioEl.length) {
              creator.bio = bioEl.text().trim().substring(0, 500);
            }

            // Platform links on detail page
            $d('a[href]').each((_, linkEl) => {
              const href = $d(linkEl).attr('href') || '';
              let platform = null;
              if (href.includes('instagram.com')) platform = 'Instagram';
              else if (href.includes('tiktok.com')) platform = 'TikTok';
              else if (href.includes('youtube.com')) platform = 'YouTube';

              if (platform) {
                creator.platforms[platform] = {
                  ...(creator.platforms[platform] || {}),
                  handle: extractHandle(href),
                  url: href
                };
              }
            });
          } catch (e) {
            // Keep roster-level data on failure
          }
        }));
      }
    }

    // Resolve missing handles (TikTok short links, YouTube channel URLs)
    await resolveHandles(creators);

    console.log('[scraper] Returning', creators.length, 'creators from HTML parsing');
    return res.status(200).json({
      success: true,
      source: 'html',
      scrapedAt: new Date().toISOString(),
      count: creators.length,
      creators
    });

  } catch (error) {
    console.error('[scraper] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ── Helpers for finding creator data in nested JSON structures ──

function findCreatorData(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  // Check if this is an array of creator-like objects
  if (Array.isArray(obj) && obj.length > 0) {
    const first = obj[0];
    if (first && typeof first === 'object') {
      const keys = Object.keys(first);
      const hasName = keys.some(k => /name|firstName|displayName/i.test(k));
      const hasFollowers = keys.some(k => /follower|platform|social|audience|instagram|tiktok/i.test(k));
      if (hasName && (hasFollowers || obj.length >= 5)) {
        return obj;
      }
    }
  }

  // Recurse into object properties
  for (const key of Object.keys(obj)) {
    // Prioritize keys that sound like creator collections
    if (/creator|talent|roster|influencer|member/i.test(key)) {
      const result = findCreatorData(obj[key], depth + 1);
      if (result) return result;
    }
  }

  // Then check all other keys
  for (const key of Object.keys(obj)) {
    if (!/creator|talent|roster|influencer|member/i.test(key)) {
      const result = findCreatorData(obj[key], depth + 1);
      if (result) return result;
    }
  }

  return null;
}

function findSingleCreator(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  if (!Array.isArray(obj)) {
    const keys = Object.keys(obj);
    const hasName = keys.some(k => /^(name|firstName|displayName)$/i.test(k));
    const hasFollowers = keys.some(k => /follower|platform|social|audience/i.test(k));
    if (hasName && hasFollowers) return obj;
  }

  for (const key of Object.keys(obj)) {
    const result = findSingleCreator(obj[key], depth + 1);
    if (result) return result;
  }
  return null;
}

function normalizeCreator(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = raw.name || '';
  if (!name) return null;

  // ── Platforms ──
  // July structure: platforms is an array of {platform, size, engagementRate, platformUrl}
  const platforms = {};
  if (Array.isArray(raw.platforms)) {
    raw.platforms.forEach(p => {
      const pName = (p.platform || '').toLowerCase();
      const PLATFORM_MAP = {
        instagram: 'Instagram',
        tiktok: 'TikTok',
        youtube: 'YouTube'
      };
      const finalName = PLATFORM_MAP[pName];
      if (!finalName) return;

      const url = p.platformUrl || '';
      const extracted = extractHandle(url);
      // Only fall back to July's username field for Instagram (it's their IG handle)
      const handle = extracted || (pName === 'instagram' ? (raw.username || '') : '');
      platforms[finalName] = {
        handle,
        url,
        followers: p.size ?? null,
        engagementRate: p.engagementRate ?? p.engagement_rate ?? p.engagement ?? null
      };
    });
  }

  // ── Photo ──
  const photo = raw.profilePictureUrl || raw.photo || null;

  // ── Niches / Tags ──
  // July's tags array sometimes has an empty string as first element — filter it out
  const rawTags = raw.tags || raw.niches || [];
  const niches = rawTags.filter(t => typeof t === 'string' && t.trim() !== '');

  // ── Location ──
  // July splits into city, state, country
  let location = null;
  if (raw.city) {
    const parts = [raw.city, raw.state].filter(Boolean);
    location = parts.join(', ');
  } else if (raw.location) {
    location = raw.location;
  }

  // ── Coordinates ──
  // Pass through any lat/lng July provides so we don't need to re-geocode
  const lat = raw.lat ?? raw.latitude ?? raw.coordinates?.lat ?? raw.geo?.lat ?? null;
  const lng = raw.lng ?? raw.lon ?? raw.longitude ?? raw.coordinates?.lng ?? raw.coordinates?.lon ?? raw.geo?.lng ?? raw.geo?.lon ?? null;

  return {
    name,
    photo,
    platforms,
    niches,
    location,
    lat: lat !== null ? parseFloat(lat) : null,
    lng: lng !== null ? parseFloat(lng) : null,
    bio: raw.bio || raw.description || null,
    detailUrl: null, // roster page has all the data we need
    username: raw.username || null,
    exclusivity: raw.exclusivity || null,
    industries: raw.industries || []
  };
}

function normalizeDetailData(raw, existing) {
  const result = {};
  if (raw.location || raw.city) result.location = raw.location || raw.city;
  if (raw.bio || raw.description) result.bio = (raw.bio || raw.description || '').substring(0, 500);

  // Merge platform data from detail page
  const detailPlatforms = normalizeCreator(raw)?.platforms || {};
  for (const [platform, data] of Object.entries(detailPlatforms)) {
    existing.platforms[platform] = {
      ...(existing.platforms[platform] || {}),
      ...data
    };
  }

  return result;
}

// ── Resolve missing handles by following redirect URLs ──
// TikTok short links (vm.tiktok.com/CODE) redirect to tiktok.com/@handle
// YouTube channel URLs (youtube.com/channel/ID) → try to find @handle from page

async function resolveHandles(creators) {
  // Collect all platform entries that need resolution
  const tasks = [];
  creators.forEach(creator => {
    Object.entries(creator.platforms || {}).forEach(([platform, data]) => {
      if (data.handle) return; // already have a handle
      if (!data.url) return;  // no URL to resolve

      if (platform === 'TikTok' && /vm\.tiktok\.com/i.test(data.url)) {
        tasks.push({ creator, platform, data, type: 'redirect' });
      } else if (platform === 'YouTube' && /youtube\.com\/channel\//i.test(data.url)) {
        tasks.push({ creator, platform, data, type: 'youtube-channel' });
      }
    });
  });

  if (tasks.length === 0) return;
  console.log(`[scraper] Resolving ${tasks.length} platform handles...`);

  // Helper: fetch with a per-request timeout (AbortController)
  function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  // Process in batches of 10 with per-request timeouts to stay within Vercel limits
  const BATCH = 10;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (task) => {
      try {
        if (task.type === 'redirect') {
          // Follow redirect to get final URL (TikTok short links → tiktok.com/@handle)
          const resp = await fetchWithTimeout(task.data.url, { method: 'HEAD', redirect: 'follow' }, 4000);
          const finalUrl = resp.url;
          const handle = extractHandle(finalUrl);
          if (handle) {
            task.data.handle = handle;
            task.data.url = finalUrl; // update to canonical URL
          }
        } else if (task.type === 'youtube-channel') {
          // Fetch YouTube channel page and look for @handle in the HTML
          const resp = await fetchWithTimeout(task.data.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
          }, 5000);
          const html = await resp.text();
          // YouTube embeds the canonical @handle URL in the page
          const handleMatch = html.match(/youtube\.com\/@([^"'<\s]+)/i);
          if (handleMatch) {
            task.data.handle = handleMatch[1];
          }
        }
      } catch (e) {
        // Skip failed/timed-out resolutions silently
      }
    }));
  }

  const resolved = tasks.filter(t => t.data.handle).length;
  console.log(`[scraper] Resolved ${resolved}/${tasks.length} handles`);
}
