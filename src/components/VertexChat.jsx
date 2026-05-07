import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Settings, Mic, MicOff, Send, Trash2, ChevronRight, Check, Palette } from 'lucide-react';
import { localClient } from '@/api/localDb';
import { useTheme, THEMES, PERSONALITIES } from '@/lib/ThemeContext';
import {
  loadDisplay, loadApi, saveDisplay, saveApi, clearHistory,
  getContextKey, getContextLabel, getContextGreeting, getContextSuggestions,
} from '@/lib/vertexChatStorage';
import vertexLogo from '@/assets/vertex-logo.png';

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

  return `You are Vertex AI, an intelligent assistant inside the Vertex Vans shop management app. ${tone}

${ctx}

You help manage: van builds (phases, tasks, parts), SOPs (standard operating procedures), inventory/parts stock, and contacts.

When the user wants to create something, use the show_form tool — prefill any fields you already know from the conversation.
When you navigate somewhere or create a record, a card will appear automatically — just describe what you did concisely.
For lists, be brief. Lead with the most relevant item.`;
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
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── API call ─────────────────────────────────────────────────────────────────

async function callClaude(messages, systemPrompt) {
  const res = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOLS,
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

function UserBubble({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm whitespace-pre-wrap"
        style={{ background: 'var(--vx-accent)', color: 'var(--vx-accent-fg)' }}>
        {text}
      </div>
    </div>
  );
}

function AIBubble({ text, isError }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm whitespace-pre-wrap"
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

// ── Main VertexChat ──────────────────────────────────────────────────────────

export default function VertexChat({ isOpen, onClose }) {
  const navigate = useNavigate();
  const { personality } = useTheme();

  const contextKey = getContextKey();
  const contextLabel = getContextLabel(contextKey);
  const greeting = getContextGreeting(contextKey);

  const [displayMsgs, setDisplayMsgs] = useState(() => loadDisplay(contextKey));
  const [apiMsgs, setApiMsgs] = useState(() => loadApi(contextKey));
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingForm, setPendingForm] = useState(null);
  const [departments, setDepartments] = useState([]);

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
    if (!msg || loading) return;
    setInput('');

    const userDisplay = { id: Date.now().toString(), type: 'user', text: msg };
    const newDisplay = [...displayMsgs, userDisplay];
    const userApiMsg = { role: 'user', content: msg };
    const newApi = [...apiMsgs, userApiMsg];
    persistMessages(newDisplay, newApi);
    setLoading(true);

    const systemPrompt = buildSystemPrompt(contextKey, personality);

    try {
      let currentApi = [...newApi];
      let currentDisplay = [...newDisplay];

      while (true) {
        const resp = await callClaude(currentApi, systemPrompt);

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
          <img src={vertexLogo} alt="Vertex" className="w-6 h-6 object-contain" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--vx-text)' }}>Vertex AI</p>
            <p className="text-xs" style={{ color: 'var(--vx-text2)' }}>{contextLabel}</p>
          </div>
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
              <img src={vertexLogo} alt="Vertex" className="w-12 h-12 object-contain mx-auto mb-3 opacity-40" />
              <p className="text-sm font-semibold" style={{ color: 'var(--vx-text)' }}>Vertex AI</p>
              <p className="text-xs mt-1 px-6" style={{ color: 'var(--vx-text2)' }}>{greeting}</p>
              <SuggestionGrid contextKey={contextKey} onSend={sendMessage} />
            </div>
          )}

          {displayMsgs.map((msg) => {
            if (msg.type === 'user') return <UserBubble key={msg.id} text={msg.text} />;
            if (msg.type === 'ai') return <AIBubble key={msg.id} text={msg.text} isError={msg.isError} />;
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
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Message Vertex AI…"
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
              disabled={loading || !input.trim()}
              className="p-2.5 rounded-2xl flex-shrink-0 transition-opacity disabled:opacity-30"
              style={{ background: 'var(--vx-accent)', color: 'var(--vx-accent-fg)' }}>
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Settings overlay */}
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} contextKey={contextKey} />}

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
    </>
  );
}
