import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Key, Link2, Check, X, Edit2, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { getSetting, setSetting } from '@/api/appSettings';

const API_KEYS = [
  {
    key: 'anthropicApiKey',
    label: 'Anthropic (Claude) API Key',
    placeholder: 'sk-ant-...',
    secret: true,
    hint: 'Get one at console.anthropic.com — powers the Vertex AI chat',
  },
  {
    key: 'geminiApiKey',
    label: 'Gemini API Key',
    placeholder: 'AIza...',
    secret: true,
    hint: 'Get one free at aistudio.google.com/apikey',
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
        </div>
      )}
    </motion.div>
  );
}
