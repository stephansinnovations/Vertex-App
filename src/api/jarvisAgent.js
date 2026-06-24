// Shared client for the Jarvis Agent backend (~/jarvis-agent). Used by both the
// dedicated Build view (JarvisBuild) and the conversational/voice Jarvis (via the
// build_app tool) so coding tasks all flow through one place — one Jarvis.
//
// Config (URL + secret) lives in localStorage per device. The secret grants code
// execution, so it never goes near shared storage.

const LS_URL = 'jarvis_agent_url';
const LS_SECRET = 'jarvis_agent_secret';
export const REPO_WEB = 'https://github.com/stephansinnovations/Vertex-App';

const clean = (u) => (u || '').replace(/\/+$/, '');

export function getAgentConfig() {
  return { url: clean(localStorage.getItem(LS_URL)), secret: localStorage.getItem(LS_SECRET) || '' };
}
export function setAgentConfig(url, secret) {
  localStorage.setItem(LS_URL, clean(url));
  localStorage.setItem(LS_SECRET, secret);
}
export function isAgentConfigured() {
  const c = getAgentConfig();
  return !!(c.url && c.secret);
}

// Send a coding task to the agent and stream its progress. `onEvent` receives
// each SSE event ({kind:'status'|'say'|'tool'|'approval'|'done'|'error', ...}).
// Resolves with the final { summary, branch, changed, sessionId }.
export async function runAgentTask({ prompt, sessionId, onEvent }) {
  const { url, secret } = getAgentConfig();
  if (!url || !secret) throw new Error("Jarvis Build isn't connected yet — open Build and add the agent URL + secret.");

  const res = await fetch(`${url}/jarvis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ prompt, sessionId: sessionId || undefined }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`Agent ${res.status}${t ? ` — ${t.slice(0, 200)}` : ''}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = { summary: '', branch: 'main', changed: false, sessionId: sessionId || null };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop();
    for (const f of frames) {
      const line = f.split('\n').find(l => l.startsWith('data:'));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      onEvent?.(ev);
      if (ev.kind === 'done') {
        result = { summary: ev.text || '', branch: ev.branch || 'main', changed: !!ev.changed, sessionId: ev.sessionId || result.sessionId };
      }
    }
  }
  return result;
}

export async function approveAgentCommand({ id, password, deny }) {
  const { url, secret } = getAgentConfig();
  await fetch(`${url}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(deny ? { id, deny: true } : { id, password }),
  });
}
