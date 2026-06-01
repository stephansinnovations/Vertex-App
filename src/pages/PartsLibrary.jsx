import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Minus, AlertCircle, Check, Disc } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { getSheetTabs, getSheetCategories } from '@/api/googleSheets';

function extractSpreadsheetId(url) {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const STOCK_KEY = 'partsLibraryStock';

function loadStock() {
  try { return JSON.parse(localStorage.getItem(STOCK_KEY)) || {}; } catch { return {}; }
}

function saveStock(s) {
  localStorage.setItem(STOCK_KEY, JSON.stringify(s));
}

// Shared builds cache so every CategoryRow doesn't re-fetch
let buildsCache = null;
let buildsFetchPromise = null;

function getBuilds() {
  if (buildsCache) return Promise.resolve(buildsCache);
  if (!buildsFetchPromise) {
    buildsFetchPromise = supabase.from('builds').select('*').then(({ data }) => data || [])
      .then(data => { buildsCache = data; return data; })
      .catch(() => []);
  }
  return buildsFetchPromise;
}

function CategoryRow({ category }) {
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState(loadStock);
  const [builds, setBuilds] = useState(buildsCache || []);

  useEffect(() => {
    getBuilds().then(data => setBuilds(data));
  }, []);

  const handleStockChange = (partName, value) => {
    setStock(prev => {
      const next = { ...prev, [partName]: value };
      saveStock(next);
      return next;
    });
  };

  const handleAddStock = (partName) => {
    const isNull = stock[partName] === undefined || stock[partName] === '';
    const current = isNull ? -1 : parseInt(stock[partName]);
    handleStockChange(partName, current + 1);
  };

  const handleSubtractStock = (partName) => {
    const current = parseInt(stock[partName] || 0);
    if (current <= 0) {
      setStock(prev => {
        const next = { ...prev };
        delete next[partName];
        saveStock(next);
        return next;
      });
    } else {
      handleStockChange(partName, current - 1);
    }
  };

  const getAllocatedQuantity = (partName) => {
    let allocated = 0;
    builds.forEach(build => {
      (build.parts || []).forEach(part => {
        if (part.partName === partName) allocated += part.quantity || 0;
      });
    });
    return allocated;
  };

  return (
    <div className="border-b border-zinc-900 last:border-b-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-10 py-4 text-left hover:bg-zinc-800/50 active:bg-zinc-700 transition-all duration-150 cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {open ? <FolderOpen className="w-4 h-4 text-gray-500" /> : <Folder className="w-4 h-4 text-gray-500" />}
          <span className="text-gray-200 text-base font-medium">{category.name}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>

      {open && category.parts.length > 0 && (
        <div className="pb-2">
          {category.parts.map((part, i) => {
            const allocated = getAllocatedQuantity(part.partName);
            const hasStock = stock[part.partName] !== undefined && stock[part.partName] !== '';
            const stockVal = hasStock ? parseInt(stock[part.partName]) : null;

            let statusIcon = null;
            if (!hasStock && allocated >= 1) {
              statusIcon = <span className="text-sm">🟠</span>;
            } else if (hasStock && allocated > stockVal) {
              statusIcon = <span className="text-sm">🔴</span>;
            } else if (hasStock && allocated === stockVal) {
              statusIcon = <span className="text-sm">🔵</span>;
            } else if (hasStock && stockVal > allocated) {
              statusIcon = <span className="text-sm">🟢</span>;
            }

            return (
              <div key={i} className="flex items-center justify-between px-10 py-3 border-b border-zinc-900 last:border-b-0 hover:bg-zinc-800/30 transition-colors gap-4">
                {/* Left: name + supplier + part# + price */}
                <div className="flex-1 min-w-0">
                  <span className="text-white text-sm leading-snug">{part.partName}</span>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    {part.supplierLink ? (
                      <a href={part.supplierLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs underline underline-offset-2">{part.supplier || 'Link'}</a>
                    ) : part.supplier ? (
                      <button
                        onClick={() => navigator.clipboard.writeText(part.supplier)}
                        className="text-gray-500 text-xs hover:text-white active:text-green-400 transition-colors cursor-copy"
                        title="Copy supplier name"
                      >
                        {part.supplier}
                      </button>
                    ) : null}
                    {part.partNum && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(part.partNum); }}
                        className="text-gray-400 font-mono text-xs hover:text-white active:text-green-400 transition-colors cursor-copy"
                        title="Copy part number"
                      >
                        {part.partNum}
                      </button>
                    )}
                    {part.price && <span className="text-gray-400 text-xs">{part.price}</span>}
                  </div>
                </div>

                {/* Right: stock, allocated */}
                <div className="flex items-center gap-4 flex-shrink-0">

                  {/* Stock +/- */}
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => handleSubtractStock(part.partName)} className="text-gray-500 hover:text-white transition-colors">
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={stock[part.partName] ?? ''}
                      onChange={(e) => handleStockChange(part.partName, e.target.value)}
                      className="w-12 bg-zinc-800 text-white text-center px-1 py-0.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="—"
                    />
                    <button onClick={() => handleAddStock(part.partName)} className="text-gray-500 hover:text-white transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Allocated + status */}
                  <div className="flex items-center gap-1 text-xs text-gray-400 min-w-[2rem] justify-end">
                    <span>{allocated}</span>
                    {statusIcon}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && category.parts.length === 0 && (
        <div className="px-10 pb-3">
          <p className="text-gray-600 text-sm">No parts found in this category</p>
        </div>
      )}
    </div>
  );
}

function SheetFolder({ tab, spreadsheetId }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      setLoading(true);
      getSheetCategories(spreadsheetId, tab)
        .then(res => {
          setCategories(res.data.categories || []);
          setLoaded(true);
        })
        .catch(() => setCategories([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-zinc-800 active:bg-zinc-700 transition-all duration-150 cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {open ? <FolderOpen className="w-5 h-5 text-gray-400" /> : <Folder className="w-5 h-5 text-gray-400" />}
          <span className="text-white text-lg font-medium tracking-wide">{tab}</span>
        </div>
        {open ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronRight className="w-5 h-5 text-gray-500" />}
      </button>

      {open && (
        <div className="bg-black border-t border-zinc-800">
          {loading && (
            <div className="px-10 py-3">
              <p className="text-gray-500 text-sm">Loading categories...</p>
            </div>
          )}
          {!loading && categories.length === 0 && loaded && (
            <div className="px-10 py-3">
              <p className="text-gray-600 text-sm">No black-highlighted categories found</p>
            </div>
          )}
          {categories.map((cat, i) => (
            <CategoryRow key={cat.name + i} category={cat} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PartsLibrary() {
  const navigate = useNavigate();
  const [sheetTabs, setSheetTabs] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadSheet = async () => {
      try {
        const url = localStorage.getItem('masterSheetUrl');
        if (!url) { setLoading(false); return; }
        const id = extractSpreadsheetId(url);
        if (!id) { setLoading(false); return; }
        setSpreadsheetId(id);
        const res = await getSheetTabs(id);
        setSheetTabs(res.data.tabs || []);
      } catch {
        setError('Could not load sheet tabs');
      } finally {
        setLoading(false);
      }
    };
    loadSheet();
  }, []);

  return (
    <div className="min-h-screen flex justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button onClick={() => navigate('/Inventory')} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-bold text-white tracking-tight">Parts Library</h1>
            <p className="text-gray-400 mt-1">Manage your parts and components</p>
          </div>
          <button
            onClick={() => navigate('/MasterSheet')}
            className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z" fill="#0F9D58"/>
              <path d="M8 17H6V16H8V17ZM8 15H6V14H8V15ZM8 13H6V12H8V13ZM11 17H9V16H11V17ZM11 15H9V14H11V15ZM11 13H9V12H11V13ZM14 17H12V16H14V17ZM14 15H12V14H14V15ZM14 13H12V12H14V13ZM18 17H15V16H18V17ZM18 15H15V14H18V15ZM18 13H15V12H18V13ZM18 10H6V8H18V10Z" fill="white"/>
            </svg>
            Master Sheet
          </button>
        </div>

        {/* Menu Card */}
        <div className="w-full max-w-2xl mx-auto rounded-2xl overflow-hidden border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {loading && (
            <div className="px-6 py-4">
              <p className="text-gray-500 text-sm">Loading sheets...</p>
            </div>
          )}
          {error && (
            <div className="px-6 py-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          {sheetTabs.map((tab) => (
            <SheetFolder key={tab} tab={tab} spreadsheetId={spreadsheetId} />
          ))}
          {!loading && !error && sheetTabs.length === 0 && (
            <div className="px-6 py-5 text-center">
              <p className="text-gray-600 text-sm">Link a Master Sheet to see folders</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}