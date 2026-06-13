// Server-side product metadata extractor. Fetches a product page with a browser
// User-Agent (so sites like Amazon that block the browser's url_context / AI
// scraping will serve the HTML) and pulls the main image (og:image / twitter:image
// or an Amazon images/I/ URL) and the price (Amazon a-offscreen / priceAmount, or
// og:price / JSON-LD). Always returns 200 with { imageUrl, price } ("" when not
// found) so callers can fall back gracefully.

function extractPrice(html) {
  // Amazon: the buy-box price renders in a `a-offscreen` span (with currency
  // symbol), mirrored by a numeric `priceAmount` in embedded JSON.
  let m = html.match(/class="a-offscreen">\s*([^<]*\d[^<]*)</i);
  if (m) { const p = m[1].trim(); if (p) return p; }
  m = html.match(/"priceAmount"\s*:\s*(\d+(?:\.\d+)?)/);
  if (m) return '$' + m[1];
  // Generic e-commerce: Open Graph / product price meta.
  m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:price:amount|product:price:amount)["'][^>]*>/i);
  if (m) { const c = m[0].match(/content=["']([^"']+)["']/i); if (c) { const v = c[1].trim(); return /^[\d.]+$/.test(v) ? '$' + v : v; } }
  // JSON-LD offers.
  m = html.match(/"price"\s*:\s*"?(\d+(?:\.\d{2}))"?/);
  if (m) return '$' + m[1];
  return '';
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.method === 'POST' ? (req.body || {}) : req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Missing url' });

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
    const html = await r.text();

    let img = '';
    const og = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i);
    if (og) {
      const c = og[0].match(/content=["']([^"']+)["']/i);
      if (c) img = c[1];
    }
    if (!img) {
      const li = html.match(/"(?:hiRes|large|landingImageUrl)"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/i)
        || html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._%-]+\.(?:jpg|jpeg|png)/i);
      if (li) img = li[1] || li[0];
    }
    if (img) img = img.replace(/&amp;/g, '&').trim();
    return res.status(200).json({
      imageUrl: /^https?:\/\//i.test(img) ? img : '',
      price: extractPrice(html),
    });
  } catch (err) {
    return res.status(200).json({ imageUrl: '', price: '', error: err.message });
  }
}
