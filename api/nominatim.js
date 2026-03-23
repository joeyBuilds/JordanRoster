// Vercel serverless proxy for Nominatim — avoids CORS issues from browser
export default async function handler(req, res) {
  const { endpoint, ...params } = req.query;

  // Only allow 'search' and 'reverse' endpoints
  if (endpoint !== 'search' && endpoint !== 'reverse') {
    return res.status(400).json({ error: 'Invalid endpoint. Use "search" or "reverse".' });
  }

  // Build Nominatim URL
  const qs = new URLSearchParams(params).toString();
  const url = `https://nominatim.openstreetmap.org/${endpoint}?${qs}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CreatorRoster/1.0 (https://creator-roster.vercel.app)',
        'Accept-Language': 'en'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Nominatim returned ${response.status}` });
    }

    const data = await response.json();

    // Cache for 1 hour
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reach Nominatim', detail: err.message });
  }
}
