// Gemini-powered parts intelligence: identify a part from a photo (vision +
// Google Search grounding to find a buy link) and extract part fields from a
// product URL (URL-context tool). Calls Gemini directly from the browser with the
// key from Settings — no proxy / server env var needed. Same key as GeminiScanner.

const MODEL = 'gemini-2.5-flash';
const endpoint = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

async function getGeminiKey() {
  const { getSetting } = await import('@/api/appSettings');
  const key = (await getSetting('geminiApiKey')) || localStorage.getItem('geminiApiKey');
  if (!key) throw new Error('Add your Gemini API key in Settings to use AI.');
  return key;
}

// Google Search grounding cites redirect URLs (vertexaisearch.cloud.google.com/
// grounding-api-redirect/…) that expire and don't reliably open. If the model
// returns one (or nothing), fall back to a durable Google search URL for the part.
function cleanLink(link, query) {
  const bad = !link
    || /vertexaisearch\.cloud\.google\.com|grounding-api-redirect|google\.com\/url\?/i.test(link)
    || !/^https?:\/\//i.test(link);
  if (bad) {
    const q = (query || '').trim();
    return q ? `https://www.google.com/search?q=${encodeURIComponent(q + ' buy')}` : '';
  }
  return link;
}

function parseJson(text) {
  let raw = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s !== -1 && e !== -1) raw = raw.slice(s, e + 1);
  return JSON.parse(raw);
}

async function callGemini(body) {
  const key = await getGeminiKey();
  const res = await fetch(endpoint(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text).filter(Boolean).join('');
}

// Read a product URL and extract the part fields. When `taxonomy` is provided
// ({ "Category": ["Subcategory", …] }), Gemini also guesses the best-matching
// category + subcategory in the Parts Library so the Add Part flow can preselect.
export async function extractPartFromUrl(link, taxonomy = null) {
  if (!link || !/^https?:\/\//i.test(link)) {
    throw new Error('Enter a full product URL (https://…) first.');
  }
  const hasTax = taxonomy && Object.keys(taxonomy).length > 0;
  const taxBlock = hasTax
    ? `\n\nThe Parts Library is organized as Category → Subcategory:\n${JSON.stringify(taxonomy)}\n`
      + `Pick the single best-matching existing "category" and "subcategory" for this part. `
      + `The subcategory MUST belong to the category you chose. If nothing fits, use "".`
    : '';
  const keys = hasTax
    ? `partName, supplier, partNum, price, category, subcategory`
    : `partName, supplier, partNum, price`;
  const text = await callGemini({
    contents: [{
      parts: [{
        text: `Read this product page and extract the part details:\n${link}\n`
          + taxBlock
          + `\nReturn ONLY a JSON object with keys: ${keys} `
          + `(all strings; use "" if unknown). "supplier" is the store or brand selling it. `
          + `No markdown, no commentary.`,
      }],
    }],
    tools: [{ url_context: {} }, { google_search: {} }],
    generationConfig: { temperature: 0 },
  });
  const o = parseJson(text);
  return {
    partName: o.partName || '',
    supplier: o.supplier || '',
    partNum: o.partNum || '',
    price: o.price || '',
    category: o.category || '',
    subcategory: o.subcategory || '',
  };
}

// Identify a part from a photo, determine its function, and find a buy link.
export async function identifyPartFromImage(base64, mimeType = 'image/jpeg') {
  const text = await callGemini({
    contents: [{
      parts: [
        {
          text: `You are a parts identification assistant for a van conversion shop. `
            + `Identify the part in this image, determine its function, and use Google Search to `
            + `find a real product page where it can be purchased. `
            + `Return ONLY a JSON object with keys: partName, supplier, partNum, price, supplierLink, "function" `
            + `(all strings; use "" if unknown). "supplier" is the store or brand at supplierLink. `
            + `supplierLink MUST be a real, directly-clickable destination URL to a product or store page — `
            + `NEVER a redirect or tracking URL (no vertexaisearch.cloud.google.com, no grounding-api-redirect, `
            + `no google.com/url links). If you can't find a real product URL, leave supplierLink as "". `
            + `No markdown, no commentary.`,
        },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.2 },
  });
  const o = parseJson(text);
  const partName = o.partName || '';
  return {
    partName,
    supplier: o.supplier || '',
    partNum: o.partNum || '',
    price: o.price || '',
    supplierLink: cleanLink(o.supplierLink || '', [partName, o.supplier].filter(Boolean).join(' ')),
    function: o.function || '',
  };
}
