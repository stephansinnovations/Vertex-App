import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Settings as SettingsIcon, Check, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function BuildSheet() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const buildId = params.get('id');
  const buildName = params.get('name') || 'Build';

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    base44.entities.Build.get(buildId).then(b => {
      if (!active) return;
      setUrl(b?.build_sheet_url || '');
      setDraft(b?.build_sheet_url || '');
      setLoading(false);
    });
    return () => { active = false; };
  }, [buildId]);

  const getEmbedUrl = (u) => {
    if (!u) return null;
    try {
      const parsed = new URL(u);
      if (parsed.hostname === 'docs.google.com' && parsed.pathname.includes('/spreadsheets/')) {
        const base = u.split('/edit')[0].split('/view')[0].split('/htmlview')[0];
        return `${base}/htmlview?embedded=true`;
      }
    } catch { /* ignore */ }
    return null;
  };
  const embedUrl = getEmbedUrl(url);

  const save = async () => {
    setSaving(true);
    try {
      await base44.entities.Build.update(buildId, { build_sheet_url: draft.trim() });
      setUrl(draft.trim());
    } catch { /* non-fatal */ }
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={() => navigate(`/BuildDetail?id=${buildId}&name=${encodeURIComponent(buildName)}`)} className="text-gray-400 hover:text-white transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white truncate">Build Sheet</h1>
            <p className="text-gray-500 text-xs truncate">{buildName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded hover:bg-zinc-800">
              <ExternalLink className="w-4 h-4" /> Open
            </a>
          )}
          <button
            onClick={() => { setDraft(url); setEditing(v => !v); }}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded hover:bg-zinc-800"
          >
            <SettingsIcon className="w-4 h-4" /> Settings
          </button>
        </div>
      </div>

      {/* Per-build settings editor */}
      {editing && (
        <div className="bg-zinc-900/60 border-b border-zinc-800 px-6 py-4">
          <label className="text-xs text-gray-400 mb-1.5 block">Build sheet (Google Sheet URL)</label>
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              autoFocus
              className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
            />
            <button onClick={save} disabled={saving}
              className="bg-white text-black text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-40 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setDraft(url); }} className="text-gray-400 hover:text-white px-2"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Sheet embed */}
      <div className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-[50vh]">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
          </div>
        ) : embedUrl ? (
          <iframe
            src={embedUrl}
            title="Build Sheet"
            className="w-full h-full min-h-screen"
            style={{ border: 'none', minHeight: 'calc(100vh - 73px)' }}
            allowFullScreen
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
            <p className="text-gray-500 text-lg mb-2">No build sheet linked yet</p>
            <p className="text-gray-600 text-sm mb-6">Add this build&apos;s Google Sheet link to display it here</p>
            <button
              onClick={() => { setDraft(url); setEditing(true); }}
              className="bg-white text-black font-semibold px-5 py-2.5 rounded hover:bg-gray-200 transition-colors flex items-center gap-2"
            >
              <SettingsIcon className="w-4 h-4" /> Add build sheet link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
