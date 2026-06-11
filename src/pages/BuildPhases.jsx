import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, ChevronRight, Circle, ToggleLeft, ToggleRight, GripVertical, AlertTriangle, Package } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { getBuildPhases, saveBuildPhases } from '@/api/buildsDb';
import { base44 } from '@/api/base44Client';
import PartsBrowserSheet from '@/components/PartsBrowserSheet';

function phaseProgress(phase) {
  const tasks = phase.tasks || [];
  if (!tasks.length) return null;
  const done = tasks.filter(t => t.status === 'done').length;
  return { done, total: tasks.length };
}

function phaseStatus(phase) {
  const tasks = phase.tasks || [];
  if (!tasks.length) return 'empty';
  if (tasks.every(t => t.status === 'done')) return 'done';
  if (tasks.some(t => t.status === 'blocked')) return 'blocked';
  if (tasks.some(t => t.status === 'in_progress' || t.status === 'done')) return 'in_progress';
  return 'not_started';
}

const STATUS_COLORS = {
  done: 'text-green-400',
  blocked: 'text-red-400',
  in_progress: 'text-blue-400',
  not_started: 'text-gray-500',
  empty: 'text-gray-700',
};

const STATUS_LABELS = {
  done: 'Complete',
  blocked: 'Blocked',
  in_progress: 'In Progress',
  not_started: 'Not Started',
  empty: 'No tasks yet',
};

export default function BuildPhases() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const buildId = params.get('id');
  const buildName = params.get('name') || 'Build';

  const [phases, setPhases] = useState([]);
  const [editing, setEditing] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);
  const [buildSheetUrl, setBuildSheetUrl] = useState('');
  const [pickingPhase, setPickingPhase] = useState(false); // phase picker open
  const [partsPhaseId, setPartsPhaseId] = useState(null);   // phase chosen → browser open

  useEffect(() => {
    let active = true;
    Promise.all([getBuildPhases(buildId), base44.entities.Build.get(buildId)]).then(([p, b]) => {
      if (!active) return;
      setPhases(p);
      setBuildSheetUrl(b?.build_sheet_url || '');
    });
    return () => { active = false; };
  }, [buildId]);

  const hasBuildSheet = !!buildSheetUrl.trim();

  const update = (updated) => {
    setPhases(updated);
    saveBuildPhases(buildId, updated);
  };

  // Add/inc a library part on a chosen phase (phase.parts).
  const addPartToPhase = (phaseId, incoming) => {
    const target = phases.find(p => p.id === phaseId);
    const cur = target?.parts || [];
    const existing = cur.find(p => p.from_library && p.name === incoming.name);
    const parts = existing
      ? cur.map(p => p === existing ? { ...p, qty: (p.qty || 1) + 1 } : p)
      : [...cur, { ...incoming, id: `pp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, qty: 1 }];
    update(phases.map(p => p.id === phaseId ? { ...p, parts } : p));
  };
  const decrementPartOnPhase = (phaseId, name) => {
    const target = phases.find(p => p.id === phaseId);
    const parts = (target?.parts || [])
      .map(p => (p.from_library && p.name === name) ? { ...p, qty: (p.qty || 1) - 1 } : p)
      .filter(p => (p.qty || 0) > 0);
    update(phases.map(p => p.id === phaseId ? { ...p, parts } : p));
  };

  const togglePhase = (id) => {
    update(phases.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const addPhase = () => {
    if (!newPhaseName.trim()) return;
    const phase = { id: Date.now().toString(), name: newPhaseName.trim(), enabled: true, tasks: [] };
    update([...phases, phase]);
    setNewPhaseName('');
    setAddingPhase(false);
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = Array.from(phases);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    update(reordered);
  };

  const enabledPhases = phases.filter(p => p.enabled !== false);
  const totalTasks = enabledPhases.reduce((sum, p) => sum + (p.tasks?.length || 0), 0);
  const doneTasks = enabledPhases.reduce((sum, p) => sum + (p.tasks?.filter(t => t.status === 'done').length || 0), 0);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/BuildDetail?id=${buildId}&name=${encodeURIComponent(buildName)}`)} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{buildName}</h1>
            <p className="text-gray-500 text-xs mt-0.5">
              {totalTasks > 0 ? `${doneTasks}/${totalTasks} tasks complete` : 'No tasks yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasBuildSheet && !editing && (
            <button
              onClick={() => setPickingPhase(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white text-black font-semibold hover:bg-gray-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add a Part
            </button>
          )}
          <button
            onClick={() => setEditing(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${editing ? 'border-yellow-500 text-yellow-400' : 'border-zinc-700 text-gray-400 hover:text-white'}`}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {totalTasks > 0 && (
        <div className="h-1 bg-zinc-900">
          <div className="h-1 bg-white transition-all duration-500" style={{ width: `${(doneTasks / totalTasks) * 100}%` }} />
        </div>
      )}

      {/* Phases list */}
      <div className="flex-1 px-4 py-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="phases" isDropDisabled={!editing}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
                {phases.map((phase, index) => {
                  const prog = phaseProgress(phase);
                  const status = phaseStatus(phase);
                  const enabled = phase.enabled !== false;
                  const hasWaitingOnParts = (phase.tasks || []).some(t => t.status === 'blocked' && t.blocked_reason === 'Waiting on Parts');
                  const hasBlockedNonParts = (phase.tasks || []).some(t => t.status === 'blocked' && t.blocked_reason !== 'Waiting on Parts');
                  const hasInProgress = (phase.tasks || []).some(t => t.status === 'in_progress');
                  const hasNotStarted = (phase.tasks || []).some(t => t.status === 'not_started');
                  const hasAllPartsChecked = (phase.tasks || []).some(t => t.status !== 'done' && (t.parts || []).length > 0 && (t.parts || []).every(p => p.checked));
                  const countColor = hasInProgress ? 'text-blue-400' : hasAllPartsChecked ? 'text-green-400' : hasNotStarted ? 'text-gray-500' : hasBlockedNonParts ? 'text-red-400' : hasWaitingOnParts ? 'text-yellow-400' : 'text-gray-500';

                  return (
                    <Draggable key={phase.id} draggableId={phase.id} index={index} isDragDisabled={!editing}>
                      {(drag) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={`flex items-center justify-between px-5 py-4 rounded-2xl border transition-colors ${enabled ? 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900' : 'border-zinc-900 bg-zinc-900/20 opacity-40'}`}
                          onClick={() => !editing && enabled && navigate(`/PhaseDetail?buildId=${buildId}&buildName=${encodeURIComponent(buildName)}&phaseId=${phase.id}`)}
                          style={{ cursor: editing ? 'default' : enabled ? 'pointer' : 'default' }}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            {editing && (
                              <span {...drag.dragHandleProps} className="text-gray-600 hover:text-gray-400 cursor-grab" onClick={e => e.stopPropagation()}>
                                <GripVertical className="w-4 h-4" />
                              </span>
                            )}
                            <div className="min-w-0">
                              <span className="text-white font-medium truncate block">{phase.name}</span>
                              <span className="text-xs inline-flex items-center gap-1">
                                {prog
                                  ? <span className={countColor}>{prog.done}/{prog.total} tasks</span>
                                  : <span className="text-gray-700">{STATUS_LABELS['empty']}</span>}
                                {status === 'done' && <span className="text-green-400"> · Complete</span>}
                                {hasInProgress && <Circle className="w-3 h-3 text-blue-400" />}
                                {hasBlockedNonParts && <AlertTriangle className="w-3 h-3 text-red-400" />}
                                {hasWaitingOnParts && <Package className="w-3 h-3 text-yellow-400" />}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            {editing ? (
                              <button onClick={(e) => { e.stopPropagation(); togglePhase(phase.id); }} className="text-gray-400 hover:text-white transition-colors">
                                {enabled ? <ToggleRight className="w-6 h-6 text-white" /> : <ToggleLeft className="w-6 h-6" />}
                              </button>
                            ) : (
                              enabled && <ChevronRight className="w-5 h-5 text-gray-500" />
                            )}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Add phase */}
        {editing && (
          <div className="mt-3">
            {addingPhase ? (
              <div className="flex gap-2 mt-2">
                <input
                  autoFocus
                  value={newPhaseName}
                  onChange={e => setNewPhaseName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addPhase(); if (e.key === 'Escape') setAddingPhase(false); }}
                  placeholder="Phase name..."
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-zinc-500"
                />
                <button onClick={addPhase} className="bg-white text-black font-semibold px-4 py-2 rounded-xl text-sm hover:bg-gray-200">Add</button>
                <button onClick={() => setAddingPhase(false)} className="text-gray-500 px-3">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAddingPhase(true)} className="w-full flex items-center gap-2 justify-center px-5 py-3 rounded-2xl border border-dashed border-zinc-700 text-gray-500 hover:text-white hover:border-zinc-500 transition-colors text-sm mt-2">
                <Plus className="w-4 h-4" />
                Add Phase
              </button>
            )}
          </div>
        )}
      </div>

      {/* Which-phase picker */}
      {pickingPhase && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setPickingPhase(false)} />
          <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-6 max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white mb-1">Add a part to…</h2>
            <p className="text-gray-500 text-xs mb-4">Pick the phase this part belongs to.</p>
            <div className="space-y-1.5">
              {enabledPhases.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setPartsPhaseId(p.id); setPickingPhase(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 text-left transition-colors"
                >
                  <span className="text-white text-sm">{p.name}</span>
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Parts browser for the chosen phase */}
      {partsPhaseId && (
        <PartsBrowserSheet
          materials={(phases.find(p => p.id === partsPhaseId)?.parts || []).filter(p => p.from_library)}
          onAdd={(part) => addPartToPhase(partsPhaseId, part)}
          onDecrement={(name) => decrementPartOnPhase(partsPhaseId, name)}
          onClose={() => setPartsPhaseId(null)}
        />
      )}
    </div>
  );
}
