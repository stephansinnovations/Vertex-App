export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { spreadsheetId } = req.method === 'POST' ? req.body : req.query;
  if (!spreadsheetId) return res.status(400).json({ error: 'Missing spreadsheetId' });

  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || 'AIzaSyBXJung0OYr56pqsYmdsxmrOn9wDjhKzhg';

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title&key=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    const tabs = (data.sheets || []).map(s => s.properties.title);
    return res.status(200).json({ tabs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
