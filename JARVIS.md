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

## ONE JARVIS (unified 2026-07-12)
There is exactly one Jarvis surface. The floating orb is the one button:
- **Tap the orb** → the chat sheet opens LISTENING (voice hot). Tap again → dismissed.
  Saying "goodbye" also dismisses. **Long-press** → opens quiet (no mic).
- **Parts Library exception:** tap = scan-a-part (`vertex:scan-part` event);
  long-press = Jarvis listening.
- **The sheet** (`src/components/VertexChat.jsx`) is everything: typed + spoken turns in
  one transcript, build progress streamed inline, DeployCard with **Make it live**,
  ApprovalModal (password gate), Settings panel. No separate Build view, no full-screen
  voice mode, no ambient strip — those were deleted (JarvisBuild.jsx, JarvisAmbient.jsx).
- **Voice engine** lives inside VertexChat: one persistent SpeechRecognition
  (continuous, 1.1s-silence send), TTS replies for spoken turns only, states
  off|listening|thinking|speaking|building|blocked|unsupported. Sets
  `window.__jarvisVoiceModeActive` while live (JarvisInterrupt reads it to stand down).
  Voice tools: build_app, make_live, list_rooms, list_agents, get_conversation,
  navigate_to (no forms by voice).
- **Context plumbing** (`src/lib/VertexChatContext.jsx`): `open(prompt, name, emoji,
  entity, listen)` — 5th arg opens listening; `voiceWanted`/`setVoiceWanted` (the sheet's
  mic button toggles it), `voiceStatus`/`setVoiceStatus` (engine reports; the orb pulses
  cyan with it: speaking 0.7s, listening 1.6s, building 1.1s).
- **Agent connection setup** moved to Settings → Jarvis (fields `jarvis_agent_secret` +
  `jarvis_agent_url`, localStorage-backed via `local: true`). The URL auto-discovers from
  Supabase `shared_state` key `jarvis_agent` (the agent publishes its tunnel URL);
  `isAgentConfigured()` = secret present.

## The coding engine (build-the-app-from-inside-the-app)
- **API layer:** `src/api/jarvisAgent.js` — talks to `~/jarvis-agent` on Stephan's Mac
  (Cloudflare tunnel). `runAgentTask` streams SSE (status/say/tool/approval/done/error) →
  `{summary, branch, changed, sessionId, stopped}`; `approveAgentCommand`;
  `deployBranch(branch)` = one-tap Make-it-live (merge jarvis/* → main → Vercel);
  `cancelAgentTask()` aborts + POST /stop; `subscribeAgentActivity` drives JarvisInterrupt.
- Builds land on `jarvis/*` preview branches; the DeployCard's **Make it live** button
  (or the make_live tool by voice) merges to main.
- **Global interrupt:** `src/components/JarvisInterrupt.jsx` — red "Stop coding" button
  while a build runs + voice phrases "stop coding"/"cancel build".

## Global UI / mounts (`src/App.jsx`, inside Router)
NavigationTracker · ScreenTracker (top-left breadcrumb `Page › Room › Agent`) ·
AuthenticatedApp · FloatingVertexButton (the orb, bottom-center z-30) ·
FloatingRoomsButton · FloatingSettingsButton · GlobalVertexChat (entityMode ?
EntityChat : VertexChat) · JarvisInterrupt.
Z ladder: orb/rooms 30 · gear/tracker 40 · sheet 50 · interrupt 70 · approval 80.

## Histories
- localStorage `vxd_<ctx>`/`vxa_<ctx>` via `src/lib/vertexChatStorage.js` — ctx from
  getContextKey() ('home', 'builds', 'build_<id>', …) or `agent_<name>`. Voice and text
  share the same ctx history (one transcript).
- Supabase `chat_history` — EntityChat (room agents from AIRoom) + the get_conversation tool.

## Decisions / notes
- Two SpeechRecognition instances must never share the mic — coordinate via
  `window.__jarvisVoiceModeActive`.
- Spoken replies only for spoken turns; typed turns answer silently.
- VertexChat still exports callClaude/TOOLS/execTool/buildSystemPrompt/
  buildVoiceSystemPrompt/pickVoice for reuse.
