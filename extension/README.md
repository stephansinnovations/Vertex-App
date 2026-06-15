# Vertex Parts Queue — Chrome extension

Queue a product page (e.g. on Amazon) to auto-add it to the Vertex parts library.

## One-time setup
1. In Supabase, run `supabase/part_queue.sql` (creates the `part_queue` table).
2. Load the extension: open `chrome://extensions`, turn on **Developer mode**,
   click **Load unpacked**, and select this `extension/` folder.

## Use
1. Browse to a product page. Click the extension → **Add this page to queue**.
   Add as many pages as you like (the popup shows the queue).
2. Open the **Parts Library** in the web app, click the **Queue** button, and
   press **Start**. It signs you into Google once, then auto-fills each queued
   URL with AI and writes it into the matching category/subcategory of the sheet.
   You can keep adding URLs from the extension while it runs — they get picked up.

Items that the AI can't map to an existing category are marked **error** in the
queue so you can add those manually.
