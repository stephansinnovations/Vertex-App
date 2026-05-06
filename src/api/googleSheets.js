const API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY;
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function isBlackBackground(color) {
  if (!color) return false;
  const r = color.red ?? 0;
  const g = color.green ?? 0;
  const b = color.blue ?? 0;
  return r < 0.2 && g < 0.2 && b < 0.2;
}

function isDarkBackground(color) {
  if (!color) return false;
  const r = color.red ?? 0;
  const g = color.green ?? 0;
  const b = color.blue ?? 0;
  return (r * 0.299 + g * 0.587 + b * 0.114) < 0.3;
}

function isGrayBackground(color) {
  if (!color) return false;
  const r = color.red ?? 0;
  const g = color.green ?? 0;
  const b = color.blue ?? 0;
  const luminance = r * 0.299 + g * 0.587 + b * 0.114;
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  // Gray: channels are close to each other, and not white (>0.95) or black (<0.2)
  return maxDiff < 0.1 && luminance > 0.2 && luminance < 0.95;
}

export async function getSheetTabs(spreadsheetId) {
  const res = await fetch(`${BASE}/${spreadsheetId}?key=${API_KEY}`);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  const data = await res.json();
  const tabs = data.sheets.map(s => s.properties.title);
  return { data: { tabs } };
}

export async function getSheetCategories(spreadsheetId, sheetName) {
  const range = encodeURIComponent(sheetName);
  const url = `${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  const data = await res.json();

  const sheet = data.sheets?.[0];
  const rows = sheet?.data?.[0]?.rowData ?? [];

  const categories = [];
  let current = null;

  for (const row of rows) {
    const cells = row.values ?? [];
    if (!cells.length) continue;

    const firstCell = cells[0];
    const bg = firstCell?.effectiveFormat?.backgroundColor;
    const cellValue = firstCell?.formattedValue?.trim();

    if (!cellValue) continue;

    if (isGrayBackground(bg)) continue;

    if (isDarkBackground(bg)) {
      current = { name: cellValue, parts: [] };
      categories.push(current);
    } else if (current) {
      // This row is a part under the current category
      const get = (i) => cells[i]?.formattedValue?.trim() ?? '';
      const hyperlink = cells[1]?.hyperlink ?? null;
      current.parts.push({
        partName: get(0),
        supplier: get(1),
        supplierLink: hyperlink,
        partNum: get(2),
        price: get(3),
      });
    }
  }

  return { data: { categories } };
}
