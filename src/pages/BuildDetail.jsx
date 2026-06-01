import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Package, Users, FileText, Settings, Trash2, GripVertical, Check, CheckSquare } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { motion } from 'framer-motion';
import LongPressRow from '@/components/LongPressRow';


const urlParams = () => new URLSearchParams(window.location.search);

const DEFAULT_FOLDERS = [
  { id: 'phases', label: 'Phases & Tasks', icon: 'CheckSquare' },
  { id: 'parts', label: 'Parts', icon: 'Package' },
  { id: 'sops', label: 'Work Order', icon: 'FileText' },
  { id: 'notes', label: 'Meeting Notes', icon: 'Users' },
  { id: 'cabinets', label: 'Cabinets Hardware', icon: 'Package' },
];

const ICONS = { Package, FileText, Users, CheckSquare };

function getFolderPath(id, buildId, buildName) {
  if (id === 'phases') return `/BuildPhases?id=${buildId}&name=${encodeURIComponent(buildName)}`;
  if (id === 'parts') return `/BuildParts?id=${buildId}&name=${encodeURIComponent(buildName)}`;
  if (id === 'notes') return `/MeetingNotes?id=${buildId}&name=${encodeURIComponent(buildName)}`;
  if (id === 'sops') return `/BuildWorkOrder?id=${buildId}&name=${encodeURIComponent(buildName)}`;
  if (id === 'cabinets') return `/BuildParts?id=${buildId}&name=${encodeURIComponent(buildName)}&category=cabinets`;
  return null;
}

function loadFolders(buildId) {
  try {
    const stored = JSON.parse(localStorage.getItem(`buildFolders_${buildId}`));
    if (stored && Array.isArray(stored)) {
      // Merge: use saved order/label for known folders, append any new defaults not yet saved
      const merged = DEFAULT_FOLDERS.map(def => {
        const saved = stored.find(s => s.id === def.id);
        return saved ? { ...def, label: saved.label, order: saved.order ?? 999 } : { ...def, order: 999 };
      }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      return merged;
    }
  } catch {}
  return DEFAULT_FOLDERS;
}

function saveFolders(buildId, folders) {
  localStorage.setItem(`buildFolders_${buildId}`, JSON.stringify(
    folders.map((f, i) => ({ id: f.id, label: f.label, order: i }))
  ));
}

export default function BuildDetail() {
  const navigate = useNavigate();
  const params = urlParams();
  const buildId = params.get('id');
  const buildName = params.get('name') || 'Build';

  const [folders, setFolders] = useState(() => loadFolders(buildId));
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [buildNameValue, setBuildNameValue] = useState(buildName);
  const inputRef = useRef(null);
  const nameInputRef = useRef(null);

  const handleSettingsClick = () => {
    if (editing) {
      setEditing(false);
      setEditingId(null);
      setShowDelete(false);
    } else {
      setEditing(true);
      setBuildNameValue(buildName);
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  };

  const commitBuildRename = async () => {
    const trimmed = buildNameValue.trim();
    if (!trimmed || trimmed === buildName) return;
    await base44.entities.Build.update(buildId, { name: trimmed });
    // Update URL so back-navigation reflects new name
    window.history.replaceState(null, '', `/BuildDetail?id=${buildId}&name=${encodeURIComponent(trimmed)}`);
  };

  const handleFolderClick = (folder) => {
    if (editing) {
      setEditingId(folder.id);
      setEditValue(folder.label);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      const path = getFolderPath(folder.id, buildId, buildName);
      if (path) navigate(path);
    }
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      const updated = folders.map(f => f.id === editingId ? { ...f, label: editValue.trim() } : f);
      setFolders(updated);
      saveFolders(buildId, updated);
    }
    setEditingId(null);
    setEditValue('');
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = Array.from(folders);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setFolders(reordered);
    saveFolders(buildId, reordered);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await base44.entities.Build.delete(buildId);
    navigate('/Builds');
  };

  return (
    <div className="min-h-screen p-6">
      {/* Floating settings button — bottom left */}
      <button
        onClick={handleSettingsClick}
        className={`fixed bottom-5 left-5 z-50 p-2.5 rounded-full backdrop-blur-sm transition-all duration-200 ${editing ? 'bg-yellow-400/20 text-yellow-400' : 'bg-zinc-800/80 text-gray-400 hover:text-white hover:bg-zinc-700/80'}`}
      >
        {editing ? <Check className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
      </button>

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button onClick={() => navigate('/Builds')} className="text-gray-400 hover:text-white transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          {editing ? (
            <input
              ref={nameInputRef}
              value={buildNameValue}
              onChange={e => setBuildNameValue(e.target.value)}
              onBlur={commitBuildRename}
              onKeyDown={e => { if (e.key === 'Enter') { commitBuildRename(); nameInputRef.current?.blur(); } if (e.key === 'Escape') { setBuildNameValue(buildName); nameInputRef.current?.blur(); } }}
              className="flex-1 text-4xl font-bold text-white tracking-tight bg-transparent border-b-2 border-zinc-600 focus:border-white focus:outline-none pb-1"
            />
          ) : (
            <h1 className="text-4xl font-bold text-white tracking-tight">{buildNameValue}</h1>
          )}
        </div>

        {/* Folders */}
        <div className="space-y-3">
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="folders" isDropDisabled={!editing}>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3">
                  {folders.map((folder, index) => {
                    const Icon = ICONS[folder.icon];
                    const isEditingThis = editingId === folder.id;
                    return (
                      <Draggable key={folder.id} draggableId={folder.id} index={index} isDragDisabled={!editing}>
                       {(drag, snapshot) => (
                         <LongPressRow
                           label={folder.label}
                           icon={folder.icon}
                           path={getFolderPath(folder.id, buildId, buildName)}
                           onClick={() => handleFolderClick(folder)}
                           className={`w-full flex items-center justify-between px-6 py-5 cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors duration-150 ${snapshot.isDragging ? 'opacity-50' : ''}`}
                           style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
                           innerRef={drag.innerRef}
                           dragHandleProps={drag.draggableProps}
                         >
                             <div className="flex items-center gap-3 flex-1 min-w-0">
                               {editing && (
                                 <span {...drag.dragHandleProps} className="text-gray-500 hover:text-white cursor-grab flex-shrink-0" onClick={e => e.stopPropagation()}>
                                   <GripVertical className="w-4 h-4" />
                                 </span>
                               )}
                               {Icon && <Icon className="w-5 h-5 text-gray-400 flex-shrink-0" />}
                               {isEditingThis ? (
                                 <input
                                   ref={inputRef}
                                   value={editValue}
                                   onChange={e => setEditValue(e.target.value)}
                                   onBlur={commitEdit}
                                   onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                                   onClick={e => e.stopPropagation()}
                                   className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-white text-lg font-medium focus:outline-none focus:border-zinc-400"
                                 />
                               ) : (
                                 <span className="text-lg font-medium tracking-wide text-white">{folder.label}</span>
                               )}
                             </div>
                             {!editing && <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0" />}
                         </LongPressRow>
                       )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>

        {/* Delete section — always reserves space */}
        <div className="mt-6 h-10 flex items-center">
          {editing && !showDelete && (
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 text-red-500 hover:text-red-400 transition-colors text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              Delete Build
            </button>
          )}
          {editing && showDelete && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => setShowDelete(false)}
                className="text-gray-500 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}