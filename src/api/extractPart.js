// AI fill: give Claude a product URL, it fetches the page (server-side web_fetch
// tool) and returns the part fields as JSON. Mirrors the localhost-proxy /
// direct-browser pattern used elsewhere (AIRoom, VertexChat), so in production it
// uses the Anthropic key from Settings rather than the server env var.

const WEB_FETCH_TOOL = { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 };
const WEB_FETCH_BETA = 'web-fetch-2025-09-10';

export async function extractPartFromUrl(link) {
  if (!link || !/^https?:\/\//i.test(link)) {
    throw new Error('Enter a full product URL (https://…) first.');
  }

  const isLocalhost = window.location.hostname === 'localhost';
  const url = isLocalhost ? '/api/claude/v1/messages' : 'https://api.anthropic.com/v1/messages';
  const headers = { 'content-type': 'application/json', 'anthropic-beta': WEB_FETCH_BETA };
  if (!isLocalhost) {
    const { getSetting } = await import('@/api/appSettings');
    const key = (await getSetting('anthropicApiKey')) || localStorage.getItem('anthropicApiKey');
    if (!key) throw new Error('Add your Anthropic API key in Settings to use AI fill.');
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      tools: [WEB_FETCH_TOOL],
      messages: [{
        role: 'user',
        content: `Fetch this product page and extract the part details. Return ONLY a JSON object with keys: partName, supplier, partNum, price (all strings; use "" if unknown). "supplier" is the store/brand selling it. No markdown, no commentary.\nURL: ${link}`,
      }],
    }),
  });
  if (!res.ok) {
    throw new Error(`AI error ${res.status}: ${(await res.text()).slice(0, 140)}`);
  }

  const data = await res.json();
  // The final answer is the last text block (after the web_fetch tool blocks).
  const texts = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
  let raw = (texts[texts.length - 1] || '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('AI returned an unexpected response. Try again or fill manually.');
  }
  return {
    partName: obj.partName || '',
    supplier: obj.supplier || '',
    partNum: obj.partNum || '',
    price: obj.price || '',
  };
}
