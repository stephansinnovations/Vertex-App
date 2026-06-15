// Talks to Supabase REST directly with the public anon key (same project as the
// web app). Inserts the current tab's URL into `part_queue` and shows the queue.
const SUPABASE_URL = 'https://ufktfpwcobqxyjyiteot.supabase.co';
const ANON_KEY = 'sb_publishable_g1VwJo9Tv07d35H4pUPDfg_yc3Ooxg4';
const REST = `${SUPABASE_URL}/rest/v1/part_queue`;
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' };

const $ = (id) => document.getElementById(id);
const addBtn = $('add');
const msgEl = $('msg');
const urlEl = $('url');
const listEl = $('list');

let currentUrl = '';

function setMsg(text, kind) {
  msgEl.textContent = text || '';
  msgEl.className = 'msg' + (kind ? ' ' + kind : '');
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

async function renderQueue() {
  try {
    const res = await fetch(`${REST}?select=url,status,part_name,error&order=created_at.desc&limit=25`, { headers: HEADERS });
    if (!res.ok) throw new Error(String(res.status));
    const rows = await res.json();
    if (!rows.length) { listEl.innerHTML = '<div class="empty">Nothing queued yet.</div>'; return; }
    listEl.innerHTML = rows.map((r) => {
      const label = r.part_name || (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return r.url; } })();
      const title = r.error ? `${label} — ${r.error}` : label;
      return `<div class="item"><span class="t" title="${escapeHtml(title)}">${escapeHtml(label)}</span><span class="badge b-${r.status}">${r.status}</span></div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div class="empty">Couldn't load the queue (${escapeHtml(e.message)}). Has the part_queue table been created?</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function addCurrent() {
  if (!currentUrl || !/^https?:\/\//i.test(currentUrl)) { setMsg('This page has no addable URL.', 'err'); return; }
  addBtn.disabled = true;
  setMsg('Adding to queue…');
  try {
    const res = await fetch(REST, { method: 'POST', headers: { ...HEADERS, Prefer: 'return=minimal' }, body: JSON.stringify({ url: currentUrl }) });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    setMsg('Queued ✓', 'ok');
    renderQueue();
  } catch (e) {
    setMsg(`Failed: ${e.message}`, 'err');
  } finally {
    addBtn.disabled = false;
  }
}

(async function init() {
  currentUrl = await getActiveTabUrl();
  try { urlEl.textContent = new URL(currentUrl).hostname + new URL(currentUrl).pathname; } catch { urlEl.textContent = currentUrl || '(no URL)'; }
  addBtn.addEventListener('click', addCurrent);
  renderQueue();
})();
