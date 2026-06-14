import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Key, Link2, Check, X, Edit2, ExternalLink, Lightbulb, ChevronRight, Image as ImageIcon, Plus, Bug } from 'lucide-react';
import { motion } from 'framer-motion';
import { getSetting, setSetting } from '@/api/appSettings';
import { useBackground, backgroundStyle } from '@/lib/BackgroundContext';

const API_KEYS = [
  {
    key: 'anthropicApiKey',
    label: 'Anthropic (Claude) API Key',
    placeholder: 'sk-ant-...',
    secret: true,
    hint: 'Get one at console.anthropic.com — powers the Vertex AI chat',
    balanceUrl: 'https://console.anthropic.com/settings/billing',
  },
  {
    key: 'geminiApiKey',
    label: 'Gemini API Key',
    placeholder: 'AIza...',
    secret: true,
    hint: 'Get one free at aistudio.google.com/apikey',
    balanceUrl: 'https://aistudio.google.com/app/usage',
  },
];

const SHEET_LINKS = [
  {
    key: 'masterSheetUrl',
    label: 'Master Sheet',
    placeholder: 'https://docs.google.com/spreadsheets/d/...',
  },
  {
    key: 'contactsSheetUrl',
    label: 'Contacts Sheet',
    placeholder: 'https://docs.google.com/spreadsheets/d/...',
  },
];

const ALL_FIELDS = [...API_KEYS, ...SHEET_LINKS];

export default function Settings() {
  const navigate = useNavigate();
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);

  // Backgrounds
  const { backgrounds, activeId, setActive, addBackground, removeBackground } = useBackground();
  const [addingBg, setAddingBg] = useState(false);
  const [bgName, setBgName] = useState('');
  const [bgValue, setBgValue] = useState('');
  const BUILTINS = ['master-crafter', 'original'];

  const submitBg = () => {
    const value = bgValue.trim();
    if (!value) return;
    const type = /^https?:\/\//i.test(value) ? 'image' : 'css';
    addBackground({ name: bgName.trim() || 'Custom', type, value });
    setBgName(''); setBgValue(''); setAddingBg(false);
  };

  useEffect(() => {
    Promise.all(
      ALL_FIELDS.map(async (f) => {
        const v = f.local
          ? localStorage.getItem(f.key) || ''
          : (await getSetting(f.key)) || localStorage.getItem(f.key) || '';
        return [f.key, v];
      })
    ).then((entries) => {
      setValues(Object.fromEntries(entries));
      setLoading(false);
    });
  }, []);

  const startEdit = (field) => {
    setDraft(values[field.key] || '');
    setEditing(field.key);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  const save = async (field) => {
    const trimmed = draft.trim();
    if (field.local) {
      localStorage.setItem(field.key, trimmed);
    } else {
      await setSetting(field.key, trimmed);
    }
    setValues((prev) => ({ ...prev, [field.key]: trimmed }));
    setEditing(null);
    setDraft('');
  };

  const renderField = (field, isLast) => {
    const value = values[field.key] || '';
    const isEditing = editing === field.key;

    return (
      <div
        key={field.key}
        className={`px-6 py-5 ${!isLast ? 'border-b border-zinc-800' : ''}`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-white">{field.label}</span>
          {!isEditing && (
            <div className="flex items-center gap-3">
              {field.balanceUrl && value && (
                <a
                  href={field.balanceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 bg-green-400/10 px-2 py-0.5 rounded-full transition-colors"
                >
                  Check Balance ↗
                </a>
              )}
              {value && !field.secret && (
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open
                </a>
              )}
              <button
                onClick={() => startEdit(field)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
                {value ? 'Change' : 'Add'}
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="flex gap-2 mt-2">
            <input
              type={field.secret ? 'password' : 'text'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save(field);
                if (e.key === 'Escape') cancelEdit();
              }}
              placeholder={field.placeholder}
              className="flex-1 bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
              autoFocus
            />
            <button
              onClick={() => save(field)}
              className="bg-white text-black font-semibold text-sm px-4 py-2 rounded hover:bg-gray-200 transition-colors flex items-center gap-1"
            >
              <Check className="w-4 h-4" /> Save
            </button>
            <button
              onClick={cancelEdit}
              className="bg-zinc-800 text-white text-sm px-3 py-2 rounded hover:bg-zinc-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : value ? (
          field.secret ? (
            <p className="text-gray-500 text-xs">
              ••••••••••••••••••••• <span className="text-green-400 ml-1">✓ Set</span>
            </p>
          ) : (
            <p className="text-gray-500 text-xs break-all">{value}</p>
          )
        ) : (
          <p className="text-gray-600 text-xs">Not set{field.hint ? ` — ${field.hint}` : ''}</p>
        )}
      </div>
    );
  };

  return (
    <motion.div
      className="min-h-screen bg-black flex flex-col items-center py-10"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="w-full max-w-lg px-6 mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate('/Profile')}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-4xl font-bold text-white tracking-tight">Settings</h1>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
        </div>
      ) : (
        <div className="w-full max-w-lg px-6 space-y-8">
          {/* API Keys */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Key className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">API Keys</h2>
            </div>
            <div
              className="w-full rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900/40"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            >
              {API_KEYS.map((f, i) => renderField(f, i === API_KEYS.length - 1))}
            </div>
          </div>

          {/* Master Sheet Links */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Link2 className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Master Sheet Links</h2>
            </div>
            <div
              className="w-full rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900/40"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            >
              {SHEET_LINKS.map((f, i) => renderField(f, i === SHEET_LINKS.length - 1))}
            </div>
          </div>

          {/* Backgrounds */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <ImageIcon className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Backgrounds</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {backgrounds.map(bg => (
                <div key={bg.id} className="relative">
                  <button
                    onClick={() => setActive(bg.id)}
                    className={`w-full rounded-2xl overflow-hidden border text-left transition-colors ${bg.id === activeId ? 'border-white' : 'border-zinc-800 hover:border-zinc-600'}`}
                  >
                    <div className="h-20" style={backgroundStyle(bg)} />
                    <div className="flex items-center justify-between px-3 py-2 bg-zinc-900/70">
                      <span className="text-white text-sm truncate">{bg.name}</span>
                      {bg.id === activeId && <Check className="w-4 h-4 text-green-400 flex-shrink-0" />}
                    </div>
                  </button>
                  {!BUILTINS.includes(bg.id) && (
                    <button
                      onClick={() => removeBackground(bg.id)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-gray-300 hover:text-red-400"
                      aria-label="Remove background"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {addingBg ? (
              <div className="mt-3 bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4 space-y-2">
                <input
                  value={bgName}
                  onChange={e => setBgName(e.target.value)}
                  placeholder="Name"
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                />
                <textarea
                  value={bgValue}
                  onChange={e => setBgValue(e.target.value)}
                  placeholder="Image URL (https://…) or CSS background (e.g. linear-gradient(…))"
                  rows={3}
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-xs font-mono focus:outline-none focus:border-zinc-500 resize-none"
                />
                <div className="flex items-center gap-2">
                  <button onClick={submitBg} disabled={!bgValue.trim()}
                    className="flex-1 bg-white text-black text-sm font-semibold py-2 rounded-lg disabled:opacity-40">
                    Save background
                  </button>
                  <button onClick={() => { setAddingBg(false); setBgName(''); setBgValue(''); }}
                    className="text-gray-400 hover:text-white px-2"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingBg(true)}
                className="mt-3 flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
                <Plus className="w-4 h-4" /> Add background
              </button>
            )}
          </div>

          {/* Inventory */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Lightbulb className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Inventory</h2>
            </div>
            <button
              onClick={() => navigate('/InventoryIdeas')}
              className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 transition-colors"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            >
              <span className="text-white font-medium">Inventory Ideas</span>
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Diagnostics */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Bug className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Diagnostics</h2>
            </div>
            <button
              onClick={() => navigate('/Bugs')}
              className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 transition-colors"
              style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
            >
              <span className="text-white font-medium">Bug Reports</span>
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
