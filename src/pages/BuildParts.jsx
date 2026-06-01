import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Folder, FolderOpen, ChevronRight, ChevronDown, Package } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

function PartRow({ part, onRemove, onUpdateQty }) {
  const [inputVal, setInputVal] = useState(String(part.quantity || 1));

  // Keep local input in sync if part.quantity changes externally
  useEffect(() => {
    setInputVal(String(part.quantity || 1));
  }, [part.quantity]);

  const handleBlur = () => {
    const val = parseInt(inputVal);
    if (!isNaN(val) && val >= 1 && val <= 1000) {
      onUpdateQty(part._globalIndex, val);
    } else {
      setInputVal(String(part.quantity || 1));
    }
  };

  return (
    <div className="flex items-center justify-between px-8 py-3 border-b border-zinc-900 last:border-b-0">
      <div>
        <p className="text-white text-sm font-medium">{part.partName}</p>
        <div className="flex gap-3 mt-0.5">
          {part.supplier && (
            part.supplierLink
              ? <a href={part.supplierLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-xs">{part.supplier}</a>
              : <span className="text-gray-500 text-xs">{part.supplier}</span>
          )}
          {part.partNum && <span className="text-gray-600 text-xs font-mono">{part.partNum}</span>}
          {part.price && <span className="text-gray-500 text-xs">{part.price}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        <div className="flex items-center gap-1 bg-zinc-800 rounded px-1 py-0.5">
          <button onClick={() => { const v = Math.max(1, parseInt(inputVal||1) - 1); setInputVal(String(v)); onUpdateQty(part._globalIndex, v); }} className="text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center text-sm font-bold">−</button>
          <input
            type="number"
            value={inputVal}
            min={1}
            max={1000}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            className="w-10 text-center text-white text-xs bg-transparent focus:outline-none"
          />
          <button onClick={() => { const v = Math.min(1000, parseInt(inputVal||1) + 1); setInputVal(String(v)); onUpdateQty(part._globalIndex, v); }} className="text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center text-sm font-bold">+</button>
        </div>
        <button onClick={() => onRemove(part._globalIndex)} className="text-gray-600 hover:text-red-500 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SheetTabFolder({ tabName, parts, onRemove, onUpdateQty }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <FolderOpen className="w-4 h-4 text-gray-400" /> : <Folder className="w-4 h-4 text-gray-400" />}
          <span className="text-white font-medium">{tabName}</span>
          <span className="text-gray-500 text-sm">({parts.length})</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>

      {open && (
        <div className="bg-black border-t border-zinc-800">
          {parts.map((part) => (
            <PartRow
              key={part._globalIndex}
              part={part}
              onRemove={onRemove}
              onUpdateQty={onUpdateQty}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BuildParts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const buildId = urlParams.get('id');
  const buildName = urlParams.get('name') || 'Build';

  const { data: build, isLoading } = useQuery({
    queryKey: ['build', buildId],
    queryFn: async () => {
      const { data } = await supabase.from('builds').select('*').eq('id', buildId).single();
      return data;
    },
    enabled: !!buildId,
  });

  const parts = build?.parts || [];

  const removeMutation = useMutation({
    mutationFn: (index) => {
      const newParts = parts.filter((_, i) => i !== index);
      return supabase.from('builds').update({ parts: newParts }).eq('id', buildId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['build', buildId] }),
  });

  const updateQtyMutation = useMutation({
    mutationFn: ({ index, qty }) => {
      const newParts = parts.map((p, i) => i === index ? { ...p, quantity: qty } : p);
      return supabase.from('builds').update({ parts: newParts }).eq('id', buildId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['build', buildId] }),
  });

  // Aggregate parts from tasks in localStorage
  const taskParts = useMemo(() => {
    try {
      const phases = JSON.parse(localStorage.getItem(`buildPhases_${buildId}`) || '[]');
      const map = {};
      phases.forEach(phase => {
        (phase.tasks || []).forEach(task => {
          (task.parts || []).forEach(part => {
            if (!part.name) return;
            const key = part.name.toLowerCase().trim();
            if (!map[key]) {
              map[key] = {
                name: part.name,
                partNum: part.partNum || '',
                supplier: part.supplier || '',
                supplierLink: part.supplierLink || '',
                price: part.price || '',
                qty: 0,
                tasks: [],
              };
            }
            map[key].qty += (part.qty || 1);
            if (!map[key].tasks.includes(task.name)) {
              map[key].tasks.push(task.name);
            }
          });
        });
      });
      return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  }, [buildId]);

  // Group parts by sheetTab only (top-level folder, no sub-folders)
  const grouped = {};
  parts.forEach((part, index) => {
    const tab = part.sheetTab || 'Uncategorized';
    if (!grouped[tab]) grouped[tab] = [];
    grouped[tab].push({ ...part, _globalIndex: index });
  });

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/BuildDetail?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <p className="text-gray-500 text-sm">{buildName}</p>
              <h1 className="text-3xl font-bold text-white tracking-tight">Parts</h1>
            </div>
          </div>
          <button
            onClick={() => navigate(`/BuildPartsLibrary?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
            className="flex items-center gap-2 bg-white text-black font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Part
          </button>
        </div>

        {/* Parts from Tasks */}
        {taskParts.length > 0 && (
          <div className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 mb-4" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <div className="flex items-center gap-2 px-6 py-4 border-b border-zinc-800">
              <Package className="w-4 h-4 text-gray-400" />
              <h2 className="text-white font-semibold text-sm">From Tasks</h2>
              <span className="text-gray-500 text-xs">({taskParts.length})</span>
            </div>
            {taskParts.map((part, i) => (
              <div key={i} className="flex items-start justify-between px-6 py-3 border-b border-zinc-900 last:border-b-0">
                <div className="flex-1 min-w-0 mr-4">
                  <p className="text-white text-sm font-medium">{part.name}</p>
                  <div className="flex flex-wrap gap-2 mt-0.5">
                    {part.partNum && <span className="text-gray-500 font-mono text-xs">{part.partNum}</span>}
                    {part.supplier && (
                      part.supplierLink
                        ? <a href={part.supplierLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-xs">{part.supplier}</a>
                        : <span className="text-gray-500 text-xs">{part.supplier}</span>
                    )}
                    {part.price && <span className="text-gray-500 text-xs">{part.price}</span>}
                  </div>
                  <p className="text-gray-600 text-xs mt-1">{part.tasks.join(', ')}</p>
                </div>
                <span className="text-gray-400 text-sm font-semibold flex-shrink-0">×{part.qty}</span>
              </div>
            ))}
          </div>
        )}

        {/* Parts grouped by sheet tab */}
        <div className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {isLoading && <div className="px-6 py-5 text-gray-500 text-sm">Loading...</div>}

          {!isLoading && parts.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 text-lg mb-2">No parts added yet</p>
              <p className="text-gray-600 text-sm mb-6">Browse the parts library to add parts</p>
              <button
                onClick={() => navigate(`/BuildPartsLibrary?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
                className="bg-white text-black font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Browse Parts Library
              </button>
            </div>
          )}

          {Object.entries(grouped).map(([tabName, tabParts]) => (
            <SheetTabFolder
              key={tabName}
              tabName={tabName}
              parts={tabParts}
              onRemove={(index) => removeMutation.mutate(index)}
              onUpdateQty={(index, qty) => updateQtyMutation.mutate({ index, qty })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}