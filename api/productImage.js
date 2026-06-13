// Server-side product-image extractor. Fetches a product page with a browser
// User-Agent (so sites like Amazon that block the browser's url_context / AI
// scraping will serve the HTML) and pulls the main image from the og:image /
// twitter:image meta tag, or an Amazon images/I/ URL embedded in the page.
// Always returns 200 with { imageUrl } ("" when nothing found) so callers can
// fall back gracefully.
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
    return res.status(200).json({ imageUrl: /^https?:\/\//i.test(img) ? img : '' });
  } catch (err) {
    return res.status(200).json({ imageUrl: '', error: err.message });
  }
}
