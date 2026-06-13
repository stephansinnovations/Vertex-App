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

// ── Amazon helpers ──────────────────────────────────────────────────────────
// Amazon product pages block bots, so Gemini usually can't read the page or pull
// the main image. But every product has an ASIN in its URL, and Amazon exposes a
// public image endpoint keyed by ASIN — so we can build a reliable image URL
// (and label the supplier "Amazon") without scraping.
function isAmazonUrl(u) {
  try { return /(^|\.)amazon\.[a-z.]+$/i.test(new URL(u).hostname); } catch { return false; }
}

function amazonAsin(u) {
  if (!u) return null;
  const m = u.match(/\/(?:dp|gp\/product|gp\/aw\/d|product|gp\/offer-listing)\/([A-Z0-9]{10})(?:[/?]|$)/i)
    || u.match(/[/?&](?:asin|ASIN)=([A-Z0-9]{10})/)
    || u.match(/\/([A-Z0-9]{10})(?:[/?]|$)/); // last-ditch: any 10-char token segment
  return m ? m[1].toUpperCase() : null;
}

// Public, hot-linkable Amazon image for an ASIN (largest available).
function amazonImageFromUrl(u) {
  if (!isAmazonUrl(u)) return '';
  const asin = amazonAsin(u);
  return asin ? `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg` : '';
}

// Ask our serverless endpoint to fetch the product page (with a real browser UA)
// and pull the main image + price. Returns {} on any failure so callers fall
// back. No-op locally (vite has no /api functions) → returns {}.
async function fetchPageMeta(link) {
  if (!link || !/^https?:\/\//i.test(link)) return {};
  try {
    const r = await fetch(`/api/productImage?url=${encodeURIComponent(link)}`);
    if (!r.ok) return {};
    return await r.json(); // { imageUrl, price }
  } catch { return {}; }
}

// Resolve the best image for a product link. For Amazon (which blocks the AI's
// page reads) prefer deterministic sources over the model's guess: the real page
// image (server og:image) → the ASIN image → finally the AI's suggestion. For
// other sites trust the AI first, then the server og:image. `serverImage` lets a
// caller pass an already-fetched value to avoid a second round-trip.
async function resolveImage(link, aiImage, serverImage) {
  const ai = cleanLink(aiImage || '', '');
  const og = serverImage !== undefined ? serverImage : ((await fetchPageMeta(link)).imageUrl || '');
  if (isAmazonUrl(link)) return og || amazonImageFromUrl(link) || ai;
  return ai || og;
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
    ? `partName, supplier, partNum, price, imageUrl, category, subcategory`
    : `partName, supplier, partNum, price, imageUrl`;
  const text = await callGemini({
    contents: [{
      parts: [{
        text: `Read this product page and extract the part details:\n${link}\n`
          + taxBlock
          + `\nReturn ONLY a JSON object with keys: ${keys} `
          + `(all strings; use "" if unknown). "supplier" is the store or brand selling it. `
          + `"imageUrl" is a direct URL to the product's main image (https://… that returns an image); `
          + `use "" if you can't find a real one. `
          + `No markdown, no commentary.`,
      }],
    }],
    tools: [{ url_context: {} }, { google_search: {} }],
    generationConfig: { temperature: 0 },
  });
  const o = parseJson(text);
  const amazon = isAmazonUrl(link);
  // One server fetch gives both the real page image and price — Amazon blocks the
  // AI's read, so for Amazon prefer the server values over the model's guess.
  const meta = await fetchPageMeta(link);
  return {
    partName: o.partName || '',
    supplier: o.supplier || (amazon ? 'Amazon' : ''),
    partNum: o.partNum || '',
    price: amazon ? (meta.price || o.price || '') : (o.price || meta.price || ''),
    imageUrl: await resolveImage(link, o.imageUrl, meta.imageUrl || ''),
    category: o.category || '',
    subcategory: o.subcategory || '',
  };
}

// Find a product image URL for an existing part (used by the backfill). If the
// part already has a supplier link, read that page; otherwise Google-search by
// name/supplier/part#. Returns "" when no real image is found.
export async function findPartImage({ partName, supplier, partNum, supplierLink } = {}) {
  const desc = [partName, supplier, partNum].filter(Boolean).join(' ').trim();
  if (!desc && !supplierLink) return '';
  const rules = `Return ONLY a JSON object {"imageUrl":"..."} with a direct https URL to the product's `
    + `main image (one that returns an actual image). NEVER a redirect/tracking URL `
    + `(no vertexaisearch.cloud.google.com, no grounding-api-redirect, no google.com/url). `
    + `Use "" if you can't find a real one. No markdown, no commentary.`;
  const prompt = supplierLink
    ? `Find the main product image for this item.\nProduct page: ${supplierLink}\nItem: ${desc || '(see page)'}\n${rules}`
    : `Use Google Search to find the main product image for this van-conversion part: ${desc}\n${rules}`;
  const tools = supplierLink ? [{ url_context: {} }, { google_search: {} }] : [{ google_search: {} }];
  const text = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    tools,
    generationConfig: { temperature: 0 },
  });
  let o = {};
  try { o = parseJson(text); } catch { o = {}; }
  if (supplierLink) return resolveImage(supplierLink, o.imageUrl);
  return cleanLink(o.imageUrl || '', '');
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
            + `Return ONLY a JSON object with keys: partName, supplier, partNum, price, supplierLink, imageUrl, "function" `
            + `(all strings; use "" if unknown). "supplier" is the store or brand at supplierLink. `
            + `supplierLink MUST be a real, directly-clickable destination URL to a product or store page — `
            + `NEVER a redirect or tracking URL (no vertexaisearch.cloud.google.com, no grounding-api-redirect, `
            + `no google.com/url links). If you can't find a real product URL, leave supplierLink as "". `
            + `"imageUrl" is a direct URL to a product image (https://… returning an image); use "" if none. `
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
    imageUrl: cleanLink(o.imageUrl || '', ''),
    function: o.function || '',
  };
}
