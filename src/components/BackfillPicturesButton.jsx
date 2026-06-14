import React, { useState, useRef } from 'react';
import { Sparkles, ChevronRight, X, Check, AlertCircle } from 'lucide-react';
import { getSheetTabs, getPartRowsForBackfill, writePartImageByRow } from '@/api/googleSheets';
import { getSheetsAccessToken } from '@/api/googleAuth';
import { findPartImage } from '@/api/geminiParts';
import { getSetting } from '@/api/appSettings';

function extractSpreadsheetId(url) {
  try { const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/); return m ? m[1] : null; } catch { return null; }
}

// Settings → Inventory action: find a product image (via AI) for every master-sheet
// part that has no picture yet, and write it into the sheet's picture column.
export default function BackfillPicturesButton() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const [p, setP] = useState({ total: 0, done: 0, found: 0, missing: 0, failed: 0, current: '' });
  const cancel = useRef(false);

  const openModal = () => { setErr(null); setDone(false); setP({ total: 0, done: 0, found: 0, missing: 0, failed: 0, current: '' }); setOpen(true); };
  const close = () => { if (running) cancel.current = true; setOpen(false); };

  const start = async () => {
    if (running) return;
    setRunning(true); setDone(false); setErr(null); cancel.current = false;
    setP({ total: 0, done: 0, found: 0, missing: 0, failed: 0, current: 'Reading your sheet…' });
    try {
      const url = await getSetting('masterSheetUrl');
      const sid = url && extractSpreadsheetId(url);
      if (!sid) throw new Error('No master sheet is set yet (add it under Master Sheet Links).');
      const token = await getSheetsAccessToken();
      const tabsRes = await getSheetTabs(sid);
      const tabs = tabsRes.data.tabs || [];

      // Phase 1 — gather every part with no picture yet.
      const jobs = [];
      for (const tab of tabs) {
        if (cancel.current) break;
        try {
          const { sheetId, parts } = await getPartRowsForBackfill(sid, tab, token);
          parts.forEach(part => { if (!part.imageUrl && part.partName) jobs.push({ ...part, sheetId }); });
        } catch { /* skip unreadable tab */ }
      }
      setP(s => ({ ...s, total: jobs.length, current: jobs.length ? '' : 'Every part already has a picture 🎉' }));

      // Phase 2 — find an image for each and write it in (only column E shifts nothing).
      let found = 0, missing = 0, failed = 0;
      for (let i = 0; i < jobs.length; i++) {
        if (cancel.current) break;
        const job = jobs[i];
        setP(s => ({ ...s, done: i, current: job.partName }));
        try {
          const img = await findPartImage(job);
          if (img) { await writePartImageByRow(sid, job.sheetId, job.rowIndex, img, token); found++; }
          else missing++;
        } catch { failed++; }
        setP(s => ({ ...s, done: i + 1, found, missing, failed }));
      }
      setDone(true);
    } catch (e) {
      setErr(e.message || 'Backfill failed');
    } finally {
      setRunning(false);
    }
  };

  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;

  return (
    <>
      <button
        onClick={openModal}
        className="w-full flex items-center justify-between px-5 py-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 transition-colors"
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
      >
        <span className="text-white font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" /> Auto-fill missing pictures with AI
        </span>
        <ChevronRight className="w-5 h-5 text-gray-500" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-400" /> Auto-fill pictures
              </h2>
              <button onClick={close} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            {err ? (
              <div className="py-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-red-400 text-sm mb-4">{err}</p>
                <button onClick={start} className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-full">Try again</button>
              </div>
            ) : done ? (
              <div className="py-6 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-500/15 flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-white font-semibold">{p.total === 0 ? 'Nothing to fill' : 'All done'}</p>
                <p className="text-gray-400 text-sm mt-1">
                  {p.total === 0 ? 'Every part already has a picture.' : `Added ${p.found} · none found ${p.missing} · failed ${p.failed}`}
                </p>
                <p className="text-gray-500 text-xs mt-2">Open the Parts Library (or refresh it) to see the new pictures.</p>
                <button onClick={() => setOpen(false)} className="mt-5 w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-3 rounded-full">Done</button>
              </div>
            ) : running ? (
              <div className="py-2">
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden mb-3">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-gray-300 text-sm">{p.total ? `${p.done} / ${p.total}` : ''} {p.current}</p>
                <p className="text-gray-500 text-xs mt-1">Added {p.found} · none {p.missing} · failed {p.failed}</p>
                <button onClick={close} className="mt-5 w-full border border-zinc-700 text-gray-300 hover:bg-zinc-800 font-semibold py-3 rounded-full">Stop</button>
              </div>
            ) : (
              <>
                <p className="text-gray-300 text-sm mb-1">Finds a product image with AI for every part in your master sheet that has no picture yet, and writes it into the sheet.</p>
                <p className="text-gray-500 text-xs mb-5">Parts that already have a picture are left alone. Google will ask you to sign in and allow Sheets access.</p>
                <button onClick={start} className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-3.5 rounded-full flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> Start
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
