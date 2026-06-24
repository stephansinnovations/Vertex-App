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

## The "Jarvis" coding-agent feature (build-the-app-from-inside-the-app)
This is the headline feature: Jarvis can edit/build/deploy the app from within the UI.
- **API layer:** `src/api/jarvisAgent.js` — talks to the backend agent (`~/jarvis-agent`,
  a server on Stephan's Mac exposed via a Cloudflare tunnel). Config (URL + secret) is
  per-device in localStorage (`jarvis_agent_url`, `jarvis_agent_secret`).
  - `runAgentTask({prompt, sessionId, onEvent})` → POST `/jarvis`, streams SSE events
    (`status`/`say`/`tool`/`approval`/`done`/`error`). Resolves
    `{summary, branch, changed, sessionId, stopped}`.
  - `approveAgentCommand({id, password, deny})` → POST `/approve` (risky commands need a
    password override; surfaced via the shared `ApprovalModal`).
  - **Interrupt (added 2026-06-24):** `cancelAgentTask()` aborts all in-flight tasks
    (client-side `AbortController` + best-effort POST `/stop`); `subscribeAgentActivity(cb)`
    / `isAgentBusy()` report whether a build is running. `runAgentTask` returns
    `stopped: true` when interrupted (callers show "⏹ Coding stopped." instead of an error).
- **Three entry points, one engine:**
  1. `src/components/JarvisBuild.jsx` — dedicated full-screen Build view (z-[60]); also
     exports the shared `ApprovalModal` (z-[80]).
  2. `src/components/VertexChat.jsx` — conversational Jarvis. `runBuildTask()` (~line 932)
     streams a build into the chat transcript via the `build_app` tool. `agentSessionRef`
     keeps continuity.
  3. **Voice Mode** (inside VertexChat, ~line 584) — Web Speech API listen→Claude→speak
     loop; can trigger builds via `build_app`. Sets `window.__jarvisVoiceModeActive` while
     it owns the mic.
- **Global interrupt UI:** `src/components/JarvisInterrupt.jsx`, mounted in `App.jsx`
  alongside the floating buttons. Shows a prominent red **"Stop coding"** button (z-[70],
  top of screen) ONLY while a build runs, plus a voice listener that fires only on the
  explicit phrases **"stop coding"** / **"cancel build"** (whole-phrase match → no accidental
  interrupts). The voice listener stands down while Voice Mode owns the mic.

## Global UI / overlay structure (`src/App.jsx`)
Mounted at Router level: a fixed purple **Test Banner** (z-9999, top), `NavigationTracker`,
`AuthenticatedApp` (routes), `FloatingVertexButton` (the purple orb, z-30),
`FloatingSettingsButton`, `GlobalVertexChat`, and `JarvisInterrupt`.
Z-index ladder: orb 30 · chat sheet 50 · Build/Voice 60 · **interrupt 70** · approval 80 · banner 9999.

## Decisions / notes
- The backend agent may predate a `/stop` route — that's fine, the client-side abort halts
  the stream regardless; the `/stop` POST is fire-and-forget.
- Voice interrupt + Voice Mode must not run two `SpeechRecognition` instances on the same
  mic → coordinated via `window.__jarvisVoiceModeActive`.
