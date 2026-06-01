export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { spreadsheetId, sheetName } = req.method === 'POST' ? req.body : req.query;
  if (!spreadsheetId || !sheetName) return res.status(400).json({ error: 'Missing spreadsheetId or sheetName' });

  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || 'AIzaSyBXJung0OYr56pqsYmdsxmrOn9wDjhKzhg';

  try {
    const range = encodeURIComponent(`${sheetName}!A1:Z1000`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    const rows = data.values || [];
    if (rows.length === 0) return res.status(200).json({ categories: [] });

    // First row = headers
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const nameIdx = headers.findIndex(h => h.includes('part') && h.includes('name') || h === 'name');
    const partNumIdx = headers.findIndex(h => h.includes('part') && h.includes('num') || h.includes('sku') || h.includes('number'));
    const supplierIdx = headers.findIndex(h => h.includes('supplier') || h.includes('vendor') || h.includes('brand'));
    const linkIdx = headers.findIndex(h => h.includes('link') || h.includes('url'));
    const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('cost'));
    const categoryIdx = headers.findIndex(h => h.includes('category') || h.includes('type') || h.includes('group'));

    // Group rows by category
    const categoryMap = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const partName = nameIdx >= 0 ? (row[nameIdx] || '').trim() : '';
      if (!partName) continue;
      const category = categoryIdx >= 0 ? (row[categoryIdx] || 'General').trim() : 'General';
      if (!categoryMap[category]) categoryMap[category] = [];
      categoryMap[category].push({
        partName,
        partNum: partNumIdx >= 0 ? (row[partNumIdx] || '') : '',
        supplier: supplierIdx >= 0 ? (row[supplierIdx] || '') : '',
        supplierLink: linkIdx >= 0 ? (row[linkIdx] || '') : '',
        price: priceIdx >= 0 ? (row[priceIdx] || '') : '',
      });
    }

    const categories = Object.entries(categoryMap).map(([name, parts]) => ({ name, parts }));
    return res.status(200).json({ categories });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
