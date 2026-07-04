# JARVIS.md — Jarvis's working map of the Vertex App

My long-term memory of Stephan's app. Read this first; keep it current.
(Project-wide conventions, data model, and gotchas live in **CLAUDE.md** — read that too.)

## What this app is
Van-build shop management app. React + Vite, deploys to Vercel on push to `main`
(live: vertex-app-orpin.vercel.app). Dev server port **3075**. Stephan is the owner/admin.

## How Stephan likes things done
- This is his own project — act with initiative, implement fully, don't sketch.
- ALWAYS run `npm run build` and `npx eslint <file> --quiet` after editing; fix what I broke.
- I do NOT commit/push or switch branches — the surrounding service handles git/deploy.
- Finish with a short plain-English summary + what to check.
- Keep style consistent with the existing glass / dark-zinc + blur aesthetic.

## How things are wired
- **Entry:** `src/App.jsx`. Providers nest: ErrorBoundary → Theme → Background →
  VertexChat → Auth → Shortcut → QueryClient → Router → **JarvisAmbientProvider**.
  Inside: `NavigationTracker`, `ScreenTracker`, `AuthenticatedApp` (the `<Routes>`),
  `FloatingVertexButton`, `FloatingRoomsButton`, `FloatingSettingsButton`,
  `GlobalVertexChat`, `JarvisInterrupt`.
- **Routing:** all routes are declared explicitly in `App.jsx`. `pages.config.js` is
  auto-generated (only `mainPage` editable). No Layout wrapper — global UI must be a
  component rendered in `App.jsx`.
- **Auth:** `useAuth()` from `@/lib/AuthContext` → `{ isAuthenticated, isAdmin, … }`.
- **Chat/agents:** `useVertexChat()` from `@/lib/VertexChatContext`; `open(prompt, name,
  emoji, entity)` launches a chat; `entityMode` switches EntityChat/VertexChat.
- **Rooms:** `/AIRoom?room=<id>`; rooms in Supabase `ai_rooms`, agents in `ai_agents`.

## The "Jarvis" coding-agent feature (build-the-app-from-inside-the-app)
- **API layer:** `src/api/jarvisAgent.js` — talks to the backend agent (`~/jarvis-agent`
  on Stephan's Mac via Cloudflare tunnel). Config per-device in localStorage
  (`jarvis_agent_url`, `jarvis_agent_secret`).
  - `runAgentTask({prompt, sessionId, onEvent})` → POST `/jarvis`, streams SSE
    (`status`/`say`/`tool`/`approval`/`done`/`error`) → `{summary, branch, changed,
    sessionId, stopped}`.
  - `approveAgentCommand({id, password, deny})` → POST `/approve` (risky commands need
    the password override; shared `ApprovalModal`).
  - **Interrupt:** `cancelAgentTask()` aborts in-flight tasks (AbortController +
    best-effort POST `/stop`); `subscribeAgentActivity(cb)` / `isAgentBusy()` report
    build state; `stopped: true` on interruption.
- **Entry points, one engine:**
  1. `src/components/JarvisBuild.jsx` — full-screen Build view (z-[60]); exports `ApprovalModal` (z-[80]).
  2. `src/components/VertexChat.jsx` — conversational Jarvis; `build_app` tool streams builds
     into the chat. Exports the shared brain: `callClaude`, `TOOLS`, `execTool`,
     `buildSystemPrompt`, `buildVoiceSystemPrompt`, `pickVoice`.
  3. **Voice Mode** (inside VertexChat) — full-screen listen→Claude→speak loop; sets
     `window.__jarvisVoiceModeActive` while it owns the mic.
  4. **Ambient Jarvis** (`src/lib/JarvisAmbient.jsx`) — the floating orb toggles an
     always-listening voice entity app-wide (cyan orb + caption strip, no takeover);
     shares the 'home' chat history; speaks build milestones only.
- **Global interrupt UI:** `src/components/JarvisInterrupt.jsx` — red "Stop coding"
  button (z-[70]) only while a build runs + voice phrases "stop coding"/"cancel build"
  (stands down while Voice Mode owns the mic).

## Floating / global UI positions (avoid collisions)
- **Vertex orb** (`FloatingVertexButton`): bottom-center, z-30. Tap = toggle ambient
  Jarvis; long-press = chat; on /PartsLibrary tap = scan-a-part.
- **Rooms shortcut** (`FloatingRoomsButton`): bottom-right, z-30, admin-only.
- **Settings gear** (`FloatingSettingsButton`): draggable, default top-right, z-40.
- **Screen tracker** (`ScreenTracker`): top-left glass pill, z-40, pointer-events-none.
  Breadcrumb `Page › Room › Agent` (room from `ai_rooms` when `?room=`; agent when chat open).
- **Ambient caption strip:** fixed, bottom≈96, z-40.
- Z ladder: orb/rooms 30 · gear/tracker/strip 40 · chat 50 · Build/Voice 60 · interrupt 70 · approval 80.

## Decisions / notes
- Two `SpeechRecognition` instances must never share the mic — coordinate via
  `window.__jarvisVoiceModeActive`.
- The backend agent's `/stop` route is best-effort from the client; the client-side abort
  halts the stream regardless.
