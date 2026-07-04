import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X, Settings, Mic, MicOff, Send, Trash2, ChevronRight, Check, ImagePlus, AudioLines, PhoneOff, Hammer, ExternalLink } from 'lucide-react';
import JarvisBuild, { ApprovalModal } from '@/components/JarvisBuild';
import { runAgentTask, approveAgentCommand, isAgentConfigured, REPO_WEB } from '@/api/jarvisAgent';
import { localClient } from '@/api/localDb';
import { supabase } from '@/api/supabaseClient';
import { useTheme, THEMES, PERSONALITIES } from '@/lib/ThemeContext';
import { useVertexChat } from '@/lib/VertexChatContext';
import {
  loadDisplay, loadApi, saveDisplay, saveApi, clearHistory,
  getContextKey, getContextLabel, getContextGreeting, getContextSuggestions,
} from '@/lib/vertexChatStorage';
import vertexLogo from '@/assets/Vertex-logo.webp';

// ── System prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(contextKey, personality) {
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

  return `You are Jarvis — Stephan's one personal AI. ${tone}

${ctx}

You are a single entity, and you present as ONE Jarvis (never refer to "the other Jarvis" or "a developer"). You are aware of EVERYTHING Stephan has made in this app:
1. Assistant: help manage van builds (phases, tasks, parts), SOPs, inventory/parts stock, and contacts — using your tools.
2. Memory of his creations: he builds AI Rooms and agents inside this app, and talks to them. You can see all of it — use list_rooms, list_agents (their names, emojis, descriptions, and persona prompts), and get_conversation (what was said with an agent). Whenever he asks what he's made, what an agent is/does, or to recall a conversation, look it up with these tools rather than guessing or saying you can't see it. The data is live, so you're always up to date.
3. Engineer: you can change THIS app's own code and deploy it. When Stephan asks to add a feature, change the UI, fix a bug, or modify how the app works, use the build_app tool. Your engineering work streams right into this same chat. Never claim you can't code — you can; use build_app.

When the user wants to create a record, use the show_form tool — prefill any fields you already know.
When you navigate somewhere or create a record, a card will appear automatically — just describe what you did concisely.
For lists, be brief. Lead with the most relevant item.`;
}

// Wraps the normal prompt with voice-conversation rules: short, spoken-friendly,
// no markdown. Used by the live Voice Mode (speech in, speech out).
export function buildVoiceSystemPrompt(base) {
  return `${base}

You are in a live VOICE conversation — the user is speaking to you and your reply is read aloud. Keep answers short and natural for the ear: usually one to three sentences. Plain spoken language only — no markdown, no bullet lists, no headings, no emoji, no code blocks. If something genuinely needs detail, give the gist and offer to go deeper. Be warm, quick, and direct.`;
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS = [
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
        page: { type: 'string', enum: ['Builds', 'SOPList', 'PartsLibrary', 'Contacts', 'Inventory', 'Rooms'] },
      },
    },
  },
  {
    name: 'list_rooms',
    description: "List the AI Rooms the user has created (name, color, attached app). Use to know what rooms exist.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_agents',
    description: "List the AI agents the user created — their name, emoji, description, and persona prompt. Optionally filter by room name. Use whenever the user asks about agents they've made or what an agent does.",
    input_schema: { type: 'object', properties: { room: { type: 'string', description: 'Optional room name to filter by' } } },
  },
  {
    name: 'get_conversation',
    description: "Read recent conversation history with one of the user's agents by its exact name (or 'vertex' for the default assistant). Use to recall what was discussed in a room/with an agent.",
    input_schema: { type: 'object', required: ['agent_name'], properties: { agent_name: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'build_app',
    description: "Build, change, fix, or add to THIS app's own code, then deploy it. Use whenever the user wants a new feature, a UI change, a bug fix, or any modification to how the app itself works (not data inside it). You and the build engine are the same Jarvis — hand it a complete, specific instruction and its work streams into this chat. Don't say you can't code; use this.",
    input_schema: {
      type: 'object',
      required: ['task'],
      properties: {
        task: { type: 'string', description: 'A complete, specific instruction of what to build or change in the app.' },
      },
    },
  },
];

// ── Tool executor ────────────────────────────────────────────────────────────

export async function execTool(name, input, { formResolve, navigate }) {
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
    case 'list_rooms': {
      const { data } = await supabase.from('ai_rooms').select('id, name, color, app').order('created_at');
      return (data || []).map(r => ({ id: r.id, name: r.name, app: r.app || null }));
    }
    case 'list_agents': {
      const { data: agents } = await supabase.from('ai_agents').select('name, emoji, description, prompt, room_id').order('created_at');
      let rows = agents || [];
      if (input.room) {
        const { data: rooms } = await supabase.from('ai_rooms').select('id, name');
        const match = (rooms || []).find(r => r.name?.toLowerCase() === input.room.toLowerCase());
        rows = match ? rows.filter(a => a.room_id === match.id) : [];
      }
      return rows.map(a => ({ name: a.name, emoji: a.emoji, description: a.description, prompt: (a.prompt || '').slice(0, 600) }));
    }
    case 'get_conversation': {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { error: 'Not signed in — conversation history is per account.' };
      const { data } = await supabase.from('chat_history')
        .select('role, text, created_at')
        .eq('user_id', user.id)
        .eq('agent_name', input.agent_name)
        .order('created_at', { ascending: false })
        .limit(Math.min(input.limit || 30, 100));
      return (data || []).reverse().map(r => ({ role: r.role, text: r.text }));
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── API call ─────────────────────────────────────────────────────────────────

// Cache API key in memory so we don't hit Supabase on every message
let _cachedAnthropicKey = null;

export async function callClaude(messages, systemPrompt, tools, model = 'claude-haiku-4-5') {
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

  // `tools === undefined` → default TOOLS; an explicit `[]` → omit tools entirely
  // (the API rejects an empty tools array, and tools-less is what voice wants).
  const toolList = tools === undefined ? TOOLS : tools;
  const body = { model, max_tokens: 8096, system: systemPrompt, messages };
  if (toolList && toolList.length) body.tools = toolList;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
  }
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
    list_rooms: 'Checking your rooms',
    list_agents: 'Checking your agents',
    get_conversation: 'Reading the conversation',
    build_app: 'Building',
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

// Result card for a coding/deploy task run by the Jarvis Agent.
function DeployCard({ m }) {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-tl-sm p-4 max-w-[88%] space-y-2 border"
        style={{ background: 'var(--vx-surface)', borderColor: 'var(--vx-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🚀</span>
          <span className="text-xs font-medium" style={{ color: 'var(--vx-text2)' }}>{m.changed ? 'Built & deployed' : 'Done'}</span>
        </div>
        {m.text && <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--vx-text)' }}>{m.text}</p>}
        {m.changed && m.branch && m.branch !== 'main' && (
          <a href={`${REPO_WEB}/tree/${m.branch}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--vx-accent)' }}>
            <ExternalLink className="w-3.5 h-3.5" /> Preview: {m.branch} (Vercel is building it)
          </a>
        )}
        {m.changed && m.branch === 'main' && <p className="text-xs" style={{ color: 'var(--vx-accent)' }}>Pushed to main — deploying live.</p>}
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

function SettingsPanel({ onClose, contextKey }) {
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

export function pickVoice() {
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

function VoiceMode({ name, emoji, systemPrompt, model, seedApi, onTurn, onBuildTask, onClose }) {
  const [status, setStatus] = useState('connecting'); // connecting|listening|thinking|speaking|unsupported|blocked
  const [transcript, setTranscript] = useState('');    // what the user is saying now
  const [lastReply, setLastReply] = useState('');      // Jarvis's latest spoken line

  // Latest props for the long-lived loop without re-running the effect.
  const onTurnRef = useRef(onTurn); onTurnRef.current = onTurn;
  const onBuildRef = useRef(onBuildTask); onBuildRef.current = onBuildTask;
  const modelRef = useRef(model);   modelRef.current = model;

  // The whole conversation loop lives in one effect with stable local closures —
  // ONE persistent recognizer (continuous), so there's no start/stop race.
  useEffect(() => {
    let active = true;
    const SR = SpeechRecognitionImpl;
    if (!SR) { setStatus('unsupported'); return; }

    // Seed from chat history, but flatten to plain text and drop tool_use /
    // tool_result blocks — sending those without a `tools` definition 400s. Also
    // merge consecutive same-role turns and ensure we start with a user turn.
    const toText = (c) => typeof c === 'string'
      ? c
      : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join(' ').trim() : '';
    const workingApi = [];
    for (const m of (seedApi || [])) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const text = toText(m.content);
      if (!text) continue;
      const last = workingApi[workingApi.length - 1];
      if (last && last.role === m.role) last.content += `\n${text}`;
      else workingApi.push({ role: m.role, content: text });
    }
    while (workingApi.length && workingApi[0].role !== 'user') workingApi.shift();

    const voiceSystem = buildVoiceSystemPrompt(systemPrompt);
    // Voice can build + recall everything Stephan made; nothing UI-bound (no forms).
    const voiceToolNames = new Set(['build_app', 'list_rooms', 'list_agents', 'get_conversation']);
    const voiceTools = TOOLS.filter(t => voiceToolNames.has(t.name));
    let voice = pickVoice();
    const onVoices = () => { voice = pickVoice(); };
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = onVoices;

    let mode = 'idle';   // idle|listening|thinking|speaking|blocked
    let rec = null;
    let pending = '';    // finalized speech awaiting send
    let interimTxt = ''; // in-flight (not yet final) speech
    let silenceTimer = null;

    async function handleUtterance(text) {
      mode = 'thinking';
      if (active) { setStatus('thinking'); setTranscript(text); }
      clearTimeout(silenceTimer);
      try { rec && rec.stop(); } catch {} // pause the mic while we think + speak
      workingApi.push({ role: 'user', content: text });
      try {
        // Loop so a spoken request can trigger a build (build_app tool), then
        // speak the result — the build's progress streams into the shared chat.
        for (let guard = 0; guard < 6; guard++) {
          const resp = await callClaude(workingApi, voiceSystem, voiceTools, modelRef.current);
          if (resp.stop_reason === 'tool_use') {
            workingApi.push({ role: 'assistant', content: resp.content });
            const results = [];
            for (const b of resp.content.filter(x => x.type === 'tool_use')) {
              if (b.name === 'build_app' && onBuildRef.current) {
                if (active) { setStatus('thinking'); setLastReply(`Building: ${b.input.task}`); }
                const summary = await onBuildRef.current(b.input.task);
                results.push({ type: 'tool_result', tool_use_id: b.id, content: summary });
              } else {
                const out = await execTool(b.name, b.input, {});
                results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
              }
            }
            workingApi.push({ role: 'user', content: results });
            continue;
          }
          const reply = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
            || "Sorry, I didn't catch that — could you say it again?";
          workingApi.push({ role: 'assistant', content: reply });
          onTurnRef.current?.(text, reply);
          if (active) speak(reply);
          break;
        }
      } catch (err) {
        const detail = err?.message || 'unknown error';
        const spoken = /api key/i.test(detail)
          ? "I need an Anthropic API key set in the app's Settings before I can answer."
          : "Something went wrong reaching the server. Check the connection and try again.";
        // Show the raw error on screen (not spoken) so failures are diagnosable.
        if (active) { setLastReply(`${spoken}\n\n${detail}`); speak(spoken); }
      }
    }

    function trySend() {
      const text = `${pending} ${interimTxt}`.trim();
      if (text && mode === 'listening') { pending = ''; interimTxt = ''; handleUtterance(text); }
    }

    function ensureRec() {
      if (rec) return rec;
      rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = '', finalChunk = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalChunk += t; else interim += t;
        }
        if (finalChunk) pending = `${pending} ${finalChunk}`.trim();
        interimTxt = interim;
        if (active) setTranscript(`${pending} ${interim}`.trim());
        // Send once the user pauses (~1.1s with no new words).
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(trySend, 1100);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          mode = 'blocked';
          if (active) setStatus('blocked');
        }
        // no-speech / aborted / network → onend recovers
      };
      rec.onend = () => {
        if (active && mode === 'listening') { try { rec.start(); } catch {} }
      };
      return rec;
    }

    function startListening() {
      if (!active) return;
      mode = 'listening';
      pending = ''; interimTxt = '';
      if (active) { setStatus('listening'); setTranscript(''); }
      const r = ensureRec();
      try { r.start(); } catch {} // throws if already running — harmless
    }

    function speak(text) {
      mode = 'speaking';
      if (active) { setStatus('speaking'); setLastReply(text); }
      const synth = window.speechSynthesis;
      if (!synth) { startListening(); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.02;
      let done = false;
      const finish = () => { if (done) return; done = true; if (active) startListening(); };
      u.onend = finish;
      u.onerror = finish;
      // Chrome sometimes never fires onend — fall back on a length-based timer.
      setTimeout(finish, Math.min(20000, 1600 + text.length * 60));
      synth.speak(u);
    }

    const greeting = `Hey, I'm ${name || 'Jarvis'}. I'm listening — what do you need?`;
    const bootT = setTimeout(() => { if (active) speak(greeting); }, 350);

    return () => {
      active = false;
      clearTimeout(bootT);
      clearTimeout(silenceTimer);
      try { rec && rec.abort(); } catch {}
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
      if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const STATUS_LABEL = {
    connecting: 'Connecting…',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    unsupported: 'Voice not supported',
    blocked: 'Microphone blocked',
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
        ) : status === 'blocked' ? (
          <p className="text-white/70 text-sm leading-relaxed">
            Your browser blocked the microphone. Click the camera/mic icon in the address bar, choose
            “Always allow”, then close and reopen voice.
          </p>
        ) : (
          <>
            {lastReply && <p className="text-white/85 text-base leading-snug whitespace-pre-line">{lastReply}</p>}
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
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null); // { id, command }
  const [approvalPassword, setApprovalPassword] = useState('');
  const agentSessionRef = useRef(null); // continuity with the coding engine

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

  // Run a coding task on the Jarvis Agent and stream it INTO this chat, so the
  // build engine and the conversational Jarvis share one transcript + history.
  // Returns a short summary string for the model's tool_result. Used by both the
  // text tool loop and voice mode.
  const runBuildTask = useCallback(async (task, addMessage) => {
    // Default sink: append to chat state + persist. The text loop passes its own
    // sink so the messages stay in its working array (which it persists at the end).
    const add = addMessage || ((m) => setDisplayMsgs(prev => {
      const next = [...prev, { id: `${Date.now()}-${Math.random()}`, ...m }];
      saveDisplay(contextKey, next);
      return next;
    }));
    if (!isAgentConfigured()) {
      const msg = "Build isn't connected yet. Tap the hammer icon to add your agent URL + secret, then ask me again.";
      add({ type: 'ai', text: msg, isError: true });
      return msg;
    }
    add({ type: 'buildstep', text: `🔨 Building: ${task}` });
    try {
      const result = await runAgentTask({
        prompt: task,
        sessionId: agentSessionRef.current,
        onEvent: (ev) => {
          if (ev.kind === 'status') add({ type: 'buildstep', text: ev.text });
          else if (ev.kind === 'say') add({ type: 'ai', text: ev.text });
          else if (ev.kind === 'tool') add({ type: 'buildstep', text: `🔧 ${ev.input ? `${ev.name} · ${ev.input}` : ev.name}`, mono: true });
          else if (ev.kind === 'approval') setPendingApproval({ id: ev.id, command: ev.command });
          else if (ev.kind === 'error') add({ type: 'ai', text: ev.text, isError: true });
        },
      });
      agentSessionRef.current = result.sessionId || agentSessionRef.current;
      add({ type: 'deploy', branch: result.branch, changed: result.changed, text: result.summary || (result.changed ? 'Done.' : 'No changes were needed.') });
      return result.changed
        ? `Build complete. ${result.summary} Pushed to ${result.branch === 'main' ? 'main (deploying live)' : `preview branch ${result.branch}`}.`
        : `No code changes were needed. ${result.summary}`;
    } catch (e) {
      const msg = `Build failed: ${e?.message || e}`;
      add({ type: 'ai', text: msg, isError: true });
      return msg;
    }
  }, [contextKey]);

  const respondApproval = useCallback(async (approve) => {
    const a = pendingApproval; const pw = approvalPassword;
    setPendingApproval(null); setApprovalPassword('');
    if (!a) return;
    try { await approveAgentCommand(approve ? { id: a.id, password: pw } : { id: a.id, deny: true }); } catch { /* stream surfaces it */ }
  }, [pendingApproval, approvalPassword]);

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

    const activeTools = TOOLS;
    const systemPrompt = agentPrompt || buildSystemPrompt(contextKey, personality);

    try {
      let currentApi = [...newApi];
      let currentDisplay = [...newDisplay];

      while (true) {
        const resp = await callClaude(currentApi, systemPrompt, activeTools, model);

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
            if (block.name === 'build_app') {
              const pushBuild = (m) => { currentDisplay = [...currentDisplay, { id: `${Date.now()}-${Math.random()}`, ...m }]; setDisplayMsgs(currentDisplay); };
              const summary = await runBuildTask(block.input.task, pushBuild);
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: summary });
            } else if (block.name === 'show_form') {
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
            </div>
            <p className="text-xs" style={{ color: 'var(--vx-text2)' }}>
              {loading ? 'typing...' : 'online'}
            </p>
          </div>
          {/* Model toggle */}
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
          <button onClick={() => setBuildOpen(true)} title="Build with Jarvis"
            className="p-2 rounded-xl hover:opacity-70 transition-opacity"
            style={{ color: 'var(--vx-accent)' }}>
            <Hammer className="w-[18px] h-[18px]" />
          </button>
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
            if (msg.type === 'buildstep') return (
              <div key={msg.id} className={`text-xs px-2 ${msg.mono ? 'font-mono truncate' : ''}`} style={{ color: 'var(--vx-text2)' }}>{msg.text}</div>
            );
            if (msg.type === 'deploy') return <DeployCard key={msg.id} m={msg} />;
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

      {/* Jarvis Build — talks to the coding-agent backend */}
      <JarvisBuild isOpen={buildOpen} onClose={() => setBuildOpen(false)} />

      {/* Voice Mode — full-screen spoken conversation (can also trigger builds) */}
      {voiceOpen && (
        <VoiceMode
          name={agentName || 'Jarvis'}
          emoji={agentEmoji}
          systemPrompt={voiceBasePrompt}
          model={model}
          seedApi={apiMsgs}
          onTurn={commitVoiceTurn}
          onBuildTask={runBuildTask}
          onClose={() => setVoiceOpen(false)}
        />
      )}

      {/* Password approval — top level so it overlays the chat AND voice mode */}
      {pendingApproval && (
        <ApprovalModal
          pending={pendingApproval}
          password={approvalPassword}
          setPassword={setApprovalPassword}
          onRespond={respondApproval}
        />
      )}
    </>
  );
}
