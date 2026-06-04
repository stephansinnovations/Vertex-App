import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Edit2, Check, X, Key } from 'lucide-react';
import { getSetting, setSetting } from '@/api/appSettings';


export default function MasterSheet() {
  const navigate = useNavigate();
  const [sheetUrl, setSheetUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [geminiKey, setGeminiKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  useEffect(() => {
    Promise.all([getSetting('masterSheetUrl'), getSetting('geminiApiKey')]).then(([url, key]) => {
      if (url) setSheetUrl(url);
      else setEditing(true);
      if (key) setGeminiKey(key);
      setLoading(false);
    });
  }, []);

  const getEmbedUrl = (url) => {
    if (!url) return null;
    // Convert regular Google Sheets URL to embed URL
    try {
      const u = new URL(url);
      if (u.hostname === 'docs.google.com' && u.pathname.includes('/spreadsheets/')) {
        // Replace /edit or /view with /htmlview for embedding
        const base = url.split('/edit')[0].split('/view')[0].split('/htmlview')[0];
        return `${base}/htmlview?embedded=true`;
      }
    } catch {}
    return null;
  };

  const embedUrl = getEmbedUrl(sheetUrl);

  const handleSave = async () => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    setSheetUrl(trimmed);
    await setSetting('masterSheetUrl', trimmed);
    setEditing(false);
    setInputUrl('');
    setLoading(false);
  };

  const handleEdit = () => {
    setInputUrl(sheetUrl);
    setEditing(true);
  };

  const handleCancel = () => {
    setInputUrl('');
    setEditing(false);
  };

  const saveGeminiKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    await setSetting('geminiApiKey', trimmed);
    setGeminiKey(trimmed);
    setEditingKey(false);
    setKeyInput('');
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/PartsLibrary')} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-white">Master Sheet</h1>
        </div>
        <div className="flex items-center gap-2">
          {sheetUrl && !editing && (
            <>
              <button
                onClick={handleEdit}
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded hover:bg-zinc-800"
              >
                <Edit2 className="w-4 h-4" />
                Change URL
              </button>
              <a
                href={sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded hover:bg-zinc-800"
              >
                <ExternalLink className="w-4 h-4" />
                Open
              </a>
            </>
          )}
        </div>
      </div>

      {/* URL Input */}
      {editing && (
        <div className="px-6 py-5 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
          <p className="text-gray-400 text-sm mb-3">Paste your Google Sheets URL below. Make sure sharing is set to "Anyone with the link can view".</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
              autoFocus
            />
            <button
              onClick={handleSave}
              className="bg-white text-black font-semibold text-sm px-4 py-2 rounded hover:bg-gray-200 transition-colors flex items-center gap-1"
            >
              <Check className="w-4 h-4" />
              Save
            </button>
            {sheetUrl && (
              <button
                onClick={handleCancel}
                className="bg-zinc-800 text-white text-sm px-4 py-2 rounded hover:bg-zinc-700 transition-colors flex items-center gap-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Gemini API Key */}
      <div className="px-6 py-4 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-white">Gemini API Key</span>
          </div>
          {geminiKey && !editingKey && (
            <button onClick={() => { setKeyInput(geminiKey); setEditingKey(true); }} className="text-xs text-gray-500 hover:text-white transition-colors">Change</button>
          )}
        </div>
        {editingKey || !geminiKey ? (
          <div className="flex gap-2 mt-2">
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveGeminiKey(); if (e.key === 'Escape') setEditingKey(false); }}
              placeholder="AIza..."
              className="flex-1 bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
              autoFocus={editingKey}
            />
            <button onClick={saveGeminiKey} className="bg-white text-black font-semibold text-sm px-4 py-2 rounded hover:bg-gray-200 transition-colors flex items-center gap-1">
              <Check className="w-4 h-4" /> Save
            </button>
            {geminiKey && (
              <button onClick={() => setEditingKey(false)} className="bg-zinc-800 text-white text-sm px-3 py-2 rounded hover:bg-zinc-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <p className="text-gray-500 text-xs mt-1">••••••••••••••••••••• <span className="text-green-400 ml-1">✓ Set</span></p>
        )}
      </div>

      {/* Sheet embed */}
      <div className="flex-1">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title="Master Sheet"
            className="w-full h-full min-h-screen"
            style={{ border: 'none', minHeight: 'calc(100vh - 73px)' }}
            allowFullScreen
          />
        ) : !editing ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
            <p className="text-gray-500 text-lg mb-2">No sheet linked yet</p>
            <p className="text-gray-600 text-sm mb-6">Paste a Google Sheets URL to display it here</p>
            <button
              onClick={() => setEditing(true)}
              className="bg-white text-black font-semibold px-5 py-2.5 rounded hover:bg-gray-200 transition-colors"
            >
              Add Google Sheet
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}