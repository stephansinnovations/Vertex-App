# JARVIS.md — Jarvis's working map of the Vertex App

My long-term memory of Stephan's app. Read this first; keep it current.
(Project-wide conventions, data model, and gotchas live in **CLAUDE.md** — read that too.)

> Note: the surrounding service manages git. Uncommitted work from a prior turn may
> be reset before the next turn starts, so treat this file as the source of truth for
> what's *intended*, and re-verify against the actual tree when in doubt.

## What this app is
Van-build shop management app. React + Vite, deploys to Vercel on push to `main`
(live: vertex-app-orpin.vercel.app). Dev server port **3075**. Stephan is owner/admin.

## How Stephan likes things done
- His own project — act with initiative, implement fully, don't sketch.
- ALWAYS `npm run build` + `npx eslint <file> --quiet` after editing; fix what I broke.
- I do NOT commit/push or switch branches — the surrounding service handles git/deploy.
- Finish with a short plain-English summary + what to check.

## The "Jarvis" coding-agent feature (build-the-app-from-inside-the-app)
Headline feature: Jarvis edits/builds/deploys the app from within the UI.
- **API layer:** `src/api/jarvisAgent.js` → backend agent (`~/jarvis-agent` on Stephan's
  Mac via a Cloudflare tunnel). Config (URL + secret) per-device in localStorage.
  `runAgentTask({prompt,sessionId,onEvent})` POSTs `/jarvis`, streams SSE
  (`status`/`say`/`tool`/`approval`/`done`/`error`); `approveAgentCommand` POSTs `/approve`.
- **Three entry points, one engine:**
  1. `src/components/JarvisBuild.jsx` — dedicated Build view (z-[60]); exports the shared
     `ApprovalModal` (z-[80]) for the backend's per-command "Allow once" password.
  2. `src/components/VertexChat.jsx` — conversational Jarvis; `runBuildTask()` (~line 940)
     streams a build into the chat via the `build_app` tool (`agentSessionRef` = continuity).
  3. Voice Mode (in VertexChat, ~line 584) — Web Speech listen→Claude→speak; builds via `build_app`.

## Override-password auth (client-side gate, 24h per device)  ← current
Gates builds + sensitive actions behind a user-set password. Enter it once → THAT device
is authorized for 24h (stored locally); re-entry required after.
- **Core:** `src/api/overrideAuth.js` — SHA-256 (Web Crypto) of `pepper:salt:pw`,
  per-install random salt. localStorage keys: `override_pw_hash`, `override_pw_salt`,
  `override_auth_until` (ms). `AUTH_WINDOW_MS`=24h, `MIN_PASSWORD_LENGTH`=4.
  API: `hasOverridePassword`, `isDeviceAuthorized`, `authExpiresAt`, `verifyPassword`,
  `authorizeDevice(pw)`, `setOverridePassword(pw)` (auto-authorizes), `changeOverridePassword(cur,new)`,
  `clearOverridePassword(cur)`, `lockDevice()`. Fires `override-auth-change` window event on changes.
- **Provider:** `src/lib/OverrideAuthContext.jsx` — `useOverrideAuth().ensureAuthorized(reason)`
  → Promise<bool> (true if inside the 24h window, else pops the gate modal). Wraps the Router in `App.jsx`.
- **Gate modal:** `src/components/OverrideGateModal.jsx` (z-[90]) — first-time setup
  (create + confirm) OR unlock (enter). Success authorizes the device 24h.
- **Settings UI:** `src/components/OverridePasswordSettings.jsx` → Security section (first card)
  in `src/pages/Settings.jsx`. Set/change password, see session time left, "Lock now".
- **Wired into builds:** `JarvisBuild.send` and `VertexChat.runBuildTask` call
  `ensureAuthorized()` before any build (covers text + voice). Extend to other actions by
  calling `ensureAuthorized('do X')` and bailing if it returns false.
- **NOT the backend `/approve` password** — that's server-validated per risky command; this
  one is a local, time-boxed device gate.

## Global UI / overlay structure (`src/App.jsx`)
Router level: fixed purple **Test Banner** (z-9999, top), `NavigationTracker`,
`AuthenticatedApp` (routes), `FloatingVertexButton` (purple orb, z-30),
`FloatingSettingsButton`, `GlobalVertexChat`. The Router is wrapped by
`OverrideAuthProvider` (gate modal renders at z-[90]).
Z ladder: orb 30 · chat 50 · Build/Voice 60 · approval 80 · override gate 90 · banner 9999.

## Roadmap (Stephan's stated priorities)
1. ✅ Override-password auth (done).
2. ⬜ Memory system.
3. ⬜ Build queue dashboard.
