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

// Pull a usable image URL out of a cell. Supports an =IMAGE("url") formula
// (how we write pictures so they render in the sheet), a hyperlink, or a plain URL.
function extractImageUrl(cell) {
  if (!cell) return null;
  const formula = cell.userEnteredValue?.formulaValue || cell.effectiveValue?.formulaValue;
  if (formula) {
    const m = String(formula).match(/=image\(\s*"([^"]+)"/i);
    if (m) return m[1];
  }
  if (cell.hyperlink) return cell.hyperlink;
  const v = cell.formattedValue?.trim();
  if (v && /^https?:\/\//i.test(v)) return v;
  return null;
}

// Build the picture cell for a part row: an =IMAGE() formula so the sheet shows
// the thumbnail, or an empty cell when there's no image.
function imageCellFor(imageUrl) {
  const url = (imageUrl || '').trim().replace(/"/g, '');
  return url
    ? { userEnteredValue: { formulaValue: `=IMAGE("${url}")` } }
    : { userEnteredValue: { stringValue: '' } };
}

export async function getSheetTabs(spreadsheetId) {
  const res = await fetch(`${BASE}/${spreadsheetId}?key=${API_KEY}`);
  if (!res.ok) throw new Error(`Sheets API error: ${res.status}`);
  const data = await res.json();
  const tabs = data.sheets.map(s => s.properties.title);
  return { data: { tabs } };
}

export function extractSpreadsheetId(url) {
  if (!url) return null;
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

// Read a spreadsheet's tab titles using the user's OAuth token (works on private sheets).
async function getTabsWithToken(spreadsheetId, accessToken) {
  const res = await fetch(`${BASE}/${spreadsheetId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not read the build sheet (${res.status}). Make sure your Google account can edit it.`);
  const data = await res.json();
  return (data.sheets || []).map(s => s.properties.title);
}

// Mirror the Parts Library master sheet's Category tabs into a build sheet (tabs
// only — no subcategories or parts). Adds any missing tabs; leaves existing alone.
export async function syncBuildSheetTabs(masterUrl, buildUrl, accessToken) {
  const masterId = extractSpreadsheetId(masterUrl);
  const buildSheetId = extractSpreadsheetId(buildUrl);
  if (!masterId) throw new Error('No Parts Library master sheet is linked (set it in Settings).');
  if (!buildSheetId) throw new Error('This build has no valid Google Sheet URL.');

  const masterTabs = (await getSheetTabs(masterId)).data.tabs || [];
  const buildTabs = await getTabsWithToken(buildSheetId, accessToken);
  const existing = new Set(buildTabs.map(t => t.trim().toLowerCase()));
  const toAdd = masterTabs.filter(t => !existing.has(t.trim().toLowerCase()));

  for (const name of toAdd) {
    await addSheetTab(buildSheetId, name, accessToken);
  }
  return { added: toAdd.length, total: masterTabs.length };
}

// Write a part into a BUILD sheet: tab = its Category, grouped under a Subcategory
// header (created if missing), with a quantity column (E). If the part already
// exists under that subcategory, just updates its qty.
export async function addPartToBuildSheet(buildSheetUrl, part, accessToken) {
  const ssId = extractSpreadsheetId(buildSheetUrl);
  if (!ssId) throw new Error('Invalid build sheet URL');
  const tab = part.category;
  const subcat = (part.subcategory || 'Parts').trim();
  if (!tab) throw new Error('Part is missing its category (tab)');

  const range = encodeURIComponent(tab);
  const readRes = await fetch(`${BASE}/${ssId}?includeGridData=true&ranges=${range}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read the build sheet (${readRes.status})`);
  const data = await readRes.json();
  const sheet = data.sheets?.[0];
  const gid = sheet?.properties?.sheetId;
  if (gid == null) throw new Error(`Category tab "${tab}" not found in the build sheet`);
  const colCount = sheet?.properties?.gridProperties?.columnCount ?? 26;
  const rows = sheet?.data?.[0]?.rowData ?? [];

  const targetSub = subcat.toLowerCase();
  const targetName = (part.name || '').trim().toLowerCase();
  let subHeaderRow = -1, lastInSub = -1, existingPartRow = -1, lastUsedRow = -1, sampleHeaderRow = -1, inSub = false;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const first = cells[0];
    const val = first?.formattedValue?.trim();
    const bg = first?.effectiveFormat?.backgroundColor;
    if (val) lastUsedRow = i;
    if (!val) continue;
    if (isGrayBackground(bg)) continue;
    if (isDarkBackground(bg)) {
      if (sampleHeaderRow === -1) sampleHeaderRow = i;
      if (inSub) break;
      if (val.toLowerCase() === targetSub) { subHeaderRow = i; inSub = true; lastInSub = i; }
    } else if (inSub) {
      lastInSub = i;
      if (val.toLowerCase() === targetName) existingPartRow = i;
    }
  }

  const requests = [];
  const qty = Number(part.qty) || 0;
  const qtyCell = { userEnteredValue: { numberValue: qty || 1 } };

  if (existingPartRow !== -1) {
    if (qty <= 0) {
      // qty fell to zero → remove the part row from the build sheet
      requests.push({ deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: existingPartRow, endIndex: existingPartRow + 1 } } });
    } else {
      requests.push({ updateCells: { rows: [{ values: [qtyCell] }], fields: 'userEnteredValue', start: { sheetId: gid, rowIndex: existingPartRow, columnIndex: 4 } } });
    }
  } else if (qty <= 0) {
    return true; // nothing to add
  } else {
    let insertAt;
    if (subHeaderRow === -1) {
      const headerAt = lastUsedRow + 1;
      requests.push({ insertDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: headerAt, endIndex: headerAt + 1 } } });
      requests.push({ updateCells: { rows: [{ values: [{ userEnteredValue: { stringValue: subcat } }] }], fields: 'userEnteredValue', start: { sheetId: gid, rowIndex: headerAt, columnIndex: 0 } } });
      if (sampleHeaderRow !== -1) {
        requests.push({ copyPaste: { source: { sheetId: gid, startRowIndex: sampleHeaderRow, endRowIndex: sampleHeaderRow + 1, startColumnIndex: 0, endColumnIndex: colCount }, destination: { sheetId: gid, startRowIndex: headerAt, endRowIndex: headerAt + 1, startColumnIndex: 0, endColumnIndex: colCount }, pasteType: 'PASTE_FORMAT' } });
      } else {
        requests.push({ repeatCell: { range: { sheetId: gid, startRowIndex: headerAt, endRowIndex: headerAt + 1, startColumnIndex: 0, endColumnIndex: colCount }, cell: { userEnteredFormat: { backgroundColor: { red: 0, green: 0, blue: 0 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
      }
      insertAt = headerAt + 1;
    } else {
      insertAt = lastInSub + 1;
    }
    const supplierCell = part.supplierLink
      ? { userEnteredValue: { formulaValue: `=HYPERLINK("${part.supplierLink}","${(part.supplier || '').replace(/"/g, '""')}")` } }
      : { userEnteredValue: { stringValue: part.supplier || '' } };
    requests.push({ insertDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: insertAt, endIndex: insertAt + 1 } } });
    requests.push({ updateCells: { rows: [{ values: [
      { userEnteredValue: { stringValue: part.name || '' } },
      supplierCell,
      { userEnteredValue: { stringValue: part.partNum || '' } },
      { userEnteredValue: { stringValue: part.price || '' } },
      qtyCell,
    ] }], fields: 'userEnteredValue', start: { sheetId: gid, rowIndex: insertAt, columnIndex: 0 } } });
    requests.push({ repeatCell: { range: { sheetId: gid, startRowIndex: insertAt, endRowIndex: insertAt + 1, startColumnIndex: 0, endColumnIndex: colCount }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false } } }, fields: 'userEnteredFormat(backgroundColor,textFormat.bold)' } });
  }

  const writeRes = await fetch(`${BASE}/${ssId}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
  if (!writeRes.ok) {
    const t = await writeRes.text();
    throw new Error(`Build sheet write failed (${writeRes.status}): ${t.slice(0, 150)}`);
  }
  return true;
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
    throw new Error(`Add category failed (${res.status}): ${t.slice(0, 160)}`);
  }
  return true;
}

// Rename a tab (worksheet). Looks up the sheetId by its current title, then
// updates the title. Used by the inline "edit Category name" in Parts Library.
export async function renameSheetTab(spreadsheetId, oldTitle, newTitle, accessToken) {
  const metaRes = await fetch(`${BASE}/${spreadsheetId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metaRes.ok) throw new Error(`Could not read spreadsheet (${metaRes.status})`);
  const meta = await metaRes.json();
  const sheet = (meta.sheets || []).find(s => s.properties.title === oldTitle);
  if (!sheet) throw new Error(`Category "${oldTitle}" not found`);
  const sheetId = sheet.properties.sheetId;
  const res = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId, title: newTitle.trim() }, fields: 'title' } }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Rename category failed (${res.status}): ${t.slice(0, 160)}`);
  }
  return true;
}

// Rename a subcategory (a dark-background header row) in place — only changes the
// header's text in column A, keeping its formatting so the parser still detects it.
export async function renameCategory(spreadsheetId, sheetName, oldName, newName, accessToken) {
  const range = encodeURIComponent(sheetName);
  const readRes = await fetch(`${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read sheet (${readRes.status})`);
  const data = await readRes.json();
  const sheet = data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Category not found');
  const rows = sheet?.data?.[0]?.rowData ?? [];

  const target = oldName.trim().toLowerCase();
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const first = (rows[i].values ?? [])[0];
    const bg = first?.effectiveFormat?.backgroundColor;
    const val = first?.formattedValue?.trim();
    if (!val) continue;
    if (isGrayBackground(bg)) continue;
    if (isDarkBackground(bg) && val.toLowerCase() === target) { rowIndex = i; break; }
  }
  if (rowIndex === -1) throw new Error(`Subcategory "${oldName}" not found in "${sheetName}"`);

  const res = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateCells: { rows: [{ values: [{ userEnteredValue: { stringValue: newName.trim() } }] }], fields: 'userEnteredValue', start: { sheetId, rowIndex, columnIndex: 0 } } }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Rename subcategory failed (${res.status}): ${t.slice(0, 160)}`);
  }
  return true;
}

// Update an existing part row in place (cols A–D: name, supplier, part#, price).
// Locates the row by the ORIGINAL name (+ part# when present) within its category,
// then overwrites its values. Keeps the row where it is. Requires a write token.
export async function updatePartRow(spreadsheetId, sheetName, categoryName, original, updated, accessToken) {
  const range = encodeURIComponent(sheetName);
  const readRes = await fetch(`${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read sheet (${readRes.status})`);
  const data = await readRes.json();
  const sheet = data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Category not found');
  const rows = sheet?.data?.[0]?.rowData ?? [];

  const targetCat = categoryName.trim().toLowerCase();
  const targetName = (original.partName || '').trim().toLowerCase();
  const targetNum = (original.partNum || '').trim().toLowerCase();
  let inCategory = false;
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const first = (rows[i].values ?? [])[0];
    const bg = first?.effectiveFormat?.backgroundColor;
    const val = first?.formattedValue?.trim();
    if (!val) continue;
    if (isGrayBackground(bg)) continue;
    if (isDarkBackground(bg)) {
      if (inCategory) break;
      if (val.toLowerCase() === targetCat) inCategory = true;
    } else if (inCategory) {
      const name = val.toLowerCase();
      const num = ((rows[i].values ?? [])[2]?.formattedValue?.trim() || '').toLowerCase();
      if (name === targetName && (!targetNum || num === targetNum)) { rowIndex = i; break; }
    }
  }
  if (rowIndex === -1) throw new Error(`Part "${original.partName}" not found in "${categoryName}"`);

  const supplierCell = updated.supplierLink
    ? { userEnteredValue: { formulaValue: `=HYPERLINK("${updated.supplierLink}","${(updated.supplier || '').replace(/"/g, '""')}")` } }
    : { userEnteredValue: { stringValue: updated.supplier || '' } };
  const rowValues = [
    { userEnteredValue: { stringValue: updated.partName || '' } },
    supplierCell,
    { userEnteredValue: { stringValue: updated.partNum || '' } },
    { userEnteredValue: { stringValue: updated.price || '' } },
    imageCellFor(updated.imageUrl), // col E: picture
    { userEnteredValue: { stringValue: updated.contactEmail || '' } }, // col F: supplier contact email
  ];

  const res = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateCells: { rows: [{ values: rowValues }], fields: 'userEnteredValue', start: { sheetId, rowIndex, columnIndex: 0 } } }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Update part failed (${res.status}): ${t.slice(0, 160)}`);
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
  if (sheetId == null) throw new Error('Category not found');
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
    throw new Error(`Add subcategory failed (${writeRes.status}): ${t.slice(0, 160)}`);
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
  if (sheetId == null) throw new Error('Category not found');
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

  if (headerRow === -1) throw new Error(`Subcategory "${categoryName}" not found in "${sheetName}"`);

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
    imageCellFor(part.imageUrl), // col E: picture
    { userEnteredValue: { stringValue: part.contactEmail || '' } }, // col F: supplier contact email
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
  if (sheetId == null) throw new Error('Category not found');
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

// Read a tab and return every part row WITH its row index, so a backfill can
// write images straight to the right rows. Same color parsing as the reader.
export async function getPartRowsForBackfill(spreadsheetId, sheetName, accessToken) {
  const range = encodeURIComponent(sheetName);
  const readRes = await fetch(`${BASE}/${spreadsheetId}?includeGridData=true&ranges=${range}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!readRes.ok) throw new Error(`Could not read sheet (${readRes.status})`);
  const data = await readRes.json();
  const sheet = data.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Category not found');
  const rows = sheet?.data?.[0]?.rowData ?? [];

  const parts = [];
  let inCategory = false;
  let category = '';
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].values ?? [];
    const first = cells[0];
    const bg = first?.effectiveFormat?.backgroundColor;
    const val = first?.formattedValue?.trim();
    if (!val) continue;
    if (isGrayBackground(bg)) continue;
    if (isDarkBackground(bg)) { inCategory = true; category = val; continue; }
    if (!inCategory) continue;
    parts.push({
      rowIndex: i,
      category,
      partName: val,
      supplier: cells[1]?.formattedValue?.trim() ?? '',
      supplierLink: cells[1]?.hyperlink ?? null,
      partNum: cells[2]?.formattedValue?.trim() ?? '',
      price: cells[3]?.formattedValue?.trim() ?? '',
      imageUrl: extractImageUrl(cells[4]),
      contactEmail: cells[5]?.formattedValue?.trim() ?? '',
    });
  }
  return { sheetId, parts };
}

// Write a single part's picture into column E of a known row (used by backfill).
// Only touches column E, so other rows' indices never shift during the run.
export async function writePartImageByRow(spreadsheetId, sheetId, rowIndex, imageUrl, accessToken) {
  const res = await fetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateCells: { rows: [{ values: [imageCellFor(imageUrl)] }], fields: 'userEnteredValue', start: { sheetId, rowIndex, columnIndex: 4 } } }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Image write failed (${res.status}): ${t.slice(0, 120)}`);
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
        imageUrl: extractImageUrl(cells[4]),
        contactEmail: get(5),
      });
    }
  }

  return { data: { categories } };
}
