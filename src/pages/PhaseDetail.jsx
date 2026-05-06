import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Clock, AlertTriangle, CheckCircle2, Circle,
  ChevronDown, X, BookOpen, Package, Search, Check, Trash2
} from 'lucide-react';

const BLOCK_REASONS = ['Waiting on Parts', 'Waiting on Customer', 'Waiting on Subcontractor', 'Other'];
const STATUS_CYCLE = { not_started: 'in_progress', in_progress: 'done', done: 'not_started' };

function loadPhases(buildId) {
  try {
    const stored = localStorage.getItem(`buildPhases_${buildId}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function savePhases(buildId, phases) {
  localStorage.setItem(`buildPhases_${buildId}`, JSON.stringify(phases));
}

function loadSOPs() {
  try {
    const stored = localStorage.getItem('localdb_SOP');
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function StatusIcon({ status }) {
  if (status === 'done') return <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />;
  if (status === 'blocked') return <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />;
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
              {sop.materials?.length > 0 && (
                <span className="text-xs text-gray-600 flex-shrink-0">{sop.materials.length} parts</span>
              )}
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
      // detach SOP and remove its auto-added parts
      setAttachedSOPs(prev => prev.filter(a => a.id !== sop.id));
      setParts(prev => prev.filter(p => p.from_sop !== sop.id));
    } else {
      // attach SOP and import its materials
      setAttachedSOPs(prev => [...prev, { id: sop.id, title: sop.title }]);
      const materials = Array.isArray(sop.materials) ? sop.materials : [];
      const newParts = materials
        .filter(m => m?.name?.trim())
        .map(m => ({
          id: `${sop.id}_${m.name}_${Date.now()}_${Math.random()}`,
          name: m.name.trim(),
          note: m.location || '',
          from_sop: sop.id,
          from_sop_title: sop.title,
          checked: false,
        }));
      setParts(prev => [...prev, ...newParts]);
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
function TaskRow({ task, onUpdate, onDelete, allSOPs = [], navigate }) {
  const [expanded, setExpanded] = useState(false);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [showSOPPicker, setShowSOPPicker] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [newPartName, setNewPartName] = useState('');

  const cycleStatus = () => {
    if (task.status === 'blocked') {
      onUpdate({ ...task, status: 'not_started', blocked_reason: null });
    } else {
      onUpdate({ ...task, status: STATUS_CYCLE[task.status] || 'not_started' });
    }
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
      onUpdate({
        ...task,
        sops: currentSOPs.filter(a => a.id !== sop.id),
        parts: currentParts.filter(p => p.from_sop !== sop.id),
      });
    } else {
      const materials = Array.isArray(sop.materials) ? sop.materials : [];
      const newParts = materials
        .filter(m => m?.name?.trim())
        .map(m => ({
          id: `${sop.id}_${m.name}_${Date.now()}_${Math.random()}`,
          name: m.name.trim(),
          note: m.location || '',
          from_sop: sop.id,
          from_sop_title: sop.title,
          checked: false,
        }));
      onUpdate({
        ...task,
        sops: [...currentSOPs, { id: sop.id, title: sop.title }],
        parts: [...currentParts, ...newParts],
      });
    }
  };

  const addPart = () => {
    if (!newPartName.trim()) return;
    onUpdate({
      ...task,
      parts: [...(task.parts || []), {
        id: `manual_${Date.now()}`,
        name: newPartName.trim(),
        note: '',
        from_sop: null,
        from_sop_title: null,
        checked: false,
      }]
    });
    setNewPartName('');
    setAddingPart(false);
  };

  const parts = task.parts || [];
  const sops = task.sops || [];
  const checkedParts = parts.filter(p => p.checked).length;

  return (
    <div className={`rounded-2xl border transition-colors ${task.status === 'done' ? 'border-zinc-900 bg-zinc-900/30' : task.status === 'blocked' ? 'border-red-900/50 bg-red-900/10' : 'border-zinc-800 bg-zinc-900/60'}`}>
      {/* Main row — tap anywhere except the two icon buttons to expand */}
      <div
        className="flex items-center gap-3 px-4 py-4 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <button
          onClick={e => { e.stopPropagation(); cycleStatus(); }}
          className="flex-shrink-0 p-1 -m-1"
        >
          <StatusIcon status={task.status} />
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'line-through text-gray-500' : 'text-white'}`}>
            {task.name}
          </p>
          {task.status === 'blocked' && task.blocked_reason && (
            <p className="text-xs text-red-400 mt-0.5">{task.blocked_reason}</p>
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
                        onClick={() => navigate(`/SOPView?id=${sop.id}`)}
                        className="flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 hover:bg-zinc-700 transition-colors"
                      >
                        <BookOpen className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="font-medium">{sop.title}</span>
                      </button>
                      <button
                        onClick={() => toggleSOP(allSOPs.find(s => s.id === sop.id) || sop)}
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
                {parts.map(part => (
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
                    {part.from_sop_title && (
                      <span className="text-xs text-gray-600 truncate max-w-[80px] flex-shrink-0">{part.from_sop_title}</span>
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
                  onKeyDown={e => { if (e.key === 'Enter') addPart(); if (e.key === 'Escape') setAddingPart(false); }}
                  placeholder="Part name..."
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-zinc-500"
                />
                <button onClick={addPart} className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs px-3 py-1.5 rounded-lg">Add</button>
                <button onClick={() => setAddingPart(false)} className="text-gray-500 px-1"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <button
                onClick={() => setAddingPart(true)}
                className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors"
              >
                <Plus className="w-3 h-3" /> Add part
              </button>
            )}
          </div>

          <button onClick={() => onDelete(task.id)} className="text-xs text-red-500 hover:text-red-400 transition-colors">
            Delete task
          </button>
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

  const [phases, setPhases] = useState(() => loadPhases(buildId));
  const [allSOPs] = useState(() => loadSOPs());
  const [addingTask, setAddingTask] = useState(false);

  const phase = phases.find(p => p.id === phaseId);

  const updatePhases = (updated) => {
    setPhases(updated);
    savePhases(buildId, updated);
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

  if (!phase) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-500">Phase not found.</p>
    </div>
  );

  const tasks = phase.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
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
          <p className="text-gray-500 text-xs mt-0.5">
            {done}/{tasks.length} done
            {blocked > 0 && <span className="text-red-400"> · {blocked} blocked</span>}
            {totalEst > 0 && <span> · {totalEst}h est{totalActual > 0 ? ` / ${totalActual}h actual` : ''}</span>}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="h-1 bg-zinc-900">
          <div className="h-1 bg-white transition-all duration-500" style={{ width: `${(done / tasks.length) * 100}%` }} />
        </div>
      )}

      {/* Tasks */}
      <div className="flex-1 px-4 py-4 space-y-2">
        {tasks.length === 0 && !addingTask && (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-1">No tasks yet</p>
            <p className="text-gray-600 text-sm">Add tasks to track work in this phase</p>
          </div>
        )}

        {tasks.map(task => (
          <TaskRow key={task.id} task={task} onUpdate={updateTask} onDelete={deleteTask} allSOPs={allSOPs} navigate={navigate} />
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
    </div>
  );
}
