import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Edit2, Check, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function MasterSheet() {
  const navigate = useNavigate();
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem('masterSheetUrl') || '');
  const [inputUrl, setInputUrl] = useState('');
  const [editing, setEditing] = useState(!localStorage.getItem('masterSheetUrl'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUrl = async () => {
      try {
        const user = await base44.auth.me();
        if (user?.masterSheetUrl) {
          setSheetUrl(user.masterSheetUrl);
          localStorage.setItem('masterSheetUrl', user.masterSheetUrl);
          setEditing(false);
        } else if (!localStorage.getItem('masterSheetUrl')) {
          setEditing(true);
        }
      } catch {}
      setLoading(false);
    };
    loadUrl();
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
    setLoading(true);
    try {
      await base44.auth.updateMe({ masterSheetUrl: trimmed });
    } catch {}
    setSheetUrl(trimmed);
    localStorage.setItem('masterSheetUrl', trimmed);
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