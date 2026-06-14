import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bug, Check, RotateCcw, Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { getBugReports, setBugResolved, deleteBug } from '@/api/bugReports';

const SOURCE_STYLE = {
  render: { label: 'Render', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  window: { label: 'Runtime', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  promise: { label: 'Promise', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  manual: { label: 'Manual', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? String(ts) : d.toLocaleString();
}

function BugCard({ bug, onToggleResolved, onDelete }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const src = SOURCE_STYLE[bug.source] || { label: bug.source || 'Error', cls: 'bg-zinc-700/40 text-gray-300 border-zinc-600' };

  const toggle = async () => { setBusy(true); await onToggleResolved(bug); setBusy(false); };
  const remove = async () => {
    if (!window.confirm('Delete this bug report?')) return;
    setBusy(true); await onDelete(bug); setBusy(false);
  };

  return (
    <div className={`rounded-2xl border p-4 transition-colors ${bug.resolved ? 'border-zinc-800 bg-zinc-900/20 opacity-70' : 'border-zinc-800 bg-zinc-900/40'}`}
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${src.cls}`}>{src.label}</span>
            {bug.resolved && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-green-500/15 text-green-300 border-green-500/30">Resolved</span>}
            <span className="text-gray-500 text-xs">{fmt(bug.created_at)}</span>
          </div>
          <p className="text-white text-sm font-medium break-words">{bug.message || '(no message)'}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-500">
            {bug.path && <span className="font-mono">{bug.path}</span>}
            {bug.user_email && <span>· {bug.user_email}</span>}
          </div>
          {bug.note && <p className="mt-2 text-gray-300 text-xs bg-zinc-800/60 rounded-lg px-3 py-2">{bug.note}</p>}

          {bug.stack && (
            <>
              <button onClick={() => setOpen(o => !o)}
                className="mt-2 inline-flex items-center gap-1 text-gray-400 hover:text-white text-xs transition-colors">
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /> {open ? 'Hide' : 'Show'} stack
              </button>
              {open && (
                <pre className="mt-2 text-[11px] text-gray-400 bg-black/40 border border-zinc-800 rounded-lg p-3 max-h-56 overflow-auto whitespace-pre-wrap break-words">{bug.stack}</pre>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 flex-shrink-0">
          <button onClick={toggle} disabled={busy}
            title={bug.resolved ? 'Reopen' : 'Mark resolved'}
            className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-gray-300 hover:bg-zinc-800 disabled:opacity-50 transition-colors">
            {bug.resolved ? <RotateCcw className="w-4 h-4" /> : <Check className="w-4 h-4 text-green-400" />}
          </button>
          <button onClick={remove} disabled={busy}
            title="Delete"
            className="w-9 h-9 rounded-full border border-zinc-700 flex items-center justify-center text-gray-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Bugs() {
  const navigate = useNavigate();
  const [bugs, setBugs] = useState(null);
  const [filter, setFilter] = useState('open'); // open | resolved | all
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const data = await getBugReports();
    setBugs(data);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onToggleResolved = async (bug) => {
    await setBugResolved(bug.id, !bug.resolved);
    setBugs(prev => prev.map(b => (b.id === bug.id ? { ...b, resolved: !bug.resolved } : b)));
  };
  const onDelete = async (bug) => {
    await deleteBug(bug.id);
    setBugs(prev => prev.filter(b => b.id !== bug.id));
  };

  const all = bugs || [];
  const openCount = all.filter(b => !b.resolved).length;
  const shown = all.filter(b =>
    filter === 'all' ? true : filter === 'resolved' ? b.resolved : !b.resolved);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/Settings')} className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Bug className="w-6 h-6" /> Bug Reports</h1>
          </div>
          <button onClick={load} disabled={refreshing}
            className="text-gray-400 hover:text-white disabled:opacity-50 transition-colors" title="Refresh">
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-5">
          {[['open', `Open${openCount ? ` (${openCount})` : ''}`], ['resolved', 'Resolved'], ['all', 'All']].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`text-sm font-medium px-4 py-1.5 rounded-full border transition-colors ${filter === key ? 'bg-white text-black border-white' : 'border-zinc-700 text-gray-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {bugs === null ? (
          <div className="py-20 text-center">
            <div className="w-8 h-8 mx-auto border-4 border-zinc-700 border-t-white rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-zinc-900 flex items-center justify-center">
              <Bug className="w-7 h-7 text-gray-600" />
            </div>
            <p className="text-gray-400">{filter === 'open' ? 'No open bugs. 🎉' : filter === 'resolved' ? 'No resolved bugs yet.' : 'No bugs reported yet.'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map(bug => (
              <BugCard key={bug.id} bug={bug} onToggleResolved={onToggleResolved} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
