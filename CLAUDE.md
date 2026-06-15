# Vertex App — working notes

Van-build shop management app. React + Vite. Deploys to Vercel on push to `main`
(live: vertex-app-orpin.vercel.app). Dev server port **3075**.

## Workflow
- After a verified change: **commit and push automatically** (don't ask). Scrub any
  token from `git push` output (`sed 's/github_pat[^@]*/***/g'`).
- Branch protection: none — work on `main`.

## Data / storage
- **Auth = Supabase.** `profiles` table holds roles; `is_admin()` SQL function gates RLS.
  Bootstrap admin is `stephansinnovations@gmail.com`, hardcoded in `AuthContext` as a
  fallback so the owner is never locked out even before/independent of the profiles row.
  Admin-only routes (`AdminRoute`): `/Settings`, `/Vertex`, `/AIRoom`, `/Rooms`.
- **`base44` = `localDb.js` = per-device localStorage** for `SOP`, `WorkOrder`,
  `MeetingNote`, `SOPPerformance`, `StockItem`, `User`. **Exception: `Build` is
  Supabase-backed** (`api/buildsDb.js`, same entity interface) so builds sync across
  devices. Local builds auto-migrate to Supabase once per device on sign-in.
- **Supabase tables:** `profiles`, `builds`, `app_settings`, `chat_history`, `ai_rooms`,
  `ai_agents`, `bug_reports`, `part_queue`, `shared_state`. Builds carry `owner` + RLS
  (delete-own / admin-any). The internal-tool tables (`bug_reports`, `part_queue`,
  `shared_state`) use `for all using(true)` — the anon/publishable key is already public.
- **Build phases** live as `jsonb` on the Supabase build row (synced). Phase parts are
  embedded in `phase.parts`; tasks carry `task.parts`. The standard phase template is
  `DEFAULT_PHASES` in `buildsDb.js` (re-seeded onto any build lacking a "Customer meeting"
  phase; edits preserved after).
- **Google Sheets:** Parts Library has one shared **master sheet** (`masterSheetUrl` in
  `app_settings`). Each build has its **own** build sheet (`build_sheet_url` on the build).
  Reads use the API key (`VITE_GOOGLE_SHEETS_API_KEY`); **writes use OAuth**
  (`VITE_GOOGLE_OAUTH_CLIENT_ID`, Google sign-in popup, scope `auth/spreadsheets`).

## Conventions
- **Parts Library naming:** a sheet **tab = "Category"**; a dark-background header row
  within a tab = **"Subcategory"**; rows under it = parts. (UI renamed tab→Category,
  category→Subcategory.) Build sheets mirror the master sheet's tabs (Categories).
- **Sheet row parsing/writing** (`api/googleSheets.js`): dark bg = header, gray bg = skip,
  else = part. **Part rows must be white** or the parser treats them as a header — always
  force white bg when inserting a part (`addPartToCategory`, `addPartToBuildSheet`).
- **AI providers:** Claude (Anthropic) for AI Rooms / agents / chat, via the edge proxy
  `/api/claude/v1/messages` (forwards `anthropic-beta`). **Gemini** for parts vision +
  web lookup (`api/geminiParts.js`), called **direct from the browser** with `geminiApiKey`
  from Settings (no proxy). Keys live in Settings (`app_settings`), readable by all members.
- **Backgrounds:** `BackgroundContext` applies a CSS/image background to `document.body`,
  library + active choice persisted in localStorage.
- **Parts Library UI** (`pages/PartsLibrary.jsx`) is a single Amazon-style "store" theme:
  light page, navy header (search + Add Part + Orders + Cart), Category → Subcategory →
  product-card grid (`grid-cols-2` mobile → `lg:grid-cols-5`). The old dark "classic"
  theme + toggle were removed. Bulk **AI picture-backfill** lives in Settings → Inventory
  (`BackfillPicturesButton`, admin); Settings → Diagnostics has the `/Bugs` page.
- **Per-part cards** (`/PartsLibrary`, header renamed to just "Parts"): clicking the
  card opens the part link (skips clicks on buttons/links/inputs); a low-key pencil
  (bottom-right of card) edits; cards are draggable onto another subcategory to move the
  part. On the image: yellow add-to-cart (bottom-right, shows in-cart qty + corner
  badge) and a stock-quantity circle (bottom-left) colored by on-hand vs build-allocated
  — gray=no count, green=surplus, blue=exact, red=short (`stockColor()`).
- **Shop-wide shared state:** cart, orders, stock counters and the add-part queue all
  **sync across all devices/accounts** (global, not per-user). Cart/orders/stock are
  localStorage caches (`partsLibrary{Cart,Orders,Stock}` + `cartchange`/`orderschange`/
  `stockchange` window events) **mirrored to Supabase `shared_state` blobs** (keys
  `cart`/`orders`/`stock`); a single 6s poller pulls remote changes, with a 4s
  post-write guard so in-flight writes aren't clobbered. Falls back to local-only if the
  table/network is down. Run `supabase/shared_state.sql` once.
- **Orders flow:** the cart's per-item blue circle marks a part **ordered** (cart →
  Orders modal); **Received** adds its qty to the stock counter (one-level **Undo**
  reverts it); **Re-add to cart** moves it back. Order button opens each cart part's
  link in its own tab (anchor-click; browsers still pop-up-block multiples until allowed).
  Cart/Orders rows have a **Contact** button → Gmail compose order email (`orderEmailUrl`,
  signed-in user's name as the signoff, ship-to hardcoded in `orderEmailUrl`).
- **Add Part = Edit Part:** the pencil opens the *same* Add Part modal prefilled
  (`openEditFor`); changing category/subcategory on save **moves** the part (add new +
  delete old). Every field has a low-key ✨ that AI-fills just that field
  (`fillPartField`/`guessPartCategory`); supplier contact email is sheet **column F**.
- **Add-from-URL queue:** the Chrome extension in `extension/` (load unpacked; talks to
  Supabase REST with the anon key) queues product URLs into `part_queue`. The Add Part
  modal also queues via "Add another"; the in-modal Inbox icon opens the queue panel →
  **Start** signs in once then AI-fills each URL and files it into the matching existing
  category (no match → flagged `error`). Run `supabase/part_queue.sql` once.
- **Part images on add/edit:** edit modal uploads to Supabase Storage bucket
  `part-images` (public, like `sop-videos`), plus AI find-image + AI autofill-from-link.
- **Edit a part:** small pencil at the card's bottom-right opens the edit modal (the
  old title hold/double-tap gesture was removed). **Add Part** requires a category +
  subcategory (empty ones flag red on submit); the AI link-fill only auto-picks a
  category if the user hasn't (tracked via `addTabRef` so its async closure isn't stale).
- **Scan a part:** on `/PartsLibrary` the floating purple orb (`FloatingVertexButton`)
  is the scan button — it shows a camera and dispatches a `vertex:scan-part` window
  event (the page listens + opens the camera within the gesture). The flow runs
  `scanPartFromImage` (Amazon-biased) and a library search in parallel: a match →
  confirm + add qty to cart; no match → Amazon link (ready) + Add-to-Library shortcut.
- **App-wide error reporting:** `ErrorBoundary` (React render crashes) +
  `GlobalErrorReporter` (window errors / unhandled rejections) surface a **Report Bug**
  button. `api/bugReports.js` writes to Supabase `bug_reports` with a localStorage
  fallback (`vertex_bug_reports`) so nothing's lost offline / before the table exists
  (run `supabase/bug_reports.sql` once). Read all bugs via `node scripts/read-bugs.mjs`
  or the admin `/Bugs` page (Settings → Diagnostics).

## Gotchas
- **`VITE_*` env vars bake in at build time** → after changing one in Vercel, **redeploy
  with a clean build (uncheck build cache)**. Changing it on localhost needs a dev restart.
- **localhost has a placeholder `VITE_GOOGLE_SHEETS_API_KEY`** → master-sheet reads (and
  thus most parts/build-sheet features) only work on the **deployed site**.
- **Sheet + OAuth writes can't be verified locally** (need real Google sign-in + an
  editable sheet) — implement carefully and have the user test on the deployed site.
- **Supabase SQL editor runs a whole script as one transaction**: any failure rolls back
  everything, and statement order matters (create `is_admin()` before policies use it). A
  pre-existing `profiles` table may have legacy `NOT NULL` columns (e.g. `full_name`) —
  use `alter ... add column if not exists` + relax/supply those.
- **Google Search grounding returns `vertexaisearch...redirect` URLs that expire** —
  `geminiParts.cleanLink` swaps them for a durable Google-search URL.
- **Amazon (and other shops) block the AI's in-browser page read**, so Gemini returns
  empty/garbage image + price. Real values come from the serverless **`api/productImage.js`**
  (fetches the page with a browser UA → `og:image`/`images/I/` + `a-offscreen`/`priceAmount`).
  `geminiParts.resolveImage`/`fetchPageMeta` order for Amazon: server → ASIN image
  (`images-na.ssl-images-amazon.com/images/P/<ASIN>...`) → AI guess; price prefers server.
  Amazon CAPTCHA-blocks server fetches **intermittently** (per-request, not per-product) →
  occasional empty result; the ASIN P-endpoint sometimes returns a 1×1 placeholder, so
  `PartImage` treats `naturalWidth<=1` as "no image".
- **`/api/*` serverless functions only run on Vercel** (vite dev has none → `fetchPageMeta`
  no-ops to `{}` locally). Verify handler logic by importing it in `node` (has network);
  the AI/serverless add-part flow can't be exercised in the local preview.
- **Build-sheet part qty is per-source (last write wins), not summed** across phases/tasks;
  the in-app per-phase Parts section shows the correct merged total.
- **Card image must be `absolute inset-0` inside the `aspect-square` box** — an in-flow
  `<img h-full>` makes a tall photo blow the box up to its natural height. `PartImage`
  uses `object-contain` (show the whole image, white-boxed), not `object-cover`.
- **iOS Safari zooms on input focus when font-size < 16px** → `index.css` forces 16px on
  `input/select/textarea` at `≤640px` (so opening Add Part doesn't zoom the page).
- **Gemini 503 "model overloaded" is intermittent** — `geminiParts.callGemini` already
  retries 503/429/500 + network errors up to 4× with exponential backoff.

## Verifying changes
- Drive the running app via the **Claude Preview MCP**. Throwaway harness pattern:
  `bubble-check.html` + `src/__bubblecheck.jsx` rendering a page/component in a
  `MemoryRouter` (+ providers), stub `window.fetch` for Sheets/Supabase as needed; **delete
  both files after**. Don't leave them committed. `PartsLibrary` renders fine in a harness
  with `MemoryRouter` + `AuthProvider` (it'll say "Loading categories…" without a real
  sheet, but the header/modals + localStorage features — cart/orders/queue/stock — are
  testable). `CategoryRow` isn't exported, so its card/edit UI can't be harnessed in isolation.
- **Preview viewport quirk:** after `preview_resize` desktop the viewport can collapse to
  `width:1` (breaks layout-dependent measurements) — use the **mobile** preset (375px) for
  reliable width-dependent checks.
- Lint per file: `npx eslint <file> --quiet`. The unused `Disc` import in
  `PartsLibrary.jsx` is pre-existing — ignore it. Other stray unused lucide imports are
  common; remove them when you touch the file.
