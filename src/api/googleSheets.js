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

// Insert a new part row directly under its category header, preserving the
// sheet's layout. Reuses the same color-based parsing (dark row = category
// header) to locate where the category's rows end, then inserts a row there.
// `inheritFromBefore` makes the new row copy the formatting of the row above,
// so it matches the existing part rows. Requires a write-scoped access token.
export async function addPartToCategory(spreadsheetId, sheetName, categoryName, part, accessToken) {
  // 1. Read the grid (with the user's token so private sheets work too) to find
  //    the sheetId and the category's row block.
  const range = encodeURIComponent(sheetName);
  const readUrl = `${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}`;
  const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read sheet (${readRes.status})`);
  const data = await readRes.json();

  const sheet = data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  const rows = sheet?.data?.[0]?.rowData ?? [];
  if (sheetId == null) throw new Error('Sheet tab not found');

  const target = categoryName.trim().toLowerCase();
  let headerRow = -1;
  let lastRowInCategory = -1;
  let inCategory = false;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const first = cells[0];
    const bg = first?.effectiveFormat?.backgroundColor;
    const val = first?.formattedValue?.trim();
    if (!val) continue;
    if (isGrayBackground(bg)) continue;

    if (isDarkBackground(bg)) {
      if (inCategory) break; // hit the next category header → category block ended
      if (val.toLowerCase() === target) { headerRow = i; inCategory = true; lastRowInCategory = i; }
    } else if (inCategory) {
      lastRowInCategory = i; // a part row under this category
    }
  }

  if (headerRow === -1) throw new Error(`Category "${categoryName}" not found in "${sheetName}"`);

  const insertAt = lastRowInCategory + 1; // 0-based row index to insert at

  // 2. Build the values for the new row (cols A–D: name, supplier, part#, price).
  const supplierCell = part.supplierLink
    ? { userEnteredValue: { formulaValue: `=HYPERLINK("${part.supplierLink}","${(part.supplier || '').replace(/"/g, '""')}")` } }
    : { userEnteredValue: { stringValue: part.supplier || '' } };
  const rowValues = [
    { userEnteredValue: { stringValue: part.partName || '' } },
    supplierCell,
    { userEnteredValue: { stringValue: part.partNum || '' } },
    { userEnteredValue: { stringValue: part.price || '' } },
  ];

  const requests = [
    {
      insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: insertAt, endIndex: insertAt + 1 },
        inheritFromBefore: true, // copy formatting from the row above (keeps the layout)
      },
    },
    {
      updateCells: {
        rows: [{ values: rowValues }],
        fields: 'userEnteredValue',
        start: { sheetId, rowIndex: insertAt, columnIndex: 0 },
      },
    },
  ];

  // 3. Apply the write.
  const writeRes = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!writeRes.ok) {
    const t = await writeRes.text();
    throw new Error(`Write failed (${writeRes.status}): ${t.slice(0, 160)}`);
  }
  return true;
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
