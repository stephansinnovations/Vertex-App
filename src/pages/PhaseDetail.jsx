import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import PartsBrowserSheet from '@/components/PartsBrowserSheet';
import {
  ArrowLeft, Plus, AlertTriangle, CheckCircle2, Circle,
  ChevronDown, X, BookOpen, Package, Search, Check
} from 'lucide-react';
import { getBuildPhases, saveBuildPhases } from '@/api/buildsDb';
import { base44 } from '@/api/base44Client';

const BLOCK_REASONS = ['Waiting on Parts', 'Waiting on Customer', 'Waiting on Subcontractor', 'Other'];
const STATUS_CYCLE = { not_started: 'in_progress', in_progress: 'done', done: 'not_started' };

function loadSOPs() {
  try {
    const stored = localStorage.getItem('localdb_SOP');
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function StatusIcon({ status, blockedReason }) {
  if (status === 'done') return <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />;
  if (status === 'blocked') {
    if (blockedReason === 'Waiting on Parts') return <Package className="w-5 h-5 text-yellow-400 flex-shrink-0" />;
    return <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />;
  }
  if (status === 'in_progress') return <Circle className="w-5 h-5 text-blue-400 flex-shrink-0" />;
  return <Circle className="w-5 h-5 text-gray-600 flex-shrink-0" />;
}

// ── SOP Picker ──────────────────────────────────────────────────────────────
function SOPPicker({ allSOPs, attached, onToggle, onClose }) {
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const filtered = allSOPs.filter(s =>
    s.title?.toLowerCase().includes(query.toLowerCase()) ||
    s.group?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={ref} className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-h-64 flex flex-col">
      <div className="p-2 border-b border-zinc-800">
        <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-1.5">
          <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search SOPs..."
            className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder:text-gray-600"
          />
        </div>
      </div>
      <div className="overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-4">No SOPs found</p>
        ) : filtered.map(sop => {
          const isOn = attached.some(a => a.id === sop.id);
          return (
            <button
              key={sop.id}
              onClick={() => onToggle(sop)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left ${isOn ? 'text-white' : 'text-gray-400'}`}
            >
              <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${isOn ? 'bg-white border-white' : 'border-zinc-600'}`}>
                {isOn && <Check className="w-3 h-3 text-black" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sop.title}</p>
                {sop.group && <p className="text-xs text-gray-600 truncate">{sop.group}</p>}
              </div>
              {(() => {
                const count = (sop.steps || []).reduce((n, s) => n + (s.materials?.length || 0), 0);
                return count > 0 ? <span className="text-xs text-gray-600 flex-shrink-0">{count} parts</span> : null;
              })()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Add Task Panel ───────────────────────────────────────────────────────────
function AddTaskPanel({ allSOPs, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [attachedSOPs, setAttachedSOPs] = useState([]);
  const [parts, setParts] = useState([]);
  const [showSOPPicker, setShowSOPPicker] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [addingPart, setAddingPart] = useState(false);

  const toggleSOP = (sop) => {
    const isOn = attachedSOPs.some(a => a.id === sop.id);
    if (isOn) {
      setAttachedSOPs(prev => prev.filter(a => a.id !== sop.id));
      setParts(prev => prev
        .map(p => {
          const contrib = (p.sop_qtys || {})[sop.id] || 0;
          if (!contrib) return p;
          const newQty = (p.qty || 1) - contrib;
          const newSopQtys = { ...(p.sop_qtys || {}) };
          delete newSopQtys[sop.id];
          return { ...p, qty: newQty, sop_qtys: newSopQtys };
        })
        .filter(p => (p.qty || 1) > 0)
      );
    } else {
      setAttachedSOPs(prev => [...prev, { id: sop.id, title: sop.title }]);
      const sopPartsMap = {};
      (sop.steps || []).forEach(step => {
        (step.materials || []).forEach(m => {
          if (!m?.name?.trim()) return;
          const key = m.name.trim().toLowerCase();
          if (sopPartsMap[key]) {
            sopPartsMap[key].qty += (m.qty || 1);
          } else {
            sopPartsMap[key] = { ...m, name: m.name.trim(), qty: m.qty || 1 };
          }
        });
      });
      setParts(prev => {
        let updated = [...prev];
        Object.values(sopPartsMap).forEach(sopPart => {
          const existingIdx = updated.findIndex(p => p.name.toLowerCase() === sopPart.name.toLowerCase());
          if (existingIdx >= 0) {
            const existing = updated[existingIdx];
            updated[existingIdx] = {
              ...existing,
              qty: (existing.qty || 1) + sopPart.qty,
              sop_qtys: { ...(existing.sop_qtys || {}), [sop.id]: sopPart.qty },
            };
          } else {
            updated.push({
              id: `${sop.id}_${sopPart.name}_${Date.now()}_${Math.random()}`,
              name: sopPart.name,
              note: '',
              qty: sopPart.qty,
              sop_qtys: { [sop.id]: sopPart.qty },
              from_sop: sop.id,
              from_sop_title: sop.title,
              checked: false,
            });
          }
        });
        return updated;
      });
    }
  };

  const addManualPart = () => {
    if (!newPartName.trim()) return;
    setParts(prev => [...prev, {
      id: `manual_${Date.now()}_${Math.random()}`,
      name: newPartName.trim(),
      note: '',
      from_sop: null,
      from_sop_title: null,
      checked: false,
    }]);
    setNewPartName('');
    setAddingPart(false);
  };

  const removePart = (partId) => setParts(prev => prev.filter(p => p.id !== partId));

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: Date.now().toString(),
      name: name.trim(),
      status: 'not_started',
      estimated_hours: '',
      actual_hours: '',
      blocked_reason: null,
      notes: '',
      sops: attachedSOPs,
      parts,
    });
  };

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 space-y-4 mt-2">
      {/* Task name */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Task name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') onCancel(); }}
          placeholder="e.g. Install electrical cabinet"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Attach SOPs */}
      <div>
        <label className="text-xs text-gray-500 block mb-1.5">Attached SOPs</label>
        <div className="relative">
          {attachedSOPs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedSOPs.map(sop => (
                <span key={sop.id} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-white text-xs px-2.5 py-1 rounded-full">
                  <BookOpen className="w-3 h-3 text-gray-400" />
                  {sop.title}
                  <button onClick={() => toggleSOP(allSOPs.find(s => s.id === sop.id) || sop)} className="text-gray-500 hover:text-white ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowSOPPicker(v => !v)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors border border-dashed border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            Attach SOP
          </button>
          {showSOPPicker && (
            <SOPPicker
              allSOPs={allSOPs}
              attached={attachedSOPs}
              onToggle={toggleSOP}
              onClose={() => setShowSOPPicker(false)}
            />
          )}
        </div>
      </div>

      {/* Parts list */}
      <div>
        <label className="text-xs text-gray-500 block mb-1.5">Parts needed</label>
        {parts.length > 0 && (
          <div className="space-y-1 mb-2">
            {parts.map(part => (
              <div key={part.id} className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
                <Package className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="flex-1 text-sm text-white truncate">{part.name}</span>
                {(part.qty && part.qty > 1) && (
                  <span className="text-xs text-gray-400 flex-shrink-0">×{part.qty}</span>
                )}
                {part.from_sop_title && (
                  <span className="text-xs text-gray-600 truncate max-w-[80px]">{part.from_sop_title}</span>
                )}
                <button onClick={() => removePart(part.id)} className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {addingPart ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={newPartName}
              onChange={e => setNewPartName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addManualPart(); if (e.key === 'Escape') setAddingPart(false); }}
              placeholder="Part name..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-zinc-500"
            />
            <button onClick={addManualPart} className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">Add</button>
            <button onClick={() => setAddingPart(false)} className="text-gray-500 px-1"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <button
            onClick={() => setAddingPart(true)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors border border-dashed border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Part
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleAdd}
          disabled={!name.trim()}
          className="flex-1 bg-white text-black font-semibold py-2.5 rounded-xl text-sm hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Create Task
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-zinc-700 text-gray-400 hover:text-white text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Task Row ─────────────────────────────────────────────────────────────────
function TaskRow({ task, onUpdate, onDelete, allSOPs = [], navigate, initialExpanded = false }) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [showSOPPicker, setShowSOPPicker] = useState(false);
  const [partsBrowserOpen, setPartsBrowserOpen] = useState(false);
  const [activeStepperPartId, setActiveStepperPartId] = useState(null);
  const [showUnblockConfirm, setShowUnblockConfirm] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [sopDetachConfirm, setSopDetachConfirm] = useState(null);

  const UNBLOCK_MESSAGES = {
    'Waiting on Parts': 'Do you have all the parts ready?',
    'Waiting on Customer': "Do you have the customer's approval?",
    'Waiting on Subcontractor': 'Is the subcontractor ready to proceed?',
    'Other': 'Are you ready to unblock this task?',
  };

  const cycleStatus = () => {
    if (task.status === 'blocked') {
      setShowUnblockConfirm(true);
    } else if (task.status === 'in_progress') {
      setShowCompleteConfirm(true);
    } else {
      onUpdate({ ...task, status: STATUS_CYCLE[task.status] || 'not_started' });
    }
  };

  const confirmUnblock = () => {
    onUpdate({ ...task, status: 'not_started', blocked_reason: null });
    setShowUnblockConfirm(false);
  };

  const confirmComplete = () => {
    onUpdate({ ...task, status: 'done', parts: (task.parts || []).map(p => ({ ...p, checked: true })) });
    setShowCompleteConfirm(false);
  };

  const setBlocked = (reason) => {
    onUpdate({ ...task, status: 'blocked', blocked_reason: reason });
    setShowBlockMenu(false);
  };

  const togglePart = (partId) => {
    onUpdate({
      ...task,
      parts: (task.parts || []).map(p => p.id === partId ? { ...p, checked: !p.checked } : p)
    });
  };

  const removePart = (partId) => {
    onUpdate({ ...task, parts: (task.parts || []).filter(p => p.id !== partId) });
  };

  const toggleSOP = (sop) => {
    const currentSOPs = task.sops || [];
    const currentParts = task.parts || [];
    const isOn = currentSOPs.some(a => a.id === sop.id);

    if (isOn) {
      // Detach: subtract this SOP's contribution from each part, remove if qty hits 0
      const updatedParts = currentParts
        .map(p => {
          const contrib = (p.sop_qtys || {})[sop.id] || 0;
          if (!contrib) return p;
          const newQty = (p.qty || 1) - contrib;
          const newSopQtys = { ...(p.sop_qtys || {}) };
          delete newSopQtys[sop.id];
          return { ...p, qty: newQty, sop_qtys: newSopQtys };
        })
        .filter(p => (p.qty || 1) > 0);
      onUpdate({
        ...task,
        sops: currentSOPs.filter(a => a.id !== sop.id),
        parts: updatedParts,
      });
    } else {
      // Attach: aggregate parts from all steps, merge by name
      const sopPartsMap = {};
      (sop.steps || []).forEach(step => {
        (step.materials || []).forEach(m => {
          if (!m?.name?.trim()) return;
          const key = m.name.trim().toLowerCase();
          if (sopPartsMap[key]) {
            sopPartsMap[key].qty += (m.qty || 1);
          } else {
            sopPartsMap[key] = { name: m.name.trim(), qty: m.qty || 1 };
          }
        });
      });

      let updatedParts = [...currentParts];
      Object.values(sopPartsMap).forEach(sopPart => {
        const existingIdx = updatedParts.findIndex(p => p.name.toLowerCase() === sopPart.name.toLowerCase());
        if (existingIdx >= 0) {
          const existing = updatedParts[existingIdx];
          updatedParts[existingIdx] = {
            ...existing,
            qty: (existing.qty || 1) + sopPart.qty,
            sop_qtys: { ...(existing.sop_qtys || {}), [sop.id]: sopPart.qty },
          };
        } else {
          updatedParts.push({
            id: `${sop.id}_${sopPart.name}_${Date.now()}_${Math.random()}`,
            name: sopPart.name,
            note: '',
            qty: sopPart.qty,
            sop_qtys: { [sop.id]: sopPart.qty },
            from_sop: sop.id,
            from_sop_title: sop.title,
            checked: false,
          });
        }
      });

      onUpdate({
        ...task,
        sops: [...currentSOPs, { id: sop.id, title: sop.title }],
        parts: updatedParts,
      });
    }
  };

  const addLibraryPart = (partData) => {
    const currentParts = task.parts || [];
    const existingIdx = currentParts.findIndex(p => p.name.toLowerCase() === partData.name.toLowerCase());
    if (existingIdx >= 0) {
      const updated = [...currentParts];
      updated[existingIdx] = { ...updated[existingIdx], qty: (updated[existingIdx].qty || 1) + 1 };
      onUpdate({ ...task, parts: updated });
    } else {
      onUpdate({
        ...task,
        parts: [...currentParts, {
          id: `lib_${Date.now()}_${Math.random()}`,
          name: partData.name,
          note: partData.supplier || '',
          qty: 1,
          sop_qtys: {},
          from_sop: null,
          from_sop_title: null,
          from_library: true,
          checked: false,
        }],
      });
    }
  };

  const incrementPart = (partId) => {
    onUpdate({ ...task, parts: (task.parts || []).map(p => p.id === partId ? { ...p, qty: (p.qty || 1) + 1 } : p) });
  };

  const decrementPartById = (partId) => {
    const part = (task.parts || []).find(p => p.id === partId);
    if (!part) return;
    const newQty = (part.qty || 1) - 1;
    if (newQty < 0) return;
    onUpdate({ ...task, parts: (task.parts || []).map(p => p.id === partId ? { ...p, qty: newQty } : p) });
  };

  const decrementLibraryPart = (partName) => {
    const currentParts = task.parts || [];
    const existingIdx = currentParts.findIndex(p => p.name.toLowerCase() === partName.toLowerCase());
    if (existingIdx < 0) return;
    const current = currentParts[existingIdx].qty || 1;
    if (current <= 1) {
      onUpdate({ ...task, parts: currentParts.filter((_, i) => i !== existingIdx) });
    } else {
      const updated = [...currentParts];
      updated[existingIdx] = { ...updated[existingIdx], qty: current - 1 };
      onUpdate({ ...task, parts: updated });
    }
  };

  const parts = task.parts || [];
  const sops = task.sops || [];
  const checkedParts = parts.filter(p => p.checked).length;

  return (
    <div className={`rounded-2xl border transition-colors ${task.status === 'done' ? 'border-zinc-900 bg-zinc-900/30' : task.status === 'blocked' ? (task.blocked_reason === 'Waiting on Parts' ? 'border-yellow-900/50 bg-yellow-900/10' : 'border-red-900/50 bg-red-900/10') : 'border-zinc-800 bg-zinc-900/60'}`}>
      {/* Main row — tap anywhere except the two icon buttons to expand */}
      <div
        className="flex items-center gap-3 px-4 py-4 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <button
          onClick={e => { e.stopPropagation(); cycleStatus(); }}
          className="flex-shrink-0 p-1 -m-1"
        >
          <StatusIcon status={task.status} blockedReason={task.blocked_reason} />
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>
            {task.name}
          </p>
          {task.status === 'blocked' && task.blocked_reason && (
            <p className={`text-xs mt-0.5 ${task.blocked_reason === 'Waiting on Parts' ? 'text-yellow-400' : 'text-red-400'}`}>{task.blocked_reason}</p>
          )}
          {task.status === 'in_progress' && (
            <p className="text-xs mt-0.5 text-blue-400">In Progress</p>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {(task.estimated_hours || task.actual_hours) && (
              <p className="text-xs text-gray-500">
                {task.estimated_hours ? `Est: ${task.estimated_hours}h` : ''}
                {task.estimated_hours && task.actual_hours ? ' · ' : ''}
                {task.actual_hours ? `Actual: ${task.actual_hours}h` : ''}
              </p>
            )}
            {sops.length > 0 && (
              <p className="text-xs text-gray-600 flex items-center gap-1">
                <BookOpen className="w-3 h-3" />{sops.length} SOP{sops.length !== 1 ? 's' : ''}
              </p>
            )}
            {parts.length > 0 && (
              <p className={`text-xs flex items-center gap-1 ${checkedParts === parts.length ? 'text-green-500' : 'text-gray-600'}`}>
                <Package className="w-3 h-3" />{checkedParts}/{parts.length} parts
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {task.status !== 'blocked' && (
            <button
              onClick={e => { e.stopPropagation(); setShowBlockMenu(v => !v); }}
              className="text-gray-600 hover:text-red-400 transition-colors p-2"
              title="Mark as blocked"
            >
              <AlertTriangle className="w-4 h-4" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Block reason menu */}
      {showBlockMenu && (
        <div className="px-4 pb-3 border-t border-zinc-800">
          <p className="text-xs text-gray-500 mt-2 mb-1.5">Why is it blocked?</p>
          <div className="flex flex-wrap gap-1.5">
            {BLOCK_REASONS.map(r => (
              <button key={r} onClick={() => setBlocked(r)}
                className="text-xs bg-zinc-800 border border-zinc-700 text-gray-300 px-3 py-1 rounded-full hover:border-red-500 hover:text-red-400 transition-colors">
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-zinc-800 space-y-4 pt-3" onClick={e => e.stopPropagation()}>

          {/* Time tracking */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Est. hours</label>
              <input
                type="number" min="0" step="0.5"
                value={task.estimated_hours || ''}
                onChange={e => onUpdate({ ...task, estimated_hours: e.target.value })}
                placeholder="—"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-zinc-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Actual hours</label>
              <input
                type="number" min="0" step="0.5"
                value={task.actual_hours || ''}
                onChange={e => onUpdate({ ...task, actual_hours: e.target.value })}
                placeholder="—"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-zinc-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Notes</label>
            <textarea
              value={task.notes || ''}
              onChange={e => onUpdate({ ...task, notes: e.target.value })}
              placeholder="Add a note..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          {/* Attached SOPs */}
          <div onClick={e => e.stopPropagation()}>
            <label className="text-xs text-gray-500 block mb-1.5">Attached SOPs</label>
            <div className="relative">
              {sops.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {sops.map(sop => (
                    <span key={sop.id} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-white text-xs rounded-full overflow-hidden">
                      <button
                        onClick={() => navigate(`/SOPView?id=${sop.id}&returnTo=${encodeURIComponent(window.location.pathname + window.location.search + '&expandTask=' + task.id)}`)}
                        className="flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 hover:bg-zinc-700 transition-colors"
                      >
                        <BookOpen className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="font-medium">{sop.title}</span>
                      </button>
                      <button
                        onClick={() => setSopDetachConfirm(allSOPs.find(s => s.id === sop.id) || sop)}
                        className="text-gray-500 hover:text-white pr-2 py-1.5 hover:bg-zinc-700 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowSOPPicker(v => !v)}
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors"
              >
                <Plus className="w-3 h-3" /> Attach SOP
              </button>
              {showSOPPicker && (
                <SOPPicker
                  allSOPs={allSOPs}
                  attached={sops}
                  onToggle={toggleSOP}
                  onClose={() => setShowSOPPicker(false)}
                />
              )}
            </div>
          </div>

          {/* Parts list */}
          <div>
            <label className="text-xs text-gray-500 block mb-1.5">
              Parts needed
              {parts.length > 0 && <span className="ml-1.5 text-gray-600">{checkedParts}/{parts.length}</span>}
            </label>
            {parts.length > 0 && (
              <div className="space-y-1 mb-2">
                {parts.map(part => {
                  const isLocked = part.sop_qtys && Object.keys(part.sop_qtys).length > 0;
                  const qty = part.qty || 1;
                  const stepperOpen = activeStepperPartId === part.id;
                  const confirmStepper = () => {
                    if (qty === 0) {
                      removePart(part.id);
                    }
                    setActiveStepperPartId(null);
                  };
                  return (
                    <div key={part.id} className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
                      <button
                        onClick={() => togglePart(part.id)}
                        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${part.checked ? 'bg-green-500 border-green-500' : 'border-zinc-600 hover:border-zinc-400'}`}
                      >
                        {part.checked && <Check className="w-3 h-3 text-black" />}
                      </button>
                      <span className={`flex-1 text-sm truncate ${part.checked ? 'line-through text-gray-500' : 'text-white'}`}>
                        {part.name}
                      </span>
                      {stepperOpen ? (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => decrementPartById(part.id)}
                            disabled={qty <= 0}
                            className="w-6 h-6 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white text-sm flex items-center justify-center leading-none transition-all"
                          >−</button>
                          <span className={`text-xs font-semibold w-5 text-center ${qty === 0 ? 'text-red-400' : 'text-white'}`}>{qty}</span>
                          <button
                            onClick={() => incrementPart(part.id)}
                            className="w-6 h-6 rounded bg-zinc-700 hover:bg-zinc-600 text-white flex items-center justify-center transition-all"
                          ><Plus className="w-3 h-3" /></button>
                          <button onClick={confirmStepper} className="w-6 h-6 rounded bg-green-600 hover:bg-green-500 text-white flex items-center justify-center transition-all ml-1">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setActiveStepperPartId(part.id)}
                          className="text-xs text-zinc-500 hover:text-white flex-shrink-0 px-1 transition-colors"
                        >
                          ×{qty}
                        </button>
                      )}
                      {!stepperOpen && !isLocked && (
                        <button onClick={() => removePart(part.id)} className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => setPartsBrowserOpen(true)}
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors"
            >
              <Plus className="w-3 h-3" /> Add part
            </button>
          </div>

          <button onClick={() => onDelete(task.id)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
            Delete task
          </button>
        </div>
      )}

      {partsBrowserOpen && (
        <PartsBrowserSheet
          materials={(task.parts || []).filter(p => p.from_library && !p.from_sop)}
          onAdd={addLibraryPart}
          onDecrement={decrementLibraryPart}
          onClose={() => setPartsBrowserOpen(false)}
        />
      )}

      {sopDetachConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={() => setSopDetachConfirm(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm px-6 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-2">
              <BookOpen className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <p className="text-white font-semibold text-base">Are you sure you want to delete this?</p>
            </div>
            <p className="text-gray-500 text-sm mb-6 pl-8">{sopDetachConfirm.title}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setSopDetachConfirm(null)}
                className="flex-1 py-3 rounded-xl border border-zinc-700 text-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { toggleSOP(sopDetachConfirm); setSopDetachConfirm(null); }}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={() => setShowCompleteConfirm(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm px-6 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-2">
              <Circle className="w-5 h-5 text-blue-400 flex-shrink-0" />
              <p className="text-white font-semibold text-base">Mark this task as complete?</p>
            </div>
            <p className="text-gray-500 text-sm mb-6 pl-8">{task.name}</p>
            <div className="flex gap-3">
              <button
                onClick={() => { onUpdate({ ...task, status: 'not_started' }); setShowCompleteConfirm(false); }}
                className="flex-1 py-3 rounded-xl border border-zinc-700 text-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                No
              </button>
              <button
                onClick={confirmComplete}
                className="flex-1 py-3 rounded-xl bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors"
              >
                Complete
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnblockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={() => setShowUnblockConfirm(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm px-6 py-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-2">
              {task.blocked_reason === 'Waiting on Parts'
                ? <Package className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                : <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />}
              <p className="text-white font-semibold text-base">
                {UNBLOCK_MESSAGES[task.blocked_reason] || 'Are you ready to unblock this task?'}
              </p>
            </div>
            <p className="text-gray-500 text-sm mb-6 pl-8">{task.name}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUnblockConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-zinc-700 text-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                Not yet
              </button>
              <button
                onClick={confirmUnblock}
                className="flex-1 py-3 rounded-xl bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors"
              >
                Yes, unblock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PhaseDetail() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const buildId = params.get('buildId');
  const buildName = params.get('buildName') || 'Build';
  const phaseId = params.get('phaseId');
  const expandTask = params.get('expandTask');

  const [phases, setPhases] = useState([]);
  const [loadingPhases, setLoadingPhases] = useState(true);
  const [buildSheetUrl, setBuildSheetUrl] = useState('');
  const [allSOPs] = useState(() => loadSOPs());
  const [addingTask, setAddingTask] = useState(false);
  const [phasePartsOpen, setPhasePartsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingPhases(true);
    Promise.all([getBuildPhases(buildId), base44.entities.Build.get(buildId)]).then(([p, b]) => {
      if (!active) return;
      setPhases(p);
      setBuildSheetUrl(b?.build_sheet_url || '');
      setLoadingPhases(false);
    });
    return () => { active = false; };
  }, [buildId]);

  const hasBuildSheet = !!buildSheetUrl.trim();
  const phase = phases.find(p => p.id === phaseId);

  const updatePhases = (updated) => {
    setPhases(updated);
    saveBuildPhases(buildId, updated);
  };

  // Parts attached directly to this phase (separate from task parts).
  const addPhasePart = (incoming) => {
    const cur = phase.parts || [];
    const existing = cur.find(p => p.from_library && p.name === incoming.name);
    const parts = existing
      ? cur.map(p => p === existing ? { ...p, qty: (p.qty || 1) + 1 } : p)
      : [...cur, { ...incoming, id: `pp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, qty: 1 }];
    updatePhases(phases.map(p => p.id === phaseId ? { ...p, parts } : p));
  };
  const decrementPhasePart = (name) => {
    const parts = (phase.parts || [])
      .map(p => (p.from_library && p.name === name) ? { ...p, qty: (p.qty || 1) - 1 } : p)
      .filter(p => (p.qty || 0) > 0);
    updatePhases(phases.map(p => p.id === phaseId ? { ...p, parts } : p));
  };

  // All parts in this phase: direct phase parts + parts on its tasks (merged by name).
  const aggregatedParts = () => {
    const map = new Map();
    const push = (p) => {
      const key = (p.name || '').trim().toLowerCase();
      if (!key) return;
      const ex = map.get(key);
      if (ex) ex.qty += (p.qty || 1);
      else map.set(key, { name: p.name, supplier: p.supplier, supplierLink: p.supplierLink, partNum: p.partNum, price: p.price, qty: p.qty || 1 });
    };
    (phase?.parts || []).forEach(push);
    (phase?.tasks || []).forEach(t => (t.parts || []).forEach(push));
    return [...map.values()];
  };

  const updateTask = (updatedTask) => {
    updatePhases(phases.map(p => p.id === phaseId
      ? { ...p, tasks: p.tasks.map(t => t.id === updatedTask.id ? updatedTask : t) }
      : p
    ));
  };

  const deleteTask = (taskId) => {
    updatePhases(phases.map(p => p.id === phaseId
      ? { ...p, tasks: p.tasks.filter(t => t.id !== taskId) }
      : p
    ));
  };

  const addTask = (task) => {
    updatePhases(phases.map(p => p.id === phaseId
      ? { ...p, tasks: [...(p.tasks || []), task] }
      : p
    ));
    setAddingTask(false);
  };

  if (loadingPhases) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
    </div>
  );

  if (!phase) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-500">Phase not found.</p>
    </div>
  );

  const tasks = phase.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const waitingOnParts = tasks.filter(t => t.status === 'blocked' && t.blocked_reason === 'Waiting on Parts').length;
  const blockedNonParts = tasks.filter(t => t.status === 'blocked' && t.blocked_reason !== 'Waiting on Parts').length;
  const hasAllPartsChecked = tasks.some(t => t.status !== 'done' && (t.parts || []).length > 0 && (t.parts || []).every(p => p.checked));
  const headerCountColor = inProgress > 0 ? 'text-blue-400' : hasAllPartsChecked ? 'text-green-400' : blockedNonParts > 0 ? 'text-red-400' : waitingOnParts > 0 ? 'text-yellow-400' : 'text-gray-500';
  const totalEst = tasks.reduce((sum, t) => sum + (parseFloat(t.estimated_hours) || 0), 0);
  const totalActual = tasks.reduce((sum, t) => sum + (parseFloat(t.actual_hours) || 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800">
        <button onClick={() => navigate(`/BuildPhases?id=${buildId}&name=${encodeURIComponent(buildName)}`)} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">{phase.name}</h1>
          <p className="text-xs mt-0.5">
            <span className={headerCountColor}>{done}/{tasks.length} done</span>
            {(blocked > 0 || inProgress > 0) && (
              <span className="inline-flex items-center gap-1 ml-1">
                {inProgress > 0 && <Circle className="w-3 h-3 text-blue-400" />}
                {blockedNonParts > 0 && <AlertTriangle className="w-3 h-3 text-red-400" />}
                {waitingOnParts > 0 && <Package className="w-3 h-3 text-yellow-400" />}
              </span>
            )}
            {totalEst > 0 && <span> · {totalEst}h est{totalActual > 0 ? ` / ${totalActual}h actual` : ''}</span>}
          </p>
        </div>
        {hasBuildSheet ? (
          <button
            onClick={() => setPhasePartsOpen(true)}
            className="flex-shrink-0 flex items-center gap-1.5 bg-white text-black text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add part
          </button>
        ) : (
          <button
            onClick={() => navigate(`/BuildSheet?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
            className="flex-shrink-0 text-xs text-gray-500 hover:text-white underline underline-offset-2"
          >
            Link a build sheet to add parts
          </button>
        )}
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="h-1 bg-zinc-900">
          <div className="h-1 bg-white transition-all duration-500" style={{ width: `${(done / tasks.length) * 100}%` }} />
        </div>
      )}

      {/* Parts in this phase */}
      {(() => {
        const parts = aggregatedParts();
        if (parts.length === 0) return null;
        return (
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800">
                <Package className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-white">Parts</span>
                <span className="text-xs text-gray-500">{parts.length}</span>
              </div>
              {parts.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-900 last:border-b-0">
                  <div className="min-w-0">
                    <span className="text-white text-sm">{p.name}</span>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      {p.supplierLink ? (
                        <a href={p.supplierLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs underline underline-offset-2">{p.supplier || 'Link'}</a>
                      ) : p.supplier ? <span className="text-gray-500 text-xs">{p.supplier}</span> : null}
                      {p.partNum && <span className="text-gray-400 font-mono text-xs">{p.partNum}</span>}
                      {p.price && <span className="text-gray-400 text-xs">{p.price}</span>}
                    </div>
                  </div>
                  <span className="text-gray-300 text-sm font-semibold flex-shrink-0">×{p.qty}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Tasks */}
      <div className="flex-1 px-4 py-4 space-y-2">
        {tasks.length === 0 && !addingTask && (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-1">No tasks yet</p>
            <p className="text-gray-600 text-sm">Add tasks to track work in this phase</p>
          </div>
        )}

        {tasks.map(task => (
          <TaskRow key={task.id} task={task} onUpdate={updateTask} onDelete={deleteTask} allSOPs={allSOPs} navigate={navigate} initialExpanded={task.id === expandTask} />
        ))}

        {addingTask ? (
          <AddTaskPanel allSOPs={allSOPs} onAdd={addTask} onCancel={() => setAddingTask(false)} />
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            className="w-full flex items-center gap-2 justify-center px-5 py-3 rounded-2xl border border-dashed border-zinc-700 text-gray-500 hover:text-white hover:border-zinc-500 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Task
          </button>
        )}
      </div>

      {phasePartsOpen && (
        <PartsBrowserSheet
          materials={(phase.parts || []).filter(p => p.from_library)}
          onAdd={addPhasePart}
          onDecrement={decrementPhasePart}
          onClose={() => setPhasePartsOpen(false)}
        />
      )}
    </div>
  );
}
