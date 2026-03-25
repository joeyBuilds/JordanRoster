// Vercel Serverless Function: Sync July.bio roster → Supabase
// Scrapes July, compares against existing creators, auto-adds new + updates existing.
// Called by Vercel cron (daily) and by the frontend Refresh button.

const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');

const ROSTER_URL = 'https://july.bio/iamsocial';
const SUPABASE_URL = 'https://imlmcbnvrkupplvgmytb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltbG1jYm52cmt1cHBsdmdteXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMDQwMDEsImV4cCI6MjA4OTg4MDAwMX0.0QYh-ZibrJy4Sn5yryc2j236qzBdTjvAC300VgOXtxo';

// ── Scraping helpers (shared with scrape-july.js) ──

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

function detectPlatform(context) {
  const lc = (context || '').toLowerCase();
  if (/instagram|insta(?!ll)/i.test(lc)) return 'Instagram';
  if (/tiktok|tik-tok/i.test(lc)) return 'TikTok';
  if (/youtube|yt\b/i.test(lc)) return 'YouTube';
  return null;
}

function extractHandle(url) {
  if (!url) return '';
  try {
    const igMatch = url.match(/instagram\.com\/([^/?#]+)/i);
    if (igMatch && igMatch[1] !== 'p' && igMatch[1] !== 'reel') return igMatch[1];
    const ttMatch = url.match(/tiktok\.com\/@([^/?#]+)/i);
    if (ttMatch) return ttMatch[1];
    if (/vm\.tiktok\.com/i.test(url)) return '';
    const ytHandle = url.match(/youtube\.com\/@([^/?#]+)/i);
    if (ytHandle) return ytHandle[1];
    if (/youtube\.com\/channel\//i.test(url)) return '';
    return '';
  } catch { return ''; }
}

function findCreatorData(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj) && obj.length > 0) {
    const first = obj[0];
    if (first && typeof first === 'object') {
      const keys = Object.keys(first);
      const hasName = keys.some(k => /name|firstName|displayName/i.test(k));
      const hasFollowers = keys.some(k => /follower|platform|social|audience|instagram|tiktok/i.test(k));
      if (hasName && (hasFollowers || obj.length >= 5)) return obj;
    }
  }
  for (const key of Object.keys(obj)) {
    if (/creator|talent|roster|influencer|member/i.test(key)) {
      const result = findCreatorData(obj[key], depth + 1);
      if (result) return result;
    }
  }
  for (const key of Object.keys(obj)) {
    if (!/creator|talent|roster|influencer|member/i.test(key)) {
      const result = findCreatorData(obj[key], depth + 1);
      if (result) return result;
    }
  }
  return null;
}

// ── Audience data helpers ──

function normalizeBreakdown(data) {
  if (!data) return null;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const mapped = data.map(d => {
      const label = d.label || d.name || d.country || d.city || d.range || d.gender || d.key || '';
      const value = d.value ?? d.percentage ?? d.percent ?? d.pct ?? null;
      return { label: String(label), value: value !== null ? parseFloat(value) : 0 };
    }).filter(d => d.label);
    return mapped.length > 0 ? mapped : null;
  }
  if (typeof data === 'object' && !Array.isArray(data)) {
    const mapped = Object.entries(data).map(([label, value]) => ({
      label, value: parseFloat(value || 0)
    })).filter(d => d.label && !isNaN(d.value));
    return mapped.length > 0 ? mapped : null;
  }
  return null;
}

function extractPlatformAudienceData(p) {
  if (!p || typeof p !== 'object') return null;
  const result = {};
  const fieldMap = {
    gender: ['audienceGender', 'audience_gender', 'genderBreakdown', 'genderSplit'],
    age: ['audienceAge', 'audience_age', 'ageBreakdown', 'ageRanges', 'ageSplit'],
    country: ['audienceCountry', 'audience_country', 'countryBreakdown', 'countries', 'geoCountry'],
    city: ['audienceCity', 'audience_city', 'cityBreakdown', 'cities', 'geoCity'],
  };
  for (const [metric, fields] of Object.entries(fieldMap)) {
    for (const field of fields) {
      if (p[field]) {
        const normalized = normalizeBreakdown(p[field]);
        if (normalized && normalized.length > 0) { result[metric] = normalized; break; }
      }
    }
  }
  const stats = {};
  const statFields = {
    views: ['views', 'totalViews', 'total_views'],
    reach: ['reach', 'totalReach', 'total_reach'],
    likes: ['likes', 'totalLikes', 'total_likes'],
    comments: ['comments', 'totalComments', 'total_comments'],
    shares: ['shares', 'totalShares', 'total_shares'],
    saves: ['saves', 'totalSaves', 'total_saves'],
    totalInteractions: ['totalInteractions', 'total_interactions', 'interactions'],
    avgPostLikes: ['avgPostLikes', 'avg_post_likes', 'averageLikes'],
    avgPostComments: ['avgPostComments', 'avg_post_comments', 'averageComments'],
    avgStoryViews: ['avgStoryViews', 'avg_story_views', 'averageStoryViews'],
  };
  for (const [stat, fields] of Object.entries(statFields)) {
    for (const field of fields) {
      if (p[field] != null) {
        stats[stat] = typeof p[field] === 'string' ? parseCount(p[field]) : p[field];
        break;
      }
    }
  }
  if (Object.keys(stats).length > 0) result.stats = stats;
  return Object.keys(result).length > 0 ? result : null;
}

function findPlatformsWithAudience(obj, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj) && obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
    const keys = Object.keys(obj[0]);
    if (keys.some(k => /^platform$/i.test(k)) && keys.some(k => /audience|gender|country|city|ageBr|ageR|geoC/i.test(k)))
      return obj;
  }
  const priorityKeys = [];
  const otherKeys = [];
  for (const key of Object.keys(obj)) {
    (/platform|social|channel|creator|talent|pageProps|props|data/i.test(key) ? priorityKeys : otherKeys).push(key);
  }
  for (const key of [...priorityKeys, ...otherKeys]) {
    const result = findPlatformsWithAudience(obj[key], depth + 1);
    if (result) return result;
  }
  return null;
}

function findSingleCreator(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (!Array.isArray(obj)) {
    const keys = Object.keys(obj);
    if (keys.some(k => /^(name|firstName|displayName)$/i.test(k)) && keys.some(k => /follower|platform|social|audience/i.test(k)))
      return obj;
  }
  for (const key of Object.keys(obj)) {
    const result = findSingleCreator(obj[key], depth + 1);
    if (result) return result;
  }
  return null;
}

function extractAudienceFromHtml($) {
  const result = {};
  const sections = { country: /audience.*country/i, city: /audience.*city/i, age: /audience.*age/i, gender: /audience.*gender/i };
  for (const [metric, pattern] of Object.entries(sections)) {
    $('div, section').each((_, el) => {
      if (result[metric]) return;
      const $el = $(el);
      const heading = $el.find('h2, h3, h4, h5, [class*="heading"], [class*="title"], [class*="Header"]').first().text();
      if (!pattern.test(heading)) return;
      const pairs = [];
      $el.find('[class*="row"], [class*="item"], [class*="bar"], [class*="entry"], tr, li, div').each((_, item) => {
        const text = $(item).text().trim();
        const match = text.match(/^([A-Za-z][A-Za-z .,'-]+?)\s+([\d.]+)\s*%?$/);
        if (match && !pairs.some(p => p.label === match[1].trim())) {
          pairs.push({ label: match[1].trim(), value: parseFloat(match[2]) });
        }
      });
      if (pairs.length > 0) result[metric] = pairs;
    });
  }
  return Object.keys(result).length > 0 ? result : null;
}

// Extract audience data from July's media kit block structure.
// Instagram uses fields.stats.all[], TikTok/YouTube use fields.stats[] directly.
function extractFromMediaKitBlocks(blocks, creatorPlatforms, creatorObj) {
  const PLATFORM_MAP = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
  const STAT_MAP = {
    // Common
    views: 'views', reach: 'reach', likes: 'likes', comments: 'comments',
    shares: 'shares', saves: 'saves', total_interactions: 'totalInteractions',
    average_likes: 'avgPostLikes', average_comments: 'avgPostComments',
    story_views: 'avgStoryViews', engagement_rate: 'engagementRate',
    followers: 'followers',
    // YouTube variants
    subscribers: 'followers', total_views: 'views',
    average_views: 'avgPostViews',
    average_shorts_views: 'avgShortsViews', average_shorts_likes: 'avgShortsLikes',
    // TikTok variants
    average_shares: 'avgPostShares',
  };
  let found = false;

  for (const block of blocks) {
    const platform = PLATFORM_MAP[(block.type || '').toLowerCase()];
    if (!platform || !creatorPlatforms[platform]) continue;

    // Handle both formats: {all: [...]} (IG) and [...] (TT/YT)
    const rawStats = block.fields?.stats;
    const statList = Array.isArray(rawStats) ? rawStats
                   : (rawStats && Array.isArray(rawStats.all)) ? rawStats.all
                   : null;
    if (!statList) continue;

    const result = { stats: {} };

    for (const s of statList) {
      if (!s || typeof s !== 'object') continue;

      // Performance stats (value field)
      if (s.value != null) {
        const mapped = STAT_MAP[s.name];
        if (mapped) {
          result.stats[mapped] = typeof s.value === 'number' ? s.value : parseFloat(s.value);
        }
      }

      // Demographic breakdowns — July stores these in s.data (object {label: count/pct})
      // s.value is null for demographics; the actual data is in s.data
      if (['gender', 'age', 'country', 'city'].includes(s.name) && s.data && typeof s.data === 'object' && !Array.isArray(s.data)) {
        const entries = Object.entries(s.data).filter(([k, v]) => k && v != null && k !== 'U');
        if (entries.length > 0) {
          const total = entries.reduce((sum, [, v]) => sum + v, 0);
          // Convert to percentage if values look like raw counts (sum > 100)
          const asPct = total > 100;
          const breakdown = entries.map(([label, value]) => ({
            label,
            value: asPct ? (value / total) * 100 : value
          })).sort((a, b) => b.value - a.value);
          result[s.name] = breakdown;
        }
      }
      // Also handle array format (legacy/other sources)
      if (['gender', 'age', 'country', 'city'].includes(s.name) && Array.isArray(s.value) && s.value.length > 0) {
        result[s.name] = normalizeBreakdown(s.value);
      }
    }

    if (Object.keys(result.stats).length > 0 || result.gender || result.age || result.country || result.city) {
      if (Object.keys(result.stats).length === 0) delete result.stats;
      creatorPlatforms[platform].audienceData = result;
      found = true;
    }
  }

  // Extract rates and collabs blocks (creator-level, not platform-level)
  if (creatorObj) {
    for (const block of blocks) {
      if (block.type === 'collabs' && Array.isArray(block.collabs)) {
        creatorObj.collabs = block.collabs.map(c => ({
          title: c.title || '', description: c.description || '',
          url: c.url || '', logoUrl: c.logoUrl || '', logoUuid: c.logoUuid || ''
        }));
      }
    }
  }

  return found;
}

async function enrichWithAudienceData(creators) {
  const needsEnrichment = creators.filter(c => c.username && !Object.values(c.platforms || {}).some(p => p.audienceData));
  if (needsEnrichment.length === 0) return;
  console.log(`[sync] Fetching audience data for ${needsEnrichment.length} creators...`);

  function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  const BATCH = 5;
  let enriched = 0;
  for (let i = 0; i < needsEnrichment.length; i += BATCH) {
    const batch = needsEnrichment.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (creator) => {
      try {
        // Detail pages live at /username (NOT /iamsocial/username)
        const resp = await fetchWithTimeout(`https://july.bio/${creator.username}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept': 'text/html' }
        });
        if (!resp.ok) return;
        const html = await resp.text();
        const $d = cheerio.load(html);
        const nextScript = $d('script#__NEXT_DATA__').html();
        if (nextScript) {
          try {
            const nextData = JSON.parse(nextScript);

            // Strategy 1: July media kit blocks (primary path)
            const mk = nextData?.props?.pageProps?.data?.mediaKit?.json?.data;
            if (mk && Array.isArray(mk.blocks)) {
              if (extractFromMediaKitBlocks(mk.blocks, creator.platforms, creator)) {
                enriched++;
                return;
              }
            }

            // Strategy 2: Generic platform array with audience fields
            const platformsData = findPlatformsWithAudience(nextData);
            if (platformsData) {
              let found = false;
              platformsData.forEach(p => {
                const mapped = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' }[(p.platform || '').toLowerCase()];
                if (!mapped || !creator.platforms[mapped]) return;
                const ad = extractPlatformAudienceData(p);
                if (ad) { creator.platforms[mapped].audienceData = ad; found = true; }
              });
              if (found) { enriched++; return; }
            }

            // Strategy 3: Single creator object
            const sc = findSingleCreator(nextData);
            if (sc && Array.isArray(sc.platforms)) {
              let found = false;
              sc.platforms.forEach(p => {
                const mapped = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' }[(p.platform || '').toLowerCase()];
                if (!mapped || !creator.platforms[mapped]) return;
                const ad = extractPlatformAudienceData(p);
                if (ad) { creator.platforms[mapped].audienceData = ad; found = true; }
              });
              if (found) { enriched++; return; }
            }
          } catch { /* skip */ }
        }
        const htmlAud = extractAudienceFromHtml($d);
        if (htmlAud) {
          const primary = Object.keys(creator.platforms).find(p => creator.platforms[p].followers);
          if (primary) { creator.platforms[primary].audienceData = htmlAud; enriched++; }
        }
      } catch { /* skip */ }
    }));
  }
  console.log(`[sync] Enriched ${enriched}/${needsEnrichment.length} creators with audience data`);
}

function normalizeCreator(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name || '';
  if (!name) return null;

  const platforms = {};
  if (Array.isArray(raw.platforms)) {
    raw.platforms.forEach(p => {
      const pName = (p.platform || '').toLowerCase();
      const PLATFORM_MAP = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
      const finalName = PLATFORM_MAP[pName];
      if (!finalName) return;
      const url = p.platformUrl || '';
      const extracted = extractHandle(url);
      const handle = extracted || (pName === 'instagram' ? (raw.username || '') : '');
      const entry = {
        handle, url,
        followers: p.size ?? null,
        engagementRate: p.engagementRate ?? p.engagement_rate ?? p.engagement ?? null
      };
      const audienceData = extractPlatformAudienceData(p);
      if (audienceData) entry.audienceData = audienceData;
      platforms[finalName] = entry;
    });
  }

  const photo = raw.profilePictureUrl || raw.photo || null;
  const rawTags = raw.tags || raw.niches || [];
  const niches = rawTags.filter(t => typeof t === 'string' && t.trim() !== '');

  let location = null;
  if (raw.city) {
    const parts = [raw.city, raw.state].filter(Boolean);
    location = parts.join(', ');
  } else if (raw.location) {
    location = raw.location;
  }

  const lat = raw.lat ?? raw.latitude ?? raw.coordinates?.lat ?? raw.geo?.lat ?? null;
  const lng = raw.lng ?? raw.lon ?? raw.longitude ?? raw.coordinates?.lng ?? raw.coordinates?.lon ?? raw.geo?.lng ?? raw.geo?.lon ?? null;

  return {
    name, photo, platforms, niches, location,
    lat: lat !== null ? parseFloat(lat) : null,
    lng: lng !== null ? parseFloat(lng) : null,
    bio: raw.bio || raw.description || null,
    username: raw.username || null,
    exclusivity: raw.exclusivity || null,
    industries: raw.industries || []
  };
}

async function resolveHandles(creators) {
  const tasks = [];
  creators.forEach(creator => {
    Object.entries(creator.platforms || {}).forEach(([platform, data]) => {
      if (data.handle || !data.url) return;
      if (platform === 'TikTok' && /vm\.tiktok\.com/i.test(data.url)) {
        tasks.push({ creator, platform, data, type: 'redirect' });
      } else if (platform === 'YouTube' && /youtube\.com\/channel\//i.test(data.url)) {
        tasks.push({ creator, platform, data, type: 'youtube-channel' });
      }
    });
  });
  if (tasks.length === 0) return;

  function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  const BATCH = 10;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (task) => {
      try {
        if (task.type === 'redirect') {
          const resp = await fetchWithTimeout(task.data.url, { method: 'HEAD', redirect: 'follow' }, 4000);
          const handle = extractHandle(resp.url);
          if (handle) { task.data.handle = handle; task.data.url = resp.url; }
        } else if (task.type === 'youtube-channel') {
          const resp = await fetchWithTimeout(task.data.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
          }, 5000);
          const html = await resp.text();
          const handleMatch = html.match(/youtube\.com\/@([^"'<\s]+)/i);
          if (handleMatch) task.data.handle = handleMatch[1];
        }
      } catch { /* skip */ }
    }));
  }
}

// ── Scrape July ──

async function scrapeJuly() {
  console.log('[sync] Fetching roster page:', ROSTER_URL);
  const response = await fetch(ROSTER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);

  // Try JSON extraction first
  let creatorsFromJson = null;
  const nextDataScript = $('script#__NEXT_DATA__').html();
  if (nextDataScript) {
    try {
      const nextData = JSON.parse(nextDataScript);
      creatorsFromJson = findCreatorData(nextData);
    } catch { /* fall through */ }
  }

  if (!creatorsFromJson) {
    $('script').each((_, el) => {
      const content = $(el).html() || '';
      if (content.includes('creators') || content.includes('talent') || content.includes('roster')) {
        try {
          const jsonMatch = content.match(/(?:window\.__data__|window\.__INITIAL_STATE__|var\s+\w+\s*=)\s*({[\s\S]+?});?\s*(?:<\/script>|$)/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1]);
            const found = findCreatorData(data);
            if (found && found.length > 0) creatorsFromJson = found;
          }
        } catch { /* skip */ }
      }
    });
  }

  if (creatorsFromJson && creatorsFromJson.length > 0) {
    const creators = creatorsFromJson.map(normalizeCreator).filter(Boolean);
    await resolveHandles(creators);
    await enrichWithAudienceData(creators);
    return creators;
  }

  // Fallback: HTML parsing
  console.log('[sync] No JSON data found, parsing HTML...');
  const creators = [];
  const cardSelectors = [
    '[class*="Card"]', '[class*="card"]', '[class*="Creator"]', '[class*="creator"]',
    '[class*="Talent"]', '[class*="talent"]', '[class*="Roster"] > div > div',
    '[class*="Grid"] > div', '[class*="grid"] > a', 'a[href*="/creator"]',
  ];
  let cards = $([]);
  for (const selector of cardSelectors) {
    const found = $(selector);
    if (found.length > cards.length) cards = found;
  }
  if (cards.length === 0) {
    $('a, div, article').each((_, el) => {
      const $el = $(el);
      const hasImg = $el.find('img').length > 0;
      const text = $el.text();
      if (hasImg && /\d+(\.\d+)?[KMB]/i.test(text) && text.length < 500) cards = cards.add(el);
    });
  }

  cards.each((_, card) => {
    try {
      const $card = $(card);
      const nameEl = $card.find('h2, h3, h4, [class*="name"], [class*="Name"]').first();
      const name = nameEl.length ? nameEl.text().trim() : '';
      if (!name || name.length > 60) return;
      const img = $card.find('img').first();
      const photo = img.attr('src') || img.attr('data-src') || null;
      const platforms = {};
      $card.find('a[href]').each((_, linkEl) => {
        const href = $(linkEl).attr('href') || '';
        let platform = null;
        if (href.includes('instagram.com')) platform = 'Instagram';
        else if (href.includes('tiktok.com')) platform = 'TikTok';
        else if (href.includes('youtube.com')) platform = 'YouTube';
        if (platform) {
          platforms[platform] = { ...(platforms[platform] || {}), handle: extractHandle(href), url: href };
        }
      });
      const niches = [];
      $card.find('[class*="tag"], [class*="Tag"], [class*="chip"], [class*="badge"], [class*="niche"]').each((_, tagEl) => {
        const text = $(tagEl).text().trim();
        if (text && text.length < 40 && !/^\d/.test(text) && !/show.*more/i.test(text)) niches.push(text);
      });
      creators.push({ name, photo, platforms, niches: [...new Set(niches)], location: null, lat: null, lng: null, bio: null });
    } catch { /* skip */ }
  });

  await resolveHandles(creators);
  await enrichWithAudienceData(creators);
  return creators;
}

// ── Supabase sync logic ──

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function parseName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function syncToSupabase(supabase, julyCreators) {
  const now = new Date().toISOString();

  // Load existing creators from Supabase
  const [{ data: existingRows }, { data: existingPlatforms }, { data: existingNiches }] = await Promise.all([
    supabase.from('creators').select('*'),
    supabase.from('creator_platforms').select('*'),
    supabase.from('creator_niches').select('*'),
  ]);

  // Build lookup: lowercase full name → existing creator row (keep newest)
  // Also collect duplicate IDs for cleanup
  const existingByName = {};
  const duplicateIds = [];
  (existingRows || []).forEach(row => {
    const fullName = ((row.first_name || '') + ' ' + (row.last_name || '')).trim().toLowerCase().replace(/\s+/g, ' ');
    if (existingByName[fullName]) {
      // Duplicate found — keep the one with the newer updated_at, queue the other for deletion
      const existing = existingByName[fullName];
      const existingDate = existing.updated_at || existing.created_at || '';
      const newDate = row.updated_at || row.created_at || '';
      if (newDate > existingDate) {
        duplicateIds.push(existing.id);
        existingByName[fullName] = row;
      } else {
        duplicateIds.push(row.id);
      }
    } else {
      existingByName[fullName] = row;
    }
  });

  // Clean up pre-existing duplicates (CASCADE handles related tables)
  if (duplicateIds.length > 0) {
    console.log(`[sync] Removing ${duplicateIds.length} duplicate creator(s):`, duplicateIds);
    await supabase.from('creators').delete().in('id', duplicateIds);
  }

  // Build existing platform map
  const existingPlatformMap = {};
  (existingPlatforms || []).forEach(p => {
    if (!existingPlatformMap[p.creator_id]) existingPlatformMap[p.creator_id] = {};
    existingPlatformMap[p.creator_id][p.platform] = p;
  });

  // Build existing niche map
  const existingNicheMap = {};
  (existingNiches || []).forEach(n => {
    if (!existingNicheMap[n.creator_id]) existingNicheMap[n.creator_id] = new Set();
    existingNicheMap[n.creator_id].add(n.niche);
  });

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const newCreatorRows = [];
  const newPlatformRows = [];
  const newNicheRows = [];
  const newCollabRows = [];
  const updateCreatorRows = [];
  const updatePlatformDeletes = [];
  const updatePlatformInserts = [];
  const updateNicheDeletes = [];
  const updateNicheInserts = [];

  for (const jc of julyCreators) {
    const jName = (jc.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!jName) continue;

    const existing = existingByName[jName];

    if (!existing) {
      // ── New creator ──
      const { firstName, lastName } = parseName(jc.name);
      const id = generateId();

      newCreatorRows.push({
        id,
        first_name: firstName,
        last_name: lastName,
        photo: jc.photo || null,
        location: jc.location || null,
        lat: jc.lat ?? null,
        lng: jc.lng ?? null,
        notes: jc.bio ? `Imported from July · ${jc.bio.substring(0, 200)}` : 'Imported from July',
        created_at: now,
        updated_at: now,
      });

      Object.entries(jc.platforms || {}).forEach(([platform, data]) => {
        newPlatformRows.push({
          creator_id: id,
          platform,
          handle: data.handle || '',
          url: data.url || '',
          followers: data.followers ?? null,
          engagement_rate: data.engagementRate ?? null,
          audience_data: data.audienceData || null,
        });
      });

      (jc.niches || []).forEach(niche => {
        newNicheRows.push({ creator_id: id, niche });
      });

      // Collabs (creator-level)
      (jc.collabs || []).forEach((c, i) => {
        newCollabRows.push({ creator_id: id, title: c.title || '', description: c.description || null, url: c.url || null, logo_url: c.logoUrl || null, logo_uuid: c.logoUuid || '', sort_order: i });
      });

      added++;
    } else {
      // ── Existing creator — check for updates ──
      const creatorId = existing.id;
      let changed = false;

      // Check if photo, location changed
      const updates = {};
      if (jc.photo && jc.photo !== existing.photo) { updates.photo = jc.photo; changed = true; }
      if (jc.location && jc.location !== existing.location) { updates.location = jc.location; changed = true; }
      if (jc.lat != null && jc.lat !== existing.lat) { updates.lat = jc.lat; changed = true; }
      if (jc.lng != null && jc.lng !== existing.lng) { updates.lng = jc.lng; changed = true; }

      // Check platforms for follower/engagement updates
      const existingPlats = existingPlatformMap[creatorId] || {};
      Object.entries(jc.platforms || {}).forEach(([platform, data]) => {
        const ep = existingPlats[platform];
        if (!ep) {
          // New platform for this creator
          updatePlatformInserts.push({
            creator_id: creatorId, platform,
            handle: data.handle || '', url: data.url || '',
            followers: data.followers ?? null,
            engagement_rate: data.engagementRate ?? null,
            audience_data: data.audienceData || null,
          });
          changed = true;
        } else {
          // Check if followers, engagement rate, or audience data changed
          const followersChanged = data.followers != null && data.followers !== ep.followers;
          const engChanged = data.engagementRate != null && data.engagementRate !== ep.engagement_rate;
          const handleChanged = data.handle && data.handle !== ep.handle;
          const audienceChanged = data.audienceData && JSON.stringify(data.audienceData) !== JSON.stringify(ep.audience_data);
          if (followersChanged || engChanged || handleChanged || audienceChanged) {
            updatePlatformDeletes.push(creatorId);
            updatePlatformInserts.push({
              creator_id: creatorId, platform,
              handle: data.handle || ep.handle || '',
              url: data.url || ep.url || '',
              followers: data.followers ?? ep.followers,
              engagement_rate: data.engagementRate ?? ep.engagement_rate,
              audience_data: data.audienceData || ep.audience_data || null,
            });
            changed = true;
          }
        }
      });

      // Check niches
      const existingNicheSet = existingNicheMap[creatorId] || new Set();
      const julyNiches = new Set(jc.niches || []);
      const newNiches = [...julyNiches].filter(n => !existingNicheSet.has(n));
      if (newNiches.length > 0) {
        newNiches.forEach(niche => {
          updateNicheInserts.push({ creator_id: creatorId, niche });
        });
        changed = true;
      }

      if (changed) {
        updates.updated_at = now;
        updateCreatorRows.push({ id: creatorId, ...updates });
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  // ── Execute batched writes ──

  // Insert new creators
  if (newCreatorRows.length > 0) {
    const { error } = await supabase.from('creators').insert(newCreatorRows);
    if (error) console.error('[sync] Failed to insert new creators:', error);
  }
  if (newPlatformRows.length > 0) {
    await supabase.from('creator_platforms').insert(newPlatformRows);
  }
  if (newNicheRows.length > 0) {
    await supabase.from('creator_niches').insert(newNicheRows);
  }
  if (newCollabRows.length > 0) {
    try { await supabase.from('creator_collabs').insert(newCollabRows); } catch (e) { console.warn('[sync] creator_collabs insert:', e.message); }
  }

  // Update existing creators
  for (const row of updateCreatorRows) {
    const { id, ...updates } = row;
    if (Object.keys(updates).length > 0) {
      await supabase.from('creators').update(updates).eq('id', id);
    }
  }

  // Rebuild platforms for updated creators (delete + reinsert affected ones)
  const platformDeleteIds = [...new Set(updatePlatformDeletes)];
  if (platformDeleteIds.length > 0) {
    await supabase.from('creator_platforms').delete().in('creator_id', platformDeleteIds);
    // Re-insert all platforms for these creators (both updated and unchanged ones)
    const reinsertPlatforms = [];
    platformDeleteIds.forEach(cid => {
      // Get all platform data for this creator from the inserts list
      const fromInserts = updatePlatformInserts.filter(p => p.creator_id === cid);
      const fromExisting = Object.values(existingPlatformMap[cid] || {})
        .filter(ep => !fromInserts.some(fi => fi.platform === ep.platform))
        .map(ep => ({
          creator_id: cid, platform: ep.platform,
          handle: ep.handle || '', url: ep.url || '',
          followers: ep.followers, engagement_rate: ep.engagement_rate,
          audience_data: ep.audience_data || null,
        }));
      reinsertPlatforms.push(...fromInserts, ...fromExisting);
    });
    if (reinsertPlatforms.length > 0) {
      await supabase.from('creator_platforms').insert(reinsertPlatforms);
    }
  }

  // Insert new platforms for creators that didn't need full rebuild
  const newPlatformOnlyInserts = updatePlatformInserts.filter(p => !platformDeleteIds.includes(p.creator_id));
  if (newPlatformOnlyInserts.length > 0) {
    await supabase.from('creator_platforms').insert(newPlatformOnlyInserts);
  }

  // Insert new niches
  if (updateNicheInserts.length > 0) {
    await supabase.from('creator_niches').insert(updateNicheInserts);
  }

  // Rebuild rates and collabs for all synced creators (delete + reinsert)
  const allSyncedIds = julyCreators.map(jc => {
    const jName = (jc.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const existing = existingByName[jName];
    return existing ? existing.id : null;
  }).filter(Boolean);
  if (allSyncedIds.length > 0) {
    try { await supabase.from('creator_collabs').delete().in('creator_id', allSyncedIds); } catch {}
    const collabRows = [];
    julyCreators.forEach(jc => {
      const jName = (jc.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const existing = existingByName[jName];
      if (!existing) return;
      const cid = existing.id;
      (jc.collabs || []).forEach((c, i) => collabRows.push({ creator_id: cid, title: c.title || '', description: c.description || null, url: c.url || null, logo_url: c.logoUrl || null, logo_uuid: c.logoUuid || '', sort_order: i }));
    });
    try { if (collabRows.length > 0) await supabase.from('creator_collabs').insert(collabRows); } catch {}
  }

  return { added, updated, unchanged };
}

// ── Handler ──

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    console.log('[sync] Starting July sync...');

    // Step 1: Scrape July
    const julyCreators = await scrapeJuly();
    console.log(`[sync] Scraped ${julyCreators.length} creators from July`);

    if (julyCreators.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No creators found on July — nothing to sync',
        added: 0, updated: 0, unchanged: 0,
        syncedAt: new Date().toISOString()
      });
    }

    // Step 2: Sync to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const result = await syncToSupabase(supabase, julyCreators);

    console.log(`[sync] Done: ${result.added} added, ${result.updated} updated, ${result.unchanged} unchanged`);

    return res.status(200).json({
      success: true,
      ...result,
      total: julyCreators.length,
      syncedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('[sync] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
