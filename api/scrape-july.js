// Vercel Serverless Function: Scrape july.bio/iamsocial roster
// Uses shared helpers from july-helpers.js for all scraping logic.

const { scrapeRoster, downloadCreatorPhotos } = require('./july-helpers');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { source, creators } = await scrapeRoster({ logPrefix: '[scraper]' });

    // Download photos as base64 so they don't expire (signed URLs are time-limited)
    await downloadCreatorPhotos(creators, { logPrefix: '[scraper]' });

    return res.status(200).json({
      success: true,
      source,
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
