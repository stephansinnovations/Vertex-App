import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Minus, AlertCircle, Check, Disc, X, Sparkles } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { getSheetTabs, getSheetCategories, addPartToCategory, addSheetTab, addCategory as addCategoryToSheet } from '@/api/googleSheets';
import { getSheetsAccessToken, isGoogleOAuthConfigured } from '@/api/googleAuth';
import { extractPartFromUrl } from '@/api/extractPart';
import { getSetting } from '@/api/appSettings';

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
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const [catErr, setCatErr] = useState(null);

  const loadCategories = () => {
    setLoading(true);
    return getSheetCategories(spreadsheetId, tab)
      .then(res => { setCategories(res.data.categories || []); setLoaded(true); })
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) loadCategories();
  };

  const submitCategory = async () => {
    if (!newCatName.trim() || savingCat) return;
    setSavingCat(true);
    setCatErr(null);
    try {
      const token = await getSheetsAccessToken();
      await addCategoryToSheet(spreadsheetId, tab, newCatName.trim(), token);
      setNewCatName('');
      setAddingCat(false);
      await loadCategories();
    } catch (e) {
      setCatErr(e.message || 'Failed to add category');
    } finally {
      setSavingCat(false);
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

          {/* Add category */}
          {!loading && (
            <div className="px-10 py-3 border-t border-zinc-900">
              {addingCat ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitCategory(); }}
                      placeholder="New category name…"
                      autoFocus
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                    />
                    <button onClick={submitCategory} disabled={!newCatName.trim() || savingCat}
                      className="bg-white text-black text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-40">
                      {savingCat ? '…' : 'Add'}
                    </button>
                    <button onClick={() => { setAddingCat(false); setNewCatName(''); setCatErr(null); }}
                      className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>
                  {catErr && <p className="text-red-400 text-xs">{catErr}</p>}
                </div>
              ) : (
                <button onClick={() => setAddingCat(true)}
                  className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
                  <Plus className="w-4 h-4" /> Add category
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuickCreateRow({ placeholder, value, onChange, onSubmit, onCancel, saving, err }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
          placeholder={placeholder}
          autoFocus
          className="flex-1 bg-black border border-zinc-600 rounded-xl px-4 py-2.5 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-400"
        />
        <button onClick={onSubmit} disabled={!value.trim() || saving}
          className="bg-white text-black text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-40">
          {saving ? '…' : 'Add'}
        </button>
        <button onClick={onCancel} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      {err && <p className="text-red-400 text-xs mt-1.5">{err}</p>}
    </div>
  );
}

export default function PartsLibrary() {
  const navigate = useNavigate();
  const [sheetTabs, setSheetTabs] = useState([]);
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add Part flow
  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState('');
  const [addCats, setAddCats] = useState([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [addCategory, setAddCategory] = useState('');
  const [pForm, setPForm] = useState({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '' });
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState(null);
  const [aiFilling, setAiFilling] = useState(false);
  const [aiErr, setAiErr] = useState(null);

  // Read the supplier link with Claude and auto-fill the part fields.
  const handleAiFill = async () => {
    if (aiFilling) return;
    setAiFilling(true);
    setAiErr(null);
    try {
      const r = await extractPartFromUrl(pForm.supplierLink.trim());
      setPForm(f => ({
        ...f,
        partName: r.partName || f.partName,
        supplier: r.supplier || f.supplier,
        partNum: r.partNum || f.partNum,
        price: r.price || f.price,
      }));
    } catch (e) {
      setAiErr(e.message || 'AI fill failed');
    } finally {
      setAiFilling(false);
    }
  };

  // Add Tab flow
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [savingTab, setSavingTab] = useState(false);
  const [tabErr, setTabErr] = useState(null);

  const submitTab = async () => {
    if (!newTabName.trim() || savingTab) return;
    setSavingTab(true);
    setTabErr(null);
    try {
      const token = await getSheetsAccessToken();
      await addSheetTab(spreadsheetId, newTabName.trim(), token);
      const res = await getSheetTabs(spreadsheetId);
      setSheetTabs(res.data.tabs || []);
      setNewTabName('');
      setAddingTab(false);
    } catch (e) {
      setTabErr(e.message || 'Failed to add tab');
    } finally {
      setSavingTab(false);
    }
  };

  // Inline "create from the dropdown" for the Add Part modal.
  const [quickAdd, setQuickAdd] = useState(null); // 'tab' | 'cat' | null
  const [quickName, setQuickName] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickErr, setQuickErr] = useState(null);

  const openAdd = () => {
    setAddErr(null);
    setQuickAdd(null);
    setAddTab(sheetTabs[0] || '');
    setShowAdd(true);
  };

  const submitQuick = async () => {
    const name = quickName.trim();
    if (!name || quickSaving) return;
    setQuickSaving(true);
    setQuickErr(null);
    try {
      const token = await getSheetsAccessToken();
      if (quickAdd === 'tab') {
        await addSheetTab(spreadsheetId, name, token);
        const res = await getSheetTabs(spreadsheetId);
        setSheetTabs(res.data.tabs || []);
        setAddTab(name); // selecting it loads its (empty) categories via the effect
      } else {
        await addCategoryToSheet(spreadsheetId, addTab, name, token);
        const res = await getSheetCategories(spreadsheetId, addTab);
        setAddCats(res.data.categories || []);
        setAddCategory(name);
      }
      setQuickAdd(null);
      setQuickName('');
    } catch (e) {
      setQuickErr(e.message || 'Failed');
    } finally {
      setQuickSaving(false);
    }
  };

  // Load categories for the chosen tab so the user can pick where the part goes.
  useEffect(() => {
    if (!showAdd || !addTab || !spreadsheetId) return;
    setLoadingCats(true);
    setAddCategory('');
    getSheetCategories(spreadsheetId, addTab)
      .then(res => setAddCats(res.data.categories || []))
      .catch(() => setAddCats([]))
      .finally(() => setLoadingCats(false));
  }, [showAdd, addTab, spreadsheetId]);

  const submitPart = async () => {
    if (!pForm.partName.trim() || !addCategory || saving) return;
    setSaving(true);
    setAddErr(null);
    try {
      const token = await getSheetsAccessToken();
      await addPartToCategory(spreadsheetId, addTab, addCategory, {
        partName: pForm.partName.trim(),
        supplier: pForm.supplier.trim(),
        supplierLink: pForm.supplierLink.trim(),
        partNum: pForm.partNum.trim(),
        price: pForm.price.trim(),
      }, token);
      setShowAdd(false);
      setPForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '' });
      // Force the relevant folder to re-fetch by reloading the page's sheet view.
      window.location.reload();
    } catch (e) {
      setAddErr(e.message || 'Failed to add part');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const loadSheet = async () => {
      try {
        const url = await getSetting('masterSheetUrl');
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
          {sheetTabs.length > 0 && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 text-white font-semibold text-sm px-4 py-2 rounded-lg hover:bg-zinc-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Part
            </button>
          )}
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

          {/* Add tab */}
          {!loading && spreadsheetId && (
            <div className="px-6 py-4 border-t border-zinc-800">
              {addingTab ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={newTabName}
                      onChange={e => setNewTabName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitTab(); }}
                      placeholder="New tab name…"
                      autoFocus
                      className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                    />
                    <button onClick={submitTab} disabled={!newTabName.trim() || savingTab}
                      className="bg-white text-black text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-40">
                      {savingTab ? '…' : 'Add'}
                    </button>
                    <button onClick={() => { setAddingTab(false); setNewTabName(''); setTabErr(null); }}
                      className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
                  </div>
                  {tabErr && <p className="text-red-400 text-xs">{tabErr}</p>}
                </div>
              ) : (
                <button onClick={() => setAddingTab(true)}
                  className="flex items-center gap-2 text-gray-400 hover:text-white text-sm font-medium transition-colors">
                  <Plus className="w-4 h-4" /> Add tab
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Part modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => !saving && setShowAdd(false)} />
          <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Add Part to Master Sheet</h2>
              <button onClick={() => !saving && setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isGoogleOAuthConfigured() && (
              <div className="mb-4 flex items-start gap-2 bg-amber-900/20 border border-amber-900/40 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-amber-300 text-xs">Google sign-in isn't configured yet (VITE_GOOGLE_OAUTH_CLIENT_ID). Adding a part will fail until it's set.</p>
              </div>
            )}

            <label className="text-xs text-gray-400 mb-1.5 block">Sheet (tab)</label>
            <select value={addTab} onChange={e => {
                if (e.target.value === '__add_tab__') { setQuickAdd('tab'); setQuickName(''); setQuickErr(null); return; }
                setQuickAdd(null); setAddTab(e.target.value);
              }}
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-2 focus:outline-none focus:border-zinc-500">
              <option value="__add_tab__">＋ Add new sheet tab</option>
              {sheetTabs.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {quickAdd === 'tab'
              ? <QuickCreateRow placeholder="New tab name…" value={quickName} onChange={setQuickName}
                  onSubmit={submitQuick} onCancel={() => { setQuickAdd(null); setQuickName(''); setQuickErr(null); }}
                  saving={quickSaving} err={quickErr} />
              : <div className="mb-2" />}

            <label className="text-xs text-gray-400 mb-1.5 block">Category</label>
            <select value={addCategory} onChange={e => {
                if (e.target.value === '__add_cat__') { setQuickAdd('cat'); setQuickName(''); setQuickErr(null); return; }
                setQuickAdd(null); setAddCategory(e.target.value);
              }}
              disabled={loadingCats}
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-2 focus:outline-none focus:border-zinc-500 disabled:opacity-50">
              <option value="__add_cat__">＋ Add category</option>
              <option value="">{loadingCats ? 'Loading categories…' : 'Select a category'}</option>
              {addCats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            {quickAdd === 'cat'
              ? <QuickCreateRow placeholder="New category name…" value={quickName} onChange={setQuickName}
                  onSubmit={submitQuick} onCancel={() => { setQuickAdd(null); setQuickName(''); setQuickErr(null); }}
                  saving={quickSaving} err={quickErr} />
              : <div className="mb-2" />}

            <label className="text-xs text-gray-400 mb-1.5 block">Part name *</label>
            <input value={pForm.partName} onChange={e => setPForm(f => ({ ...f, partName: e.target.value }))}
              placeholder="e.g. 12V LED strip"
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm mb-4 focus:outline-none focus:border-zinc-500" />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">Supplier</label>
                <input value={pForm.supplier} onChange={e => setPForm(f => ({ ...f, supplier: e.target.value }))}
                  className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">Price</label>
                <input value={pForm.price} onChange={e => setPForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="$0.00"
                  className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">Part #</label>
                <input value={pForm.partNum} onChange={e => setPForm(f => ({ ...f, partNum: e.target.value }))}
                  className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">Supplier link</label>
                <input value={pForm.supplierLink} onChange={e => setPForm(f => ({ ...f, supplierLink: e.target.value }))}
                  placeholder="https://…"
                  className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
              </div>
            </div>

            {/* AI fill from link */}
            <button
              onClick={handleAiFill}
              disabled={!pForm.supplierLink.trim() || aiFilling}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl mb-3 transition-all disabled:opacity-40"
              style={{ background: 'rgba(139,92,246,0.18)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
            >
              <Sparkles className="w-4 h-4" />
              {aiFilling ? 'Reading the link…' : 'AI fill from link'}
            </button>
            {aiErr && <p className="text-red-400 text-xs mb-3">{aiErr}</p>}

            {addErr && <p className="text-red-400 text-xs mb-3">{addErr}</p>}

            <button onClick={submitPart} disabled={!pForm.partName.trim() || !addCategory || saving}
              className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {saving ? 'Adding…' : <><Check className="w-4 h-4" /> Add to sheet</>}
            </button>
            <p className="text-gray-600 text-[11px] text-center mt-2">First time, Google will ask you to sign in and allow Sheets access.</p>
          </div>
        </div>
      )}
    </div>
  );
}