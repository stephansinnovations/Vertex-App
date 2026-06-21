import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X, Settings, Mic, MicOff, Send, Trash2, ChevronRight, Check, Code2, ImagePlus, AudioLines, PhoneOff } from 'lucide-react';
import { localClient } from '@/api/localDb';
import { useTheme, THEMES, PERSONALITIES } from '@/lib/ThemeContext';
import { useVertexChat } from '@/lib/VertexChatContext';
import {
  loadDisplay, loadApi, saveDisplay, saveApi, clearHistory,
  getContextKey, getContextLabel, getContextGreeting, getContextSuggestions,
} from '@/lib/vertexChatStorage';
import vertexLogo from '@/assets/Vertex-logo.webp';

// ── Dev (Build Mode) tools ────────────────────────────────────────────────────

const DEV_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a source file. Always read before editing.',
    input_schema: {
      type: 'object', required: ['path'],
      properties: { path: { type: 'string', description: 'Path from project root, e.g. "src/pages/Home.jsx"' } },
    },
  },
  {
    name: 'write_file',
    description: 'Write the complete content of a source file. Vite hot-reloads automatically after write.',
    input_schema: {
      type: 'object', required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'The COMPLETE new file content — never partial' },
      },
    },
  },
  {
    name: 'list_files',
    description: 'List files/folders in a directory.',
    input_schema: {
      type: 'object',
      properties: { dir: { type: 'string', description: 'Directory from project root, e.g. "src/pages"' } },
    },
  },
];

async function execDevTool(name, input) {
  switch (name) {
    case 'read_file': {
      const res = await fetch(`/api/dev/read?path=${encodeURIComponent(input.path)}`);
      return res.json();
    }
    case 'write_file': {
      const res = await fetch('/api/dev/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: input.path, content: input.content }),
      });
      return res.json();
    }
    case 'list_files': {
      const res = await fetch(`/api/dev/list?dir=${encodeURIComponent(input.dir || 'src')}`);
      return res.json();
    }
    default:
      return { error: `Unknown dev tool: ${name}` };
  }
}

function buildDevSystemPrompt(personality) {
  const tone = {
    direct: 'Be brief and direct.',
    conversational: 'Be friendly and natural.',
    professional: 'Be formal and thorough.',
  }[personality] || 'Be brief and direct.';

  return `You are Jarvis in Build Mode — you can read and modify this app's own source code. ${tone}

This is a React + Vite + Tailwind CSS app called "Vertex Vans" (a van build shop management tool).

Tech stack:
- React 18, React Router v6, @tanstack/react-query
- Tailwind CSS — dark theme (zinc-900/800/700 backgrounds, white text)
- Lucide React for icons
- localStorage as database via localClient from @/api/localDb
- Vite HMR — changes appear in the browser instantly after write_file

Project structure:
- src/pages/       — page components (Home.jsx, Builds.jsx, PhaseDetail.jsx, etc.)
- src/components/  — reusable components (VertexChat.jsx, FloatingVertexButton.jsx, etc.)
- src/lib/         — contexts (ThemeContext, VertexChatContext, AuthContext)
- src/api/         — localDb.js, googleSheets.js, seed JSON files
- src/assets/      — Vertex-logo.webp

Rules:
1. ALWAYS call read_file before editing any file — never guess the content
2. Write the COMPLETE file when using write_file — never partial content
3. After writing, briefly describe what changed
4. Match the existing code style (no comments unless the why is non-obvious)
5. Auth is bypassed — user is always local@localhost, company_id: 'vertexvans'
6. The local user object: { id: 'local-user', email: 'local@localhost', company_id: 'vertexvans' }`;
}

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(contextKey, personality) {
  const tone = {
    direct:         'Be brief, direct, and action-oriented. No filler.',
    conversational: 'Be warm, friendly, and natural.',
    professional:   'Be formal, precise, and thorough.',
  }[personality] || 'Be brief and direct.';

  const ctx = {
    builds:    'The user is on the Builds page. Focus on build management.',
    sops:      'The user is on the SOPs page. Focus on SOP management.',
    inventory: 'The user is on the Inventory page. Focus on stock and parts.',
    contacts:  'The user is on the Contacts page.',
  }[contextKey] || (contextKey.startsWith('build_') ? `The user is viewing a specific build. Focus on this build's phases, tasks, and parts.` : '');

  return `You are Jarvis, the intelligent assistant inside the Vertex Vans shop management app. ${tone}

${ctx}

You help manage: van builds (phases, tasks, parts), SOPs (standard operating procedures), inventory/parts stock, and contacts.

When the user wants to create something, use the show_form tool — prefill any fields you already know from the conversation.
When you navigate somewhere or create a record, a card will appear automatically — just describe what you did concisely.
For lists, be brief. Lead with the most relevant item.`;
}

// Wraps the normal prompt with voice-conversation rules: short, spoken-friendly,
// no markdown. Used by the live Voice Mode (speech in, speech out).
function buildVoiceSystemPrompt(base) {
  return `${base}

You are in a live VOICE conversation — the user is speaking to you and your reply is read aloud. Keep answers short and natural for the ear: usually one to three sentences. Plain spoken language only — no markdown, no bullet lists, no headings, no emoji, no code blocks. If something genuinely needs detail, give the gist and offer to go deeper. Be warm, quick, and direct.`;
}

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_sops',
    description: 'List SOPs, optionally filtered by department.',
    input_schema: { type: 'object', properties: { group: { type: 'string' } } },
  },
  {
    name: 'search_sops',
    description: 'Search SOPs by keyword.',
    input_schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    name: 'list_builds',
    description: 'List all van builds.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_departments',
    description: 'List all SOP departments.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_stock',
    description: 'Get current parts stock levels.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'show_form',
    description: 'Show a form for the user to fill in. Use this whenever you need to create a new record.',
    input_schema: {
      type: 'object',
      required: ['form_type'],
      properties: {
        form_type: {
          type: 'string',
          enum: ['create_build', 'create_sop', 'create_department'],
          description: 'Which form to show',
        },
        prefilled: {
          type: 'object',
          description: 'Fields to pre-fill based on what the user said',
        },
      },
    },
  },
  {
    name: 'navigate_to',
    description: 'Navigate to a page in the app.',
    input_schema: {
      type: 'object',
      required: ['page'],
      properties: {
        page: { type: 'string', enum: ['Builds', 'SOPList', 'PartsLibrary', 'Contacts', 'Inventory'] },
      },
    },
  },
];

// ── Tool executor ────────────────────────────────────────────────────────────

async function execTool(name, input, { formResolve, navigate }) {
  switch (name) {
    case 'list_sops': {
      const all = await localClient.entities.SOP.filter(input.group ? { group: input.group } : {});
      return all.slice(0, 20).map(s => ({ id: s.id, title: s.title, group: s.group, description: s.description }));
    }
    case 'search_sops': {
      const all = await localClient.entities.SOP.filter();
      const q = input.query.toLowerCase();
      return all
        .filter(s => s.title?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
        .slice(0, 10)
        .map(s => ({ id: s.id, title: s.title, group: s.group }));
    }
    case 'list_builds': {
      const all = await localClient.entities.Build.filter();
      return all.map(b => ({ id: b.id, name: b.name, van_model: b.van_model, status: b.status }));
    }
    case 'list_departments': {
      const all = await localClient.entities.WorkOrder.filter();
      return all.map(o => ({ id: o.id, name: o.name }));
    }
    case 'get_stock': {
      try { return JSON.parse(localStorage.getItem('partsLibraryStock') || '{}'); } catch { return {}; }
    }
    case 'show_form': {
      return await new Promise(resolve => {
        formResolve.current = resolve;
        formResolve.setPending({ type: input.form_type, prefilled: input.prefilled || {} });
      });
    }
    case 'navigate_to': {
      navigate(`/${input.page}`);
      return { navigated: true, page: input.page };
    }
    // Dev tools
    case 'read_file':
    case 'write_file':
    case 'list_files':
      return execDevTool(name, input);

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── API call ─────────────────────────────────────────────────────────────────

// Cache API key in memory so we don't hit Supabase on every message
let _cachedAnthropicKey = null;

async function callClaude(messages, systemPrompt, tools, model = 'claude-haiku-4-5') {
  const isLocalhost = window.location.hostname === 'localhost';
  const url = isLocalhost
    ? '/api/claude/v1/messages'
    : 'https://api.anthropic.com/v1/messages';

  const headers = { 'content-type': 'application/json' };
  if (!isLocalhost) {
    if (!_cachedAnthropicKey) {
      const { getSetting } = await import('@/api/appSettings');
      _cachedAnthropicKey = (await getSetting('anthropicApiKey')) || localStorage.getItem('anthropicApiKey');
    }
    if (!_cachedAnthropicKey) throw new Error('No Anthropic API key — add it in Settings');
    headers['x-api-key'] = _cachedAnthropicKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 8096,
      system: systemPrompt,
      tools: tools || TOOLS,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 rounded-2xl rounded-tl-sm max-w-[80px]"
      style={{ background: 'var(--vx-bubble-ai)' }}>
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: 'var(--vx-text2)', animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function UserBubble({ text, images }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] flex flex-col gap-2 items-end">
        {images && images.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-end">
            {images.map((src, i) => (
              <img key={i} src={src} alt="" className="w-32 h-32 rounded-2xl object-cover border border-zinc-700" />
            ))}
          </div>
        )}
        {text && (
          <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm whitespace-pre-wrap"
            style={{ background: 'var(--vx-accent)', color: 'var(--vx-accent-fg)' }}>
            {text}
          </div>
        )}
      </div>
    </div>
  );
}

function AIBubble({ text, isError, agentEmoji }) {
  return (
    <div className="flex justify-start items-end gap-2">
      {/* Agent mini avatar */}
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mb-0.5 text-base"
        style={{ background: 'var(--vx-surface2)', border: '1px solid var(--vx-border)' }}>
        {agentEmoji || '✦'}
      </div>
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm whitespace-pre-wrap"
        style={{ background: isError ? '#7f1d1d' : 'var(--vx-bubble-ai)', color: isError ? '#fca5a5' : 'var(--vx-bubble-ai-txt)' }}>
        {text}
      </div>
    </div>
  );
}

function ToolCallChip({ toolName }) {
  const LABELS = {
    list_sops: 'Looking up SOPs',
    search_sops: 'Searching SOPs',
    list_builds: 'Fetching builds',
    list_departments: 'Loading departments',
    get_stock: 'Checking stock',
    show_form: 'Preparing form',
    navigate_to: 'Navigating',
    read_file: 'Reading file',
    write_file: 'Writing file',
    list_files: 'Listing files',
  };
  return (
    <div className="flex justify-start">
      <div className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5"
        style={{ background: 'var(--vx-surface2)', color: 'var(--vx-text2)' }}>
        <span className="animate-spin inline-block w-3 h-3 border border-current border-t-transparent rounded-full" />
        {LABELS[toolName] || toolName}…
      </div>
    </div>
  );
}

function ActionCard({ data, navigate, onClose }) {
  const { type, id, name, subtitle } = data;
  const ICONS = { build: '🔨', sop: '📝', department: '📁', navigate: '🔗' };
  const LABELS = { build: 'Build Created', sop: 'SOP Created', department: 'Department Created', navigate: 'Navigated' };
  const routes = { build: `/BuildDetail?id=${id}`, sop: `/SOPView?id=${id}`, department: `/WorkOrderPage?id=${id}` };

  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-tl-sm p-4 max-w-[85%] space-y-3 border"
        style={{ background: 'var(--vx-surface)', borderColor: 'var(--vx-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{ICONS[type] || '✅'}</span>
          <span className="text-xs font-medium" style={{ color: 'var(--vx-text2)' }}>{LABELS[type] || 'Done'}</span>
        </div>
        <p className="font-semibold text-sm" style={{ color: 'var(--vx-text)' }}>{name}</p>
        {subtitle && <p className="text-xs" style={{ color: 'var(--vx-text2)' }}>{subtitle}</p>}
        {routes[type] && (
          <button
            onClick={() => { navigate(routes[type]); onClose(); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'var(--vx-accent)', color: 'var(--vx-accent-fg)' }}>
            Open <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function SuggestionGrid({ contextKey, onSend }) {
  const suggestions = getContextSuggestions(contextKey);
  return (
    <div className="grid grid-cols-2 gap-2 mt-4 px-2">
      {suggestions.map((s, i) => (
        <button key={i} onClick={() => onSend(s.prompt)}
          className="flex flex-col items-start gap-1.5 p-3 rounded-2xl border text-left transition-opacity hover:opacity-80 active:scale-95"
          style={{ background: 'var(--vx-surface)', borderColor: 'var(--vx-border)' }}>
          <span className="text-xl">{s.icon}</span>
          <span className="text-xs font-medium leading-snug" style={{ color: 'var(--vx-text)' }}>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Form Sheet ───────────────────────────────────────────────────────────────

const VAN_MODELS = ['Sprinter 144', 'Sprinter 148', 'Sprinter 170', 'Transit 148', 'Transit 148HR', 'Promaster 136', 'Promaster 159', 'Other'];

function FormSheet({ pending, onSubmit, onCancel, departments }) {
  const { type, prefilled = {} } = pending;
  const [vals, setVals] = useState(prefilled);
  const set = (k, v) => setVals(p => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    if (type === 'create_build' && !vals.name?.trim()) return;
    if (type === 'create_sop' && !vals.title?.trim()) return;
    if (type === 'create_department' && !vals.name?.trim()) return;
    onSubmit(vals);
  };

  const TITLES = { create_build: 'New Build', create_sop: 'New SOP', create_department: 'New Department' };

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border-t px-5 pt-5 pb-8 space-y-4"
      style={{ background: 'var(--vx-surface)', borderColor: 'var(--vx-border)' }}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-bold text-base" style={{ color: 'var(--vx-text)' }}>{TITLES[type] || 'Fill in details'}</h3>
        <button onClick={onCancel} style={{ color: 'var(--vx-text2)' }}><X className="w-5 h-5" /></button>
      </div>

      {type === 'create_build' && (<>
        <Field label="Build name *" value={vals.name || ''} onChange={v => set('name', v)} placeholder="e.g. Jones Sprinter Build" highlight={!!prefilled.name} />
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--vx-text2)' }}>Van model</label>
          <select value={vals.van_model || ''} onChange={e => set('van_model', e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
            style={{ background: 'var(--vx-surface2)', color: 'var(--vx-text)', borderColor: 'var(--vx-border)' }}>
            <option value="">Select model…</option>
            {VAN_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <Field label="Customer name" value={vals.customer_name || ''} onChange={v => set('customer_name', v)} placeholder="Optional" highlight={!!prefilled.customer_name} />
      </>)}

      {type === 'create_sop' && (<>
        <Field label="SOP title *" value={vals.title || ''} onChange={v => set('title', v)} placeholder="e.g. Install Electrical Cabinet" highlight={!!prefilled.title} />
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--vx-text2)' }}>Department</label>
          <select value={vals.group || ''} onChange={e => set('group', e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
            style={{ background: 'var(--vx-surface2)', color: 'var(--vx-text)', borderColor: 'var(--vx-border)' }}>
            <option value="">Select department…</option>
            {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--vx-text2)' }}>Description</label>
          <textarea value={vals.description || ''} onChange={e => set('description', e.target.value)}
            placeholder="Brief description…" rows={2}
            className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none resize-none"
            style={{ background: 'var(--vx-surface2)', color: 'var(--vx-text)', borderColor: 'var(--vx-border)' }} />
        </div>
      </>)}

      {type === 'create_department' && (
        <Field label="Department name *" value={vals.name || ''} onChange={v => set('name', v)} placeholder="e.g. ⚡️ Electrical" highlight={!!prefilled.name} />
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={handleSubmit}
          className="flex-1 py-3 rounded-2xl text-sm font-bold transition-opacity hover:opacity-80"
          style={{ background: 'var(--vx-accent)', color: 'var(--vx-accent-fg)' }}>
          Create
        </button>
        <button onClick={onCancel}
          className="px-5 py-3 rounded-2xl text-sm border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--vx-border)', color: 'var(--vx-text2)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, highlight }) {
  return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--vx-text2)' }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
        style={{
          background: highlight ? 'color-mix(in srgb, var(--vx-accent) 12%, var(--vx-surface2))' : 'var(--vx-surface2)',
          color: 'var(--vx-text)', borderColor: highlight ? 'var(--vx-accent)' : 'var(--vx-border)',
        }} />
    </div>
  );
}

// ── Settings Panel ───────────────────────────────────────────────────────────

function SettingsPanel({ onClose, contextKey, buildMode, onToggleBuildMode }) {
  const { themeKey, setTheme, accent, setAccent, personality, setPersonality } = useTheme();
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border-t px-5 pt-5 pb-8 space-y-5"
      style={{ background: 'var(--vx-surface)', borderColor: 'var(--vx-border)' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-base" style={{ color: 'var(--vx-text)' }}>Chat Settings</h3>
        <button onClick={onClose} style={{ color: 'var(--vx-text2)' }}><X className="w-5 h-5" /></button>
      </div>

      {/* Theme */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--vx-text2)' }}>Theme</p>
        <div className="flex gap-2">
          {THEMES.map(t => (
            <button key={t.key} onClick={() => setTheme(t.key)}
              className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
              style={{
                background: themeKey === t.key ? 'var(--vx-accent)' : 'var(--vx-surface2)',
                color: themeKey === t.key ? 'var(--vx-accent-fg)' : 'var(--vx-text2)',
                borderColor: themeKey === t.key ? 'var(--vx-accent)' : 'var(--vx-border)',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent color (always visible) */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--vx-text2)' }}>Accent Color</p>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl border-2 cursor-pointer" style={{ background: accent, borderColor: 'var(--vx-border)' }} />
            <input type="color" value={accent} onChange={e => { setTheme('custom'); setAccent(e.target.value); }}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
          </div>
          <span className="text-sm" style={{ color: 'var(--vx-text2)' }}>Tap to open color wheel</span>
        </div>
      </div>

      {/* Personality */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--vx-text2)' }}>AI Personality</p>
        <div className="space-y-1.5">
          {PERSONALITIES.map(p => (
            <button key={p.key} onClick={() => setPersonality(p.key)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left"
              style={{
                background: personality === p.key ? 'color-mix(in srgb, var(--vx-accent) 15%, var(--vx-surface2))' : 'var(--vx-surface2)',
                borderColor: personality === p.key ? 'var(--vx-accent)' : 'var(--vx-border)',
              }}>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--vx-text)' }}>{p.label}</p>
                <p className="text-xs" style={{ color: 'var(--vx-text2)' }}>{p.desc}</p>
              </div>
              {personality === p.key && <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--vx-accent)' }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Build Mode */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--vx-text2)' }}>Build Mode</p>
        <button
          onClick={() => onToggleBuildMode(!buildMode)}
          className="w-full flex items-center justify-between px-3 py-3 rounded-xl border transition-all"
          style={{
            background: buildMode ? 'color-mix(in srgb, #a78bfa 15%, var(--vx-surface2))' : 'var(--vx-surface2)',
            borderColor: buildMode ? '#a78bfa' : 'var(--vx-border)',
          }}>
          <div className="flex items-center gap-2.5">
            <Code2 className="w-4 h-4" style={{ color: buildMode ? '#a78bfa' : 'var(--vx-text2)' }} />
            <div className="text-left">
              <p className="text-sm font-medium" style={{ color: 'var(--vx-text)' }}>Edit App Code</p>
              <p className="text-xs" style={{ color: 'var(--vx-text2)' }}>Let Jarvis modify this app's source files</p>
            </div>
          </div>
          <div className={`w-10 h-5.5 rounded-full transition-colors relative flex-shrink-0`}
            style={{ width: 40, height: 22, background: buildMode ? '#a78bfa' : 'var(--vx-surface2)', border: `1px solid ${buildMode ? '#a78bfa' : 'var(--vx-border)'}` }}>
            <div className="absolute top-0.5 rounded-full transition-all"
              style={{ width: 18, height: 18, background: buildMode ? '#fff' : 'var(--vx-muted)', left: buildMode ? 20 : 2 }} />
          </div>
        </button>
      </div>

      {/* Clear history */}
      <button onClick={() => { clearHistory(contextKey); onClose(); window.location.reload(); }}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
        style={{ borderColor: '#7f1d1d', color: '#f87171' }}>
        <Trash2 className="w-4 h-4" /> Clear chat history
      </button>
    </div>
  );
}

// ── Voice Mode ───────────────────────────────────────────────────────────────
// Hands-free spoken conversation: Web Speech recognition (listen) → Claude →
// speech synthesis (Jarvis talks back) → listen again. Shares the chat's history
// via `seedApi` (snapshot at open) and writes each turn back through `onTurn`.

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

function pickVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices() || [];
  if (!voices.length) return null;
  // Prefer a polished English voice; fall back to any English, then the first.
  const prefer = ['Google UK English Male', 'Daniel', 'Google US English', 'Samantha', 'Alex'];
  for (const name of prefer) {
    const v = voices.find(x => x.name === name);
    if (v) return v;
  }
  return voices.find(v => /^en[-_]/i.test(v.lang)) || voices[0];
}

function VoiceMode({ name, emoji, systemPrompt, model, seedApi, onTurn, onClose }) {
  const [status, setStatus] = useState('connecting'); // connecting|listening|thinking|speaking|unsupported
  const [transcript, setTranscript] = useState('');    // what the user is saying now
  const [lastReply, setLastReply] = useState('');      // Jarvis's latest spoken line

  const activeRef = useRef(true);
  const statusRef = useRef('connecting');
  const recRef = useRef(null);
  const finalRef = useRef('');
  const workingApi = useRef([...(seedApi || [])]);
  const voiceRef = useRef(null);
  const voiceSystem = useRef(buildVoiceSystemPrompt(systemPrompt));

  const setStat = useCallback((s) => { statusRef.current = s; setStatus(s); }, []);

  const startListening = useCallback(() => {
    if (!activeRef.current || !SpeechRecognitionImpl) return;
    let rec;
    try { rec = new SpeechRecognitionImpl(); } catch { return; }
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = '';
    setTranscript('');
    setStat('listening');

    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      if (final) finalRef.current = final;
      setTranscript((finalRef.current || interim).trim());
    };
    rec.onerror = () => {}; // onend handles recovery
    rec.onend = () => {
      if (!activeRef.current || statusRef.current !== 'listening') return;
      const text = finalRef.current.trim();
      if (text) handleUtterance(text);
      else startListening(); // silence — keep the mic open
    };
    recRef.current = rec;
    try { rec.start(); } catch {}
  }, [setStat]);

  const speak = useCallback((text) => {
    setLastReply(text);
    setStat('speaking');
    const synth = window.speechSynthesis;
    if (!synth) { startListening(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 1.02; u.pitch = 1.0;
    u.onend = () => { if (activeRef.current) startListening(); };
    u.onerror = () => { if (activeRef.current) startListening(); };
    synth.speak(u);
  }, [setStat, startListening]);

  const handleUtterance = useCallback(async (text) => {
    setStat('thinking');
    setTranscript(text);
    workingApi.current = [...workingApi.current, { role: 'user', content: text }];
    try {
      const resp = await callClaude(workingApi.current, voiceSystem.current, [], model);
      const reply = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
        || "Sorry, I didn't catch that.";
      workingApi.current = [...workingApi.current, { role: 'assistant', content: reply }];
      onTurn?.(text, reply);
      if (activeRef.current) speak(reply);
    } catch {
      if (activeRef.current) speak('Something went wrong reaching the server.');
    }
  }, [model, onTurn, speak, setStat]);

  // Boot: load voices, greet, then listen.
  useEffect(() => {
    activeRef.current = true;
    if (!SpeechRecognitionImpl) { setStat('unsupported'); return; }

    const loadVoice = () => { voiceRef.current = pickVoice(); };
    loadVoice();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoice;

    const greeting = `Hey, I'm ${name || 'Jarvis'}. I'm listening — what do you need?`;
    const t = setTimeout(() => { if (activeRef.current) speak(greeting); }, 350);

    return () => {
      activeRef.current = false;
      clearTimeout(t);
      try { recRef.current?.abort?.(); } catch {}
      try { recRef.current?.stop?.(); } catch {}
      try { window.speechSynthesis?.cancel(); } catch {}
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
  }, [name, speak, setStat]);

  const STATUS_LABEL = {
    connecting: 'Connecting…',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    unsupported: 'Voice not supported',
  };

  const orbScale = status === 'speaking' ? [1, 1.18, 1] : status === 'listening' ? [1, 1.08, 1] : 1;
  const orbDur = status === 'speaking' ? 0.6 : 1.6;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-between py-16 px-6"
      style={{ background: 'radial-gradient(ellipse at 50% 35%, #0d1a2e 0%, #05070d 70%, #000 100%)' }}>
      {/* Title */}
      <div className="flex flex-col items-center gap-1">
        <p className="text-white/90 text-lg font-semibold tracking-wide">{name || 'Jarvis'}</p>
        <p className="text-sky-300/70 text-sm">{STATUS_LABEL[status]}</p>
      </div>

      {/* Orb */}
      <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
        <motion.div
          className="absolute rounded-full pointer-events-none"
          animate={{ opacity: status === 'thinking' ? [0.3, 0.6, 0.3] : [0.35, 0.7, 0.35], scale: [1, 1.3, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: 220, height: 220, background: 'radial-gradient(circle, rgba(56,189,248,0.55), transparent 70%)', filter: 'blur(24px)' }}
        />
        <motion.div
          animate={{ scale: orbScale }}
          transition={{ duration: orbDur, repeat: Infinity, ease: 'easeInOut' }}
          className="rounded-full flex items-center justify-center relative"
          style={{
            width: 150, height: 150,
            background: 'radial-gradient(circle at 35% 28%, rgba(186,230,253,0.95), rgba(2,132,199,0.95))',
            boxShadow: '0 0 60px rgba(56,189,248,0.7), inset 0 3px 0 rgba(255,255,255,0.6), inset 0 -3px 8px rgba(3,70,120,0.55)',
            border: '1px solid rgba(186,230,253,0.4)',
          }}>
          <span style={{ fontSize: 56 }}>{emoji || '🤖'}</span>
        </motion.div>
      </div>

      {/* Captions */}
      <div className="w-full max-w-md min-h-[96px] flex flex-col items-center justify-end gap-3 text-center">
        {status === 'unsupported' ? (
          <p className="text-white/60 text-sm leading-relaxed">
            Live voice needs the Web Speech API — open the app in Chrome (desktop or Android) to talk to {name || 'Jarvis'}.
            You can still type in the chat.
          </p>
        ) : (
          <>
            {lastReply && <p className="text-white/85 text-base leading-snug">{lastReply}</p>}
            {transcript && <p className="text-sky-300/80 text-sm italic">“{transcript}”</p>}
          </>
        )}
      </div>

      {/* End call */}
      <button
        onClick={onClose}
        aria-label="End voice session"
        className="w-16 h-16 rounded-full flex items-center justify-center active:scale-90 transition-transform"
        style={{ background: '#dc2626', boxShadow: '0 8px 24px rgba(220,38,38,0.5)' }}
      >
        <PhoneOff className="w-7 h-7 text-white" />
      </button>
    </div>
  );
}

// ── Main VertexChat ──────────────────────────────────────────────────────────

export default function VertexChat({ isOpen, onClose }) {
  const navigate = useNavigate();
  const { personality } = useTheme();
  const { agentPrompt, agentName, agentEmoji, model, setModel } = useVertexChat();

  const contextKey = agentPrompt ? `agent_${agentName}` : getContextKey();
  const contextLabel = agentName || getContextLabel(contextKey);
  const greeting = agentName ? `Hey! I'm ${agentName} ${agentEmoji || ''}` : getContextGreeting(contextKey);

  const [displayMsgs, setDisplayMsgs] = useState(() => loadDisplay(contextKey));
  const [apiMsgs, setApiMsgs] = useState(() => loadApi(contextKey));

  // Reload messages when switching agents
  const prevContextKey = React.useRef(contextKey);
  React.useEffect(() => {
    if (prevContextKey.current !== contextKey) {
      prevContextKey.current = contextKey;
      setDisplayMsgs(loadDisplay(contextKey));
      setApiMsgs(loadApi(contextKey));
      setInput('');
    }
  }, [contextKey]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingForm, setPendingForm] = useState(null);
  const [pendingImages, setPendingImages] = useState([]); // [{dataUrl, mediaType}]
  const [departments, setDepartments] = useState([]);
  const [buildMode, setBuildMode] = useState(() => localStorage.getItem('vx_build_mode') === 'true');
  const [voiceOpen, setVoiceOpen] = useState(false);

  const toggleBuildMode = (v) => {
    setBuildMode(v);
    localStorage.setItem('vx_build_mode', v ? 'true' : 'false');
  };

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const recognitionRef = useRef(null);
  const formResolveRef = useRef(null);

  // A proxy object so execTool can call setPendingForm
  const formResolve = {
    current: null,
    setPending: (f) => setPendingForm(f),
  };
  formResolve.current = formResolveRef.current;

  // Preload departments for forms
  useEffect(() => {
    localClient.entities.WorkOrder.filter().then(setDepartments).catch(() => {});
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [displayMsgs, loading, isOpen]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input]);

  const persistMessages = useCallback((display, api) => {
    setDisplayMsgs(display);
    setApiMsgs(api);
    saveDisplay(contextKey, display);
    saveApi(contextKey, api);
  }, [contextKey]);

  // Record one spoken turn (user + Jarvis) into the shared chat history so the
  // text transcript stays in sync with the voice conversation.
  const commitVoiceTurn = useCallback((userText, aiText) => {
    const stamp = Date.now();
    setDisplayMsgs(prev => {
      const next = [...prev,
        { id: stamp + 'vu', type: 'user', text: userText },
        { id: stamp + 'va', type: 'ai', text: aiText }];
      saveDisplay(contextKey, next);
      return next;
    });
    setApiMsgs(prev => {
      const next = [...prev,
        { role: 'user', content: userText },
        { role: 'assistant', content: aiText }];
      saveApi(contextKey, next);
      return next;
    });
  }, [contextKey]);

  // Base prompt for voice mode (agent persona or the contextual Jarvis prompt;
  // never Build Mode — voice shouldn't edit source).
  const voiceBasePrompt = agentPrompt || buildSystemPrompt(contextKey, personality);

  // Form submitted
  const handleFormSubmit = async (formData) => {
    const { type } = pendingForm;
    try {
      let record, actionCard;
      const user = await localClient.auth.me();

      if (type === 'create_build') {
        record = await localClient.entities.Build.create({
          name: formData.name, van_model: formData.van_model, customer_name: formData.customer_name,
          company_id: user.company_id, parts: [],
        });
        actionCard = { type: 'build', id: record.id, name: record.name, subtitle: record.van_model };
      } else if (type === 'create_sop') {
        record = await localClient.entities.SOP.create({
          title: formData.title, group: formData.group, description: formData.description,
          company_id: user.company_id, steps: [], materials: [],
        });
        actionCard = { type: 'sop', id: record.id, name: record.title, subtitle: record.group };
      } else if (type === 'create_department') {
        record = await localClient.entities.WorkOrder.create({
          name: formData.name, company_id: user.company_id,
        });
        actionCard = { type: 'department', id: record.id, name: record.name };
      }

      setPendingForm(null);
      formResolveRef.current?.({ success: true, ...record });
      formResolveRef.current = null;

      // Add action card to display
      if (actionCard) {
        setDisplayMsgs(prev => {
          const next = [...prev, { id: Date.now().toString(), type: 'action', data: actionCard }];
          saveDisplay(contextKey, next);
          return next;
        });
      }
    } catch (err) {
      setPendingForm(null);
      formResolveRef.current?.({ error: err.message });
      formResolveRef.current = null;
    }
  };

  const handleFormCancel = () => {
    setPendingForm(null);
    formResolveRef.current?.({ cancelled: true });
    formResolveRef.current = null;
  };

  // Send message
  const sendMessage = async (text) => {
    const msg = (text || input).trim();
    if ((!msg && pendingImages.length === 0) || loading) return;
    setInput('');
    const images = [...pendingImages];
    setPendingImages([]);

    const userDisplay = { id: Date.now().toString(), type: 'user', text: msg, images: images.map(i => i.dataUrl) };
    const newDisplay = [...displayMsgs, userDisplay];

    // Build Claude content array — images first, then text
    const contentParts = [
      ...images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      })),
      ...(msg ? [{ type: 'text', text: msg }] : [{ type: 'text', text: 'Please analyze this image.' }]),
    ];
    const userApiMsg = { role: 'user', content: images.length > 0 ? contentParts : msg };
    const newApi = [...apiMsgs, userApiMsg];
    persistMessages(newDisplay, newApi);
    setLoading(true);

    const activeTools = buildMode ? [...TOOLS, ...DEV_TOOLS] : TOOLS;
    const systemPrompt = agentPrompt
      ? agentPrompt
      : buildMode ? buildDevSystemPrompt(personality) : buildSystemPrompt(contextKey, personality);

    try {
      let currentApi = [...newApi];
      let currentDisplay = [...newDisplay];

      while (true) {
        const activeModel = buildMode ? 'claude-sonnet-4-6' : model;
        const resp = await callClaude(currentApi, systemPrompt, activeTools, activeModel);

        if (resp.stop_reason === 'tool_use') {
          const toolBlocks = resp.content.filter(b => b.type === 'tool_use');
          const textBlocks = resp.content.filter(b => b.type === 'text');

          // Show tool chips + any partial text
          const chips = toolBlocks.map(t => ({ id: t.id + '_chip', type: 'tool', toolName: t.name }));
          if (textBlocks.length > 0) {
            currentDisplay = [...currentDisplay, { id: Date.now() + 'txt', type: 'ai', text: textBlocks.map(b => b.text).join('') }];
          }
          currentDisplay = [...currentDisplay, ...chips];
          setDisplayMsgs(currentDisplay);

          // Execute tools (sequentially for show_form which needs user input)
          const toolResults = [];
          for (const block of toolBlocks) {
            // Set up form resolve if needed
            if (block.name === 'show_form') {
              formResolveRef.current = null;
              const result = await new Promise(resolve => {
                formResolveRef.current = resolve;
                setPendingForm({ type: block.input.form_type, prefilled: block.input.prefilled || {} });
              });
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
            } else {
              const result = await execTool(block.name, block.input, { formResolve, navigate });
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
            }
          }

          // Remove chips, add to api history
          currentDisplay = currentDisplay.filter(m => !chips.some(c => c.id === m.id));
          setDisplayMsgs(currentDisplay);
          currentApi = [
            ...currentApi,
            { role: 'assistant', content: resp.content },
            { role: 'user', content: toolResults },
          ];
        } else {
          // Final response
          const finalText = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
          if (finalText) {
            currentDisplay = [...currentDisplay, { id: Date.now().toString(), type: 'ai', text: finalText }];
          }
          currentApi = [...currentApi, { role: 'assistant', content: resp.content }];
          persistMessages(currentDisplay, currentApi);
          break;
        }
      }
    } catch (err) {
      const errDisplay = [...displayMsgs, userDisplay, { id: Date.now().toString(), type: 'ai', text: `Something went wrong: ${err.message}`, isError: true }];
      persistMessages(errDisplay, newApi);
    } finally {
      setLoading(false);
    }
  };

  // Voice input
  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('');
      setInput(t);
    };
    rec.onend = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div
        className="fixed left-0 right-0 bottom-16 z-50 rounded-t-3xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--vx-bg)',
          maxHeight: '85vh',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--vx-surface2)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--vx-border)' }}>
          {/* Agent avatar — pulsing presence */}
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden"
              style={{
                background: agentEmoji ? 'radial-gradient(circle at 35% 35%, #2a2a2a, #111)' : 'transparent',
                boxShadow: agentEmoji ? '0 0 12px rgba(139,92,246,0.3)' : 'none',
              }}>
              {agentEmoji
                ? <span className="text-xl">{agentEmoji}</span>
                : <img src={vertexLogo} alt="Vertex" className="w-7 h-7 object-contain" />
              }
            </div>
            {/* Live dot */}
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2"
              style={{ borderColor: 'var(--vx-bg)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold truncate" style={{ color: 'var(--vx-text)' }}>
                {agentName || 'Jarvis'}
              </p>
              {buildMode && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                  style={{ background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa44' }}>
                  BUILD
                </span>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--vx-text2)' }}>
              {loading ? 'typing...' : 'online'}
            </p>
          </div>
          {/* Model toggle */}
          {!buildMode && (
            <button
              onClick={() => setModel(model === 'claude-haiku-4-5' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all"
              style={{
                background: model === 'claude-sonnet-4-6' ? '#a78bfa22' : 'var(--vx-surface2)',
                color: model === 'claude-sonnet-4-6' ? '#a78bfa' : 'var(--vx-text2)',
                border: `1px solid ${model === 'claude-sonnet-4-6' ? '#a78bfa44' : 'var(--vx-border)'}`,
              }}
              title={model === 'claude-haiku-4-5' ? 'Switch to Sonnet (smarter, slower)' : 'Switch to Haiku (faster)'}
            >
              {model === 'claude-haiku-4-5' ? 'Haiku' : 'Sonnet'}
            </button>
          )}
          <button onClick={() => setVoiceOpen(true)} title="Talk to Jarvis"
            className="p-2 rounded-xl hover:opacity-70 transition-opacity"
            style={{ color: 'var(--vx-accent)' }}>
            <AudioLines className="w-[18px] h-[18px]" />
          </button>
          <button onClick={() => setShowSettings(v => !v)} className="p-2 rounded-xl hover:opacity-70 transition-opacity"
            style={{ color: 'var(--vx-text2)' }}>
            <Settings className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          </button>
          <button onClick={onClose} className="p-2 rounded-xl hover:opacity-70 transition-opacity"
            style={{ color: 'var(--vx-text2)' }}>
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
          {displayMsgs.length === 0 && (
            <div className="text-center pt-6 pb-2">
              <img src={vertexLogo} alt="Vertex" className="w-14 h-14 object-contain mx-auto mb-3 rounded-2xl opacity-80" />
              <p className="text-sm font-semibold" style={{ color: 'var(--vx-text)' }}>Jarvis</p>
              <p className="text-xs mt-1 px-6" style={{ color: 'var(--vx-text2)' }}>{greeting}</p>
              <SuggestionGrid contextKey={contextKey} onSend={sendMessage} />
            </div>
          )}

          {displayMsgs.map((msg) => {
            if (msg.type === 'user') return <UserBubble key={msg.id} text={msg.text} images={msg.images} />;
            if (msg.type === 'ai') return <AIBubble key={msg.id} text={msg.text} isError={msg.isError} agentEmoji={agentEmoji} />;
            if (msg.type === 'tool') return <ToolCallChip key={msg.id} toolName={msg.toolName} />;
            if (msg.type === 'action') return <ActionCard key={msg.id} data={msg.data} navigate={navigate} onClose={onClose} />;
            return null;
          })}

          {loading && !pendingForm && (
            <div className="flex justify-start"><TypingDots /></div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t flex-shrink-0" style={{ borderColor: 'var(--vx-border)' }}>
          {/* Image previews */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img.dataUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-zinc-700" />
                  <button onClick={() => setPendingImages(p => p.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center text-gray-300 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {/* Image upload */}
            <input type="file" id="chat-img-upload" accept="image/*" multiple className="hidden"
              onChange={e => {
                Array.from(e.target.files).forEach(file => {
                  const reader = new FileReader();
                  reader.onload = ev => {
                    const dataUrl = ev.target.result;
                    const data = dataUrl.split(',')[1];
                    const mediaType = file.type;
                    setPendingImages(p => [...p, { dataUrl, data, mediaType }]);
                  };
                  reader.readAsDataURL(file);
                });
                e.target.value = '';
              }} />
            <button onClick={() => document.getElementById('chat-img-upload').click()}
              className="p-2.5 rounded-2xl flex-shrink-0 transition-all"
              style={{ background: 'var(--vx-surface)', color: 'var(--vx-text2)', border: '1px solid var(--vx-border)' }}>
              <ImagePlus className="w-4 h-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Message Jarvis…"
              rows={1}
              disabled={loading}
              className="flex-1 rounded-2xl px-4 py-2.5 text-sm border focus:outline-none resize-none"
              style={{
                background: 'var(--vx-surface)',
                color: 'var(--vx-text)',
                borderColor: 'var(--vx-border)',
                maxHeight: '120px',
                lineHeight: '1.4',
              }}
            />
            <button onClick={toggleMic}
              className={`p-2.5 rounded-2xl transition-all flex-shrink-0 ${isListening ? 'animate-pulse' : ''}`}
              style={{
                background: isListening ? 'var(--vx-accent)' : 'var(--vx-surface)',
                color: isListening ? 'var(--vx-accent-fg)' : 'var(--vx-text2)',
                border: `1px solid var(--vx-border)`,
              }}>
              {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
            <button onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && pendingImages.length === 0)}
              className="p-2.5 rounded-2xl flex-shrink-0 transition-opacity disabled:opacity-30"
              style={{ background: 'var(--vx-accent)', color: 'var(--vx-accent-fg)' }}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Settings overlay */}
        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            contextKey={contextKey}
            buildMode={buildMode}
            onToggleBuildMode={toggleBuildMode}
          />
        )}

        {/* Form overlay */}
        {pendingForm && (
          <FormSheet
            pending={pendingForm}
            onSubmit={handleFormSubmit}
            onCancel={handleFormCancel}
            departments={departments}
          />
        )}
      </div>

      {/* Voice Mode — full-screen spoken conversation */}
      {voiceOpen && (
        <VoiceMode
          name={agentName || 'Jarvis'}
          emoji={agentEmoji}
          systemPrompt={voiceBasePrompt}
          model={model}
          seedApi={apiMsgs}
          onTurn={commitVoiceTurn}
          onClose={() => setVoiceOpen(false)}
        />
      )}
    </>
  );
}
