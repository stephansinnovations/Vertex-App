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

// Add a new tab (worksheet) to the spreadsheet.
export async function addSheetTab(spreadsheetId, title, accessToken) {
  const res = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: title.trim() } } }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Add tab failed (${res.status}): ${t.slice(0, 160)}`);
  }
  return true;
}

// Add a new category (a dark-background header row) at the end of a tab. Copies
// the format of an existing category header so it matches your layout; if the tab
// has none yet, applies a default black header style so the parser detects it.
export async function addCategory(spreadsheetId, sheetName, categoryName, accessToken) {
  const range = encodeURIComponent(sheetName);
  const readUrl = `${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}`;
  const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read sheet (${readRes.status})`);
  const data = await readRes.json();

  const sheet = data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Sheet tab not found');
  const colCount = sheet?.properties?.gridProperties?.columnCount ?? 26;
  const rows = sheet?.data?.[0]?.rowData ?? [];

  let sampleHeaderRow = -1;
  let lastUsedRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const first = (rows[i].values ?? [])[0];
    const val = first?.formattedValue?.trim();
    if (val) lastUsedRow = i;
    const bg = first?.effectiveFormat?.backgroundColor;
    if (val && sampleHeaderRow === -1 && isDarkBackground(bg) && !isGrayBackground(bg)) {
      sampleHeaderRow = i;
    }
  }

  const insertAt = lastUsedRow + 1;

  const requests = [
    { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: insertAt, endIndex: insertAt + 1 } } },
    {
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { stringValue: categoryName.trim() } }] }],
        fields: 'userEnteredValue',
        start: { sheetId, rowIndex: insertAt, columnIndex: 0 },
      },
    },
  ];

  if (sampleHeaderRow !== -1) {
    requests.push({
      copyPaste: {
        source: { sheetId, startRowIndex: sampleHeaderRow, endRowIndex: sampleHeaderRow + 1, startColumnIndex: 0, endColumnIndex: colCount },
        destination: { sheetId, startRowIndex: insertAt, endRowIndex: insertAt + 1, startColumnIndex: 0, endColumnIndex: colCount },
        pasteType: 'PASTE_FORMAT',
      },
    });
  } else {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: insertAt, endRowIndex: insertAt + 1, startColumnIndex: 0, endColumnIndex: colCount },
        cell: { userEnteredFormat: { backgroundColor: { red: 0, green: 0, blue: 0 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
  }

  const writeRes = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!writeRes.ok) {
    const t = await writeRes.text();
    throw new Error(`Add category failed (${writeRes.status}): ${t.slice(0, 160)}`);
  }
  return true;
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
  const colCount = sheet?.properties?.gridProperties?.columnCount ?? 26;

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
        inheritFromBefore: false, // don't inherit — the row above may be the dark header
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

  // Always give the part row a plain white, non-bold style. The parser detects a
  // part by its row NOT being dark (or gray), so this guarantees it's picked up —
  // no matter where it lands (e.g. directly under a freshly-created dark header).
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: insertAt, endRowIndex: insertAt + 1, startColumnIndex: 0, endColumnIndex: colCount },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, bold: false } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

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

// Delete a part's row from the sheet. Locates the row by part name (and part
// number, when present) within its category, then removes that single row.
export async function deletePartRow(spreadsheetId, sheetName, categoryName, part, accessToken) {
  const range = encodeURIComponent(sheetName);
  const readUrl = `${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}`;
  const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read sheet (${readRes.status})`);
  const data = await readRes.json();

  const sheet = data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Sheet tab not found');
  const rows = sheet?.data?.[0]?.rowData ?? [];

  const targetCat = categoryName.trim().toLowerCase();
  const targetName = (part.partName || '').trim().toLowerCase();
  const targetNum = (part.partNum || '').trim().toLowerCase();
  let inCategory = false;
  let rowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const first = cells[0];
    const bg = first?.effectiveFormat?.backgroundColor;
    const val = first?.formattedValue?.trim();
    if (!val) continue;
    if (isGrayBackground(bg)) continue;

    if (isDarkBackground(bg)) {
      if (inCategory) break; // moved past the category block
      if (val.toLowerCase() === targetCat) inCategory = true;
    } else if (inCategory) {
      const name = val.toLowerCase();
      const num = (cells[2]?.formattedValue?.trim() || '').toLowerCase();
      if (name === targetName && (!targetNum || num === targetNum)) { rowIndex = i; break; }
    }
  }

  if (rowIndex === -1) throw new Error(`Part "${part.partName}" not found in "${categoryName}"`);

  const res = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Delete failed (${res.status}): ${t.slice(0, 160)}`);
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
