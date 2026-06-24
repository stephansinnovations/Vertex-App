# JARVIS.md — Jarvis's working map of Vertex App

My evolving notes on Stephan's app. The authoritative project conventions live in
`CLAUDE.md` (read that first); this file is my own structural map + decisions.

## How things are wired
- **Entry:** `src/App.jsx`. Providers nest: ErrorBoundary → Theme → Background →
  VertexChat → Auth → Shortcut → QueryClient → Router. Inside the Router:
  `NavigationTracker`, `ScreenTracker`, `AuthenticatedApp` (the `<Routes>`), the two
  floating buttons, and the global chat.
- **Routing:** all routes are declared explicitly in `App.jsx` `<Routes>`. `pages.config.js`
  is auto-generated (only `mainPage` is editable) and barely used — most pages are wired by
  hand. There is **no Layout wrapper** (pagesConfig has no `Layout`), so global UI must be a
  component rendered in `App.jsx`, not a shared page chrome.
- **Auth:** `useAuth()` from `@/lib/AuthContext` → `{ isAuthenticated, isAdmin, isLoadingAuth, … }`.
- **Chat/agents:** `useVertexChat()` from `@/lib/VertexChatContext` holds `{ isOpen, agentName,
  agentEmoji, agentPrompt, entityMode, model }`. `open(prompt, name, emoji, entity)` launches a
  chat; `entityMode` switches `GlobalVertexChat` between `EntityChat` and `VertexChat`.
- **Rooms:** an AI Room is `/AIRoom?room=<id>`; the room record (incl. `name`) lives in the
  Supabase `ai_rooms` table. Agents per room are in `ai_agents`.

## Floating / global UI positions (avoid collisions)
- **Vertex orb** (`FloatingVertexButton`): bottom-center, `z-30`.
- **Settings gear** (`FloatingSettingsButton`): draggable, default top-right (~y:96), `z-40`.
  Hidden for non-admins and on `/Settings` and `/Login`.
- **Screen tracker** (`ScreenTracker`): top-left, `z-40`, `pointer-events-none`. Keeps clear of
  the gear (top-right) and orb (bottom-center).

## Decisions log
- **2026-06-24 — Screen tracker breadcrumb.** Added `src/components/ScreenTracker.jsx`, a fixed
  top-left glass pill showing the current screen as a breadcrumb: `Page › Room › Agent`. Route
  label comes from `PAGE_LABELS` (camelCase fallback for unknown segments); room name is fetched
  from `ai_rooms` when `?room=` is present; the agent crumb (emerald, with emoji) appears when a
  chat is open (`useVertexChat`). Hidden on `/Login` and when signed out. Rendered globally in
  `App.jsx` next to `NavigationTracker`.

## How Stephan likes things
- Build features end-to-end, take initiative, keep style consistent with the existing glass /
  dark-zinc + blur aesthetic used by the floating buttons.
- Always run build + lint after edits.
