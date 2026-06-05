import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Settings as SettingsIcon } from 'lucide-react';
import { getSetting } from '@/api/appSettings';


export default function MasterSheet() {
  const navigate = useNavigate();
  const [sheetUrl, setSheetUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSetting('masterSheetUrl').then((url) => {
      if (url) setSheetUrl(url);
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
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded hover:bg-zinc-800"
            >
              <ExternalLink className="w-4 h-4" />
              Open
            </a>
          )}
          <button
            onClick={() => navigate('/Settings')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm px-3 py-1.5 rounded hover:bg-zinc-800"
          >
            <SettingsIcon className="w-4 h-4" />
            Settings
          </button>
        </div>
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
        ) : !loading ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
            <p className="text-gray-500 text-lg mb-2">No sheet linked yet</p>
            <p className="text-gray-600 text-sm mb-6">Add your Google Sheets link in Settings to display it here</p>
            <button
              onClick={() => navigate('/Settings')}
              className="bg-white text-black font-semibold px-5 py-2.5 rounded hover:bg-gray-200 transition-colors flex items-center gap-2"
            >
              <SettingsIcon className="w-4 h-4" />
              Go to Settings
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
