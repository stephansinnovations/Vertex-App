import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function extractSpreadsheetId(url) {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function PartRow({ part, onAdd, onRemove, onUpdateQty, isAdded, addedQty }) {
  const [qty, setQty] = useState(1);

  const currentQty = isAdded ? addedQty : qty;

  const handleAdd = () => {
    onAdd({ ...part, quantity: qty });
  };

  const handleQtyChange = (newQty) => {
    if (newQty < 1 || newQty > 1000) return;
    if (isAdded) {
      onUpdateQty(newQty);
    } else {
      setQty(newQty);
    }
  };

  return (
    <div className="flex items-center justify-between py-2 px-3 border-b border-zinc-900 last:border-b-0 hover:bg-zinc-900 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm">{part.partName}</p>
        <div className="flex gap-3 mt-0.5">
          {part.supplier && (
            part.supplierLink
              ? <a href={part.supplierLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-xs">{part.supplier}</a>
              : <span className="text-gray-400 text-xs">{part.supplier}</span>
          )}
          {part.partNum && <span className="text-gray-500 text-xs font-mono">{part.partNum}</span>}
          {part.price && <span className="text-gray-400 text-xs">{part.price}</span>}
        </div>
      </div>
      <div className="ml-4 flex items-center gap-2 flex-shrink-0">
        {/* Quantity controls */}
        <div className="flex items-center gap-1 bg-zinc-800 rounded px-1 py-0.5">
          <button
            onClick={() => handleQtyChange(currentQty - 1)}
            className="text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center text-sm font-bold"
          >−</button>
          <input
            type="number"
            value={currentQty}
            min={1}
            max={1000}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (!isNaN(val)) handleQtyChange(val);
            }}
            className="text-white text-xs w-8 text-center bg-transparent focus:outline-none"
          />
          <button
            onClick={() => handleQtyChange(currentQty + 1)}
            className="text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center text-sm font-bold"
          >+</button>
        </div>
        {/* Add / Added button */}
        {isAdded ? (
          <button
            onClick={onRemove}
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-semibold bg-green-900 text-green-400 hover:bg-red-900 hover:text-red-400 transition-colors"
          >
            <Check className="w-3 h-3" /> Added
          </button>
        ) : (
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-semibold bg-white text-black hover:bg-gray-200 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>
    </div>
  );
}

function CategoryRow({ category, sheetTab, onAdd, onRemove, onUpdateQty, addedPartsMap }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-900 last:border-b-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-10 py-3 text-left hover:bg-zinc-900 transition-colors"
      >
        <div className="flex items-center gap-3">
          {open ? <FolderOpen className="w-4 h-4 text-gray-500" /> : <Folder className="w-4 h-4 text-gray-500" />}
          <span className="text-gray-200 text-sm font-medium">{category.name}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="px-4 pb-2">
          {(() => {
            const filteredParts = category.parts.filter(p => p.partName.toLowerCase() !== 'part');
            return filteredParts.length === 0
              ? <p className="text-gray-600 text-xs px-6 py-2">No parts in this category</p>
              : filteredParts.map((part, i) => {
                const addedEntry = addedPartsMap[part.partName];
                return (
                  <PartRow
                    key={i}
                    part={{ ...part, category: category.name, sheetTab: sheetTab }}
                    onAdd={onAdd}
                    onRemove={() => onRemove(addedEntry?.index)}
                    onUpdateQty={(qty) => onUpdateQty(addedEntry?.index, qty)}
                    isAdded={!!addedEntry}
                    addedQty={addedEntry?.quantity || 1}
                  />
                );
              });
          })()}
        </div>
      )}
    </div>
  );
}

function SheetFolder({ tab, spreadsheetId, onAdd, onRemove, onUpdateQty, addedPartsMap }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      setLoading(true);
      base44.functions.invoke('getSheetCategories', { spreadsheetId, sheetName: tab })
        .then(res => { setCategories(res.data.categories || []); setLoaded(true); })
        .catch(() => setCategories([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-zinc-800 transition-all duration-150"
      >
        <div className="flex items-center gap-3">
          {open ? <FolderOpen className="w-5 h-5 text-gray-400" /> : <Folder className="w-5 h-5 text-gray-400" />}
          <span className="text-white text-lg font-medium tracking-wide">{tab}</span>
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronRight className="w-5 h-5 text-gray-500" />}
      </button>
      {open && (
        <div className="bg-black border-t border-zinc-800">
          {loading && <div className="px-10 py-3 text-gray-500 text-sm">Loading...</div>}
          {!loading && loaded && categories.length === 0 && (
            <div className="px-10 py-3 text-gray-600 text-sm">No categories found</div>
          )}
          {categories.map((cat, i) => (
            <CategoryRow
              key={cat.name + i}
              category={cat}
              sheetTab={tab}
              onAdd={onAdd}
              onRemove={onRemove}
              onUpdateQty={onUpdateQty}
              addedPartsMap={addedPartsMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BuildPartsLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const buildId = urlParams.get('id');
  const buildName = urlParams.get('name') || 'Build';

  const [sheetTabs, setSheetTabs] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = localStorage.getItem('masterSheetUrl');
    if (!url) return;
    const id = extractSpreadsheetId(url);
    if (!id) return;
    setSpreadsheetId(id);
    setLoading(true);
    base44.functions.invoke('getSheetTabs', { spreadsheetId: id })
      .then(res => setSheetTabs(res.data.tabs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const { data: build } = useQuery({
    queryKey: ['build', buildId],
    queryFn: async () => {
      const results = await base44.entities.Build.filter({ id: buildId });
      return results[0];
    },
    enabled: !!buildId,
  });

  const currentParts = build?.parts || [];

  // Map of partName -> { index, quantity }
  const addedPartsMap = {};
  currentParts.forEach((p, i) => {
    addedPartsMap[p.partName] = { index: i, quantity: p.quantity || 1 };
  });

  const addMutation = useMutation({
    mutationFn: (part) => {
      const newParts = [...currentParts, part];
      return base44.entities.Build.update(buildId, { parts: newParts });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['build', buildId] }),
  });

  const removeMutation = useMutation({
    mutationFn: (index) => {
      const newParts = currentParts.filter((_, i) => i !== index);
      return base44.entities.Build.update(buildId, { parts: newParts });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['build', buildId] }),
  });

  const updateQtyMutation = useMutation({
    mutationFn: ({ index, qty }) => {
      const newParts = currentParts.map((p, i) => i === index ? { ...p, quantity: qty } : p);
      return base44.entities.Build.update(buildId, { parts: newParts });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['build', buildId] }),
  });

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => navigate(`/BuildParts?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-gray-500 text-sm">{buildName} › Parts</p>
            <h1 className="text-3xl font-bold text-white tracking-tight">Parts Library</h1>
          </div>
        </div>

        <div className="w-full rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {loading && <div className="px-6 py-4 text-gray-500 text-sm">Loading sheets...</div>}
          {!loading && !spreadsheetId && (
            <div className="px-6 py-8 text-center text-gray-600 text-sm">
              No master sheet linked. Link one in the Parts Library first.
            </div>
          )}
          {sheetTabs.map((tab) => (
            <SheetFolder
              key={tab}
              tab={tab}
              spreadsheetId={spreadsheetId}
              onAdd={(part) => addMutation.mutate(part)}
              onRemove={(index) => removeMutation.mutate(index)}
              onUpdateQty={(index, qty) => updateQtyMutation.mutate({ index, qty })}
              addedPartsMap={addedPartsMap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}