import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { spreadsheetId } = await req.json();
    if (!spreadsheetId) return Response.json({ error: 'Missing spreadsheetId' }, { status: 400 });

    const apiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title&key=${apiKey}`
    );

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: err }, { status: res.status });
    }

    const data = await res.json();
    const tabs = (data.sheets || []).map(s => s.properties.title);
    return Response.json({ tabs });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});