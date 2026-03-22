// Vercel Serverless Function: Scrape july.bio/iamsocial roster
// Uses puppeteer-core + @sparticuz/chromium-min for headless Chrome in serverless

const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const ROSTER_URL = 'https://july.bio/iamsocial';

// Platform icon detection — July uses SVG icons or font icons next to follower counts
// Based on the visual layout: Instagram (camera), TikTok (music note), YouTube (play), Facebook (f)
const PLATFORM_PATTERNS = {
  instagram: /instagram|📸/i,
  tiktok: /tiktok|🎵/i,
  youtube: /youtube|▶/i,
  facebook: /facebook/i
};

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });

    const page = await browser.newPage();

    // Block images/fonts/media to speed up scraping (we only need data)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // ── Step 1: Load roster page ──
    await page.goto(ROSTER_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for creator cards to render
    await page.waitForSelector('[class*="card"], [class*="creator"], [class*="roster"]', { timeout: 10000 }).catch(() => {});

    // Expand all creators — click "Show X more" button if it exists
    const expanded = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, [role="button"]')];
      const showMore = buttons.find(b => /show\s+\d+\s+more/i.test(b.textContent));
      if (showMore) {
        showMore.click();
        return true;
      }
      return false;
    });

    if (expanded) {
      // Wait for new cards to load
      await page.waitForTimeout(2000);
    }

    // ── Step 2: Scrape all creator cards from the roster page ──
    const rosterData = await page.evaluate(() => {
      const creators = [];

      // Find all creator card elements
      // July roster pages typically use a grid of cards with images, names, stats, and tags
      const cards = document.querySelectorAll('[class*="Card"], [class*="card"], [class*="creator"]');

      // If no cards found with class-based selectors, try finding by structure
      // (cards with an image + name + follower counts)
      let cardElements = cards.length > 0 ? [...cards] : [];

      if (cardElements.length === 0) {
        // Fallback: find all links/containers that look like creator profile cards
        // Look for containers that have both an image and text with follower-count patterns
        const allLinks = document.querySelectorAll('a[href*="/"]');
        cardElements = [...allLinks].filter(el => {
          const text = el.textContent;
          return /\d+(\.\d+)?[KMB]?\s/i.test(text) && el.querySelector('img');
        });
      }

      cardElements.forEach(card => {
        try {
          // Extract name — usually the most prominent text element
          const nameEl = card.querySelector('h2, h3, h4, [class*="name"], [class*="Name"]') ||
                         card.querySelector('p, span');
          const name = nameEl ? nameEl.textContent.trim() : '';
          if (!name || name.length > 60) return; // skip invalid

          // Extract photo URL
          const img = card.querySelector('img');
          const photo = img ? img.src : null;

          // Extract platform follower counts
          // July shows icons + counts like: 📸 348K 🎵 99K ▶️ 40.7K
          const platforms = {};
          const statText = card.textContent;

          // Find all follower count patterns in the card
          // Look for platform indicators followed by numbers
          const allText = card.innerHTML;

          // Try to find individual stat elements
          const statEls = card.querySelectorAll('[class*="stat"], [class*="Stat"], [class*="follow"], [class*="metric"]');

          if (statEls.length > 0) {
            statEls.forEach(el => {
              const text = el.textContent.trim();
              const parent = el.closest('[class*="platform"], [class*="Platform"]') || el.parentElement;
              const context = (parent ? parent.innerHTML : el.innerHTML).toLowerCase();

              const countMatch = text.match(/([\d,.]+)\s*([KMB])?/i);
              if (!countMatch) return;

              let count = parseFloat(countMatch[1].replace(/,/g, ''));
              const suffix = (countMatch[2] || '').toUpperCase();
              if (suffix === 'K') count *= 1000;
              else if (suffix === 'M') count *= 1000000;
              else if (suffix === 'B') count *= 1000000000;

              // Determine platform from context (SVG path, class names, nearby text)
              if (/instagram|insta/i.test(context) || context.includes('instagram')) {
                platforms.Instagram = { followers: Math.round(count) };
              } else if (/tiktok|tik-tok/i.test(context) || context.includes('tiktok')) {
                platforms.TikTok = { followers: Math.round(count) };
              } else if (/youtube|yt/i.test(context) || context.includes('youtube')) {
                platforms.YouTube = { followers: Math.round(count) };
              } else if (/facebook|fb/i.test(context) || context.includes('facebook')) {
                platforms.Facebook = { followers: Math.round(count) };
              }
            });
          }

          // Fallback: parse the card text for platform icons + numbers
          if (Object.keys(platforms).length === 0) {
            // Look for SVG-based icons by checking aria labels or title attributes
            const svgs = card.querySelectorAll('svg, [class*="icon"], [class*="Icon"]');
            const spans = card.querySelectorAll('span, p');

            spans.forEach(span => {
              const text = span.textContent.trim();
              const countMatch = text.match(/^([\d,.]+)\s*([KMB])?$/i);
              if (!countMatch) return;

              let count = parseFloat(countMatch[1].replace(/,/g, ''));
              const suffix = (countMatch[2] || '').toUpperCase();
              if (suffix === 'K') count *= 1000;
              else if (suffix === 'M') count *= 1000000;
              else if (suffix === 'B') count *= 1000000000;

              // Check previous sibling or parent for platform indicator
              const prev = span.previousElementSibling;
              const parent = span.parentElement;
              const context = ((prev ? prev.outerHTML : '') + ' ' + (parent ? parent.className : '')).toLowerCase();

              if (/instagram|insta/i.test(context)) {
                platforms.Instagram = { followers: Math.round(count) };
              } else if (/tiktok/i.test(context)) {
                platforms.TikTok = { followers: Math.round(count) };
              } else if (/youtube/i.test(context)) {
                platforms.YouTube = { followers: Math.round(count) };
              } else if (/facebook/i.test(context)) {
                platforms.Facebook = { followers: Math.round(count) };
              }
            });
          }

          // Extract niche/category tags
          const tagEls = card.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="chip"], [class*="Chip"], [class*="category"], [class*="badge"]');
          const niches = [...tagEls]
            .map(el => el.textContent.trim())
            .filter(t => t && t.length < 40 && !/^\d/.test(t) && !/show.*more/i.test(t));

          // Extract link to detail page
          const link = card.closest('a')?.href || card.querySelector('a')?.href || null;

          if (name) {
            creators.push({
              name,
              photo,
              platforms,
              niches: [...new Set(niches)],
              detailUrl: link
            });
          }
        } catch (e) {
          // Skip malformed cards
        }
      });

      return creators;
    });

    // ── Step 3: Visit detail pages to get handles, URLs, locations ──
    const enrichedCreators = [];

    for (const creator of rosterData) {
      if (!creator.detailUrl) {
        enrichedCreators.push(creator);
        continue;
      }

      try {
        await page.goto(creator.detailUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        const details = await page.evaluate(() => {
          const result = {
            location: null,
            bio: null,
            totalAudience: null,
            platformDetails: {}
          };

          // Location — usually shown with a pin icon
          const locEl = document.querySelector('[class*="location"], [class*="Location"]');
          if (locEl) {
            result.location = locEl.textContent.replace(/📍|📌|🏠/g, '').trim();
          }
          // Fallback: find text near a map-pin icon
          if (!result.location) {
            const allEls = document.querySelectorAll('span, p, div');
            for (const el of allEls) {
              const text = el.textContent.trim();
              if (text.includes('📍') || (el.previousElementSibling?.innerHTML?.includes('pin') || el.previousElementSibling?.innerHTML?.includes('map'))) {
                result.location = text.replace(/📍|📌/g, '').trim();
                if (result.location) break;
              }
            }
          }

          // Bio text
          const bioEl = document.querySelector('[class*="bio"], [class*="Bio"], [class*="description"], [class*="Description"], [class*="about"]');
          if (bioEl) {
            result.bio = bioEl.textContent.trim().substring(0, 500);
          }

          // Total audience
          const audienceEl = document.querySelector('[class*="audience"], [class*="Audience"], [class*="total"]');
          if (audienceEl) {
            const match = audienceEl.textContent.match(/([\d,]+)/);
            if (match) result.totalAudience = parseInt(match[1].replace(/,/g, ''));
          }

          // Platform handles and URLs — look for @handle patterns and "Go to profile" links
          const allLinks = document.querySelectorAll('a[href]');
          allLinks.forEach(link => {
            const href = link.href;
            const text = link.textContent.trim();

            if (href.includes('instagram.com')) {
              const handleMatch = href.match(/instagram\.com\/([^/?]+)/);
              result.platformDetails.Instagram = {
                handle: handleMatch ? handleMatch[1] : '',
                url: href
              };
            } else if (href.includes('tiktok.com')) {
              const handleMatch = href.match(/tiktok\.com\/@?([^/?]+)/);
              result.platformDetails.TikTok = {
                handle: handleMatch ? handleMatch[1] : '',
                url: href
              };
            } else if (href.includes('youtube.com')) {
              const handleMatch = href.match(/youtube\.com\/@?([^/?]+)/);
              result.platformDetails.YouTube = {
                handle: handleMatch ? handleMatch[1] : '',
                url: href
              };
            } else if (href.includes('facebook.com')) {
              const handleMatch = href.match(/facebook\.com\/([^/?]+)/);
              result.platformDetails.Facebook = {
                handle: handleMatch ? handleMatch[1] : '',
                url: href
              };
            }
          });

          // Also look for @handle text patterns anywhere on the page
          const handleEls = document.querySelectorAll('[class*="handle"], [class*="Handle"], [class*="username"]');
          handleEls.forEach(el => {
            const text = el.textContent.trim();
            if (text.startsWith('@')) {
              // Try to associate with a platform based on nearby context
              const parent = el.closest('[class*="instagram"], [class*="Instagram"], [class*="tiktok"], [class*="TikTok"], [class*="youtube"], [class*="YouTube"]');
              if (parent) {
                const ctx = parent.className.toLowerCase();
                if (ctx.includes('instagram')) result.platformDetails.Instagram = { ...result.platformDetails.Instagram, handle: text.replace('@', '') };
                else if (ctx.includes('tiktok')) result.platformDetails.TikTok = { ...result.platformDetails.TikTok, handle: text.replace('@', '') };
                else if (ctx.includes('youtube')) result.platformDetails.YouTube = { ...result.platformDetails.YouTube, handle: text.replace('@', '') };
              }
            }
          });

          return result;
        });

        // Merge detail data with roster data
        const merged = { ...creator, ...details };

        // Merge platform details (handles/URLs) with follower counts from roster page
        for (const [platform, detailInfo] of Object.entries(details.platformDetails)) {
          merged.platforms[platform] = {
            ...(merged.platforms[platform] || {}),
            ...detailInfo
          };
        }

        enrichedCreators.push(merged);
      } catch (e) {
        // If detail page fails, keep the roster-level data
        enrichedCreators.push(creator);
      }
    }

    await browser.close();

    // Return scraped data
    res.status(200).json({
      success: true,
      scrapedAt: new Date().toISOString(),
      count: enrichedCreators.length,
      creators: enrichedCreators
    });

  } catch (error) {
    if (browser) await browser.close();
    console.error('Scrape error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Vercel config
module.exports.config = {
  maxDuration: 60 // Allow up to 60 seconds for scraping
};
