import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Edit2, Check, X } from 'lucide-react';

export default function Contacts() {
  const navigate = useNavigate();
  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem('contactsSheetUrl') || '');
  const [inputUrl, setInputUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [showSheet, setShowSheet] = useState(false);

  const getEmbedUrl = (url) => {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (u.hostname === 'docs.google.com' && u.pathname.includes('/spreadsheets/')) {
        const base = url.split('/edit')[0].split('/view')[0].split('/htmlview')[0];
        return `${base}/htmlview?embedded=true`;
      }
    } catch {}
    return null;
  };

  const embedUrl = getEmbedUrl(sheetUrl);

  const handleSave = () => {
    const trimmed = inputUrl.trim();
    if (!trimmed) return;
    setSheetUrl(trimmed);
    localStorage.setItem('contactsSheetUrl', trimmed);
    setEditing(false);
    setInputUrl('');
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="px-6 py-8 flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors mt-1">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-4xl font-bold text-white tracking-tight">Contacts</h1>
            <p className="text-gray-400 mt-2">Manage your contacts</p>
          </div>
        </div>
        <button
          onClick={() => setShowSheet(true)}
          className="bg-white text-black font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
        >
          Contact Sheet
        </button>
      </div>

      {/* Sheet Display Area */}
      {showSheet && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* URL Input */}
          {editing && (
            <div className="px-6 py-5 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
              <p className="text-gray-400 text-sm mb-3">Paste your Google Sheets URL below. Make sure sharing is set to "Anyone with the link can view".</p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-4 py-2 rounded text-sm font-semibold bg-white text-black hover:bg-gray-200 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Sheet embed or empty state */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {embedUrl ? (
              <div className="flex-1 overflow-hidden relative">
                <iframe
                  src={embedUrl}
                  title="Contacts Sheet"
                  className="w-full h-full"
                  style={{ border: 'none' }}
                  allowFullScreen
                />
                {/* Top right controls */}
                <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                  {!editing && (
                    <>
                      <button
                        onClick={handleEdit}
                        className="flex items-center gap-2 bg-zinc-900 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800"
                      >
                        <Edit2 className="w-4 h-4" />
                        Change URL
                      </button>
                      <a
                        href={sheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-zinc-900 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open
                      </a>
                    </>
                  )}
                </div>
              </div>
            ) : !editing ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <p className="text-gray-500 text-lg mb-2">No contacts sheet linked yet</p>
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
      )}
    </div>
  );
}