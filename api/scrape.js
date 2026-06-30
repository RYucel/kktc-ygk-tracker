export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const targetUrl = 'https://basimevi.gov.ct.tr/';
    
    // Fetch target URL with browser-like headers
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      // Set a reasonable timeout (10 seconds)
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Basımevi website responded with status: ${response.status}`);
    }

    // Get raw response buffer to properly handle encoding.
    // KKTC Basımevi website is historically encoded in ISO-8859-9 (latin5) or Windows-1254.
    const buffer = await response.arrayBuffer();
    
    // We decode using utf-8 as the target page content-type specifies UTF-8.
    const decoder = new TextDecoder('utf-8');
    const html = decoder.decode(buffer);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ error: error.message });
  }
}
