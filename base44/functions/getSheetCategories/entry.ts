import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { spreadsheetId, sheetName } = await req.json();
    if (!spreadsheetId || !sheetName) {
      return Response.json({ error: 'Missing spreadsheetId or sheetName' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    const encodedSheet = encodeURIComponent(sheetName);

    // Fetch cell values + background color formatting + hyperlinks
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?ranges=${encodedSheet}&fields=sheets(data(rowData(values(effectiveFormat/backgroundColor,formattedValue,hyperlink,userEnteredValue))))&key=${apiKey}`
    );

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: err }, { status: res.status });
    }

    const data = await res.json();
    const rows = data?.sheets?.[0]?.data?.[0]?.rowData || [];

    // Build categories: each black-bg row is a category header,
    // rows after it (until next black-bg row) are its parts.
    const categories = [];
    let currentCategory = null;

    for (const row of rows) {
      const cells = row.values || [];
      if (cells.length === 0) continue;

      const firstCell = cells[0];
      const bg = firstCell?.effectiveFormat?.backgroundColor;
      const text = firstCell?.formattedValue;

      if (!text || !text.trim()) continue;

      const r = bg?.red || 0;
      const g = bg?.green || 0;
      const b = bg?.blue || 0;
      const isBlack = r < 0.2 && g < 0.2 && b < 0.2;

      if (isBlack) {
        // Start a new category
        currentCategory = { name: text.trim(), parts: [] };
        categories.push(currentCategory);
      } else if (currentCategory) {
        // This is a part row under the current category
        // Columns: part name, supplier, part number, price (adjust indices as needed)
        const partName     = cells[0]?.formattedValue || '';
        const supplier     = cells[1]?.formattedValue || '';
        // Hyperlink can come from the hyperlink field OR from a =HYPERLINK("url","label") formula
        const directLink   = cells[1]?.hyperlink || '';
        const formulaVal   = cells[1]?.userEnteredValue?.formulaValue || '';
        const formulaMatch = formulaVal.match(/=HYPERLINK\(\s*"([^"]+)"/i);
        const supplierLink = directLink || (formulaMatch ? formulaMatch[1] : '');
        const partNum      = cells[2]?.formattedValue || '';
        const price        = cells[3]?.formattedValue || '';

        if (partName.trim()) {
          currentCategory.parts.push({ partName, supplier, supplierLink, partNum, price });
        }
      }
    }

    return Response.json({ categories });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});