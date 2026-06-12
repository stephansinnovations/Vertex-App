import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, ChevronUp, Folder, FolderOpen, Plus, AlertCircle, Check, X, Sparkles, Camera, Trash2, Search, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { getSheetTabs, getSheetCategories, addPartToCategory, addSheetTab, addCategory as addCategoryToSheet, deletePartRow, renameSheetTab, renameCategory, updatePartRow, getPartRowsForBackfill, writePartImageByRow } from '@/api/googleSheets';
import { getSheetsAccessToken, isGoogleOAuthConfigured } from '@/api/googleAuth';
import { extractPartFromUrl, identifyPartFromImage, findPartImage } from '@/api/geminiParts';
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

// A part's picture: medium thumbnail, with a graceful placeholder when there's
// no image (or the URL fails to load).
function PartImage({ url, className = 'w-14 h-14' }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className={`${className} rounded-lg bg-zinc-800/70 border border-zinc-800 flex items-center justify-center flex-shrink-0`}>
        <ImageIcon className="w-5 h-5 text-zinc-600" />
      </div>
    );
  }
  return <img src={url} alt="" loading="lazy" onError={() => setErr(true)}
    className={`${className} rounded-lg object-cover bg-zinc-800 border border-zinc-800 flex-shrink-0`} />;
}

// Long-press (≈500ms) or double-click → fire onEdit. `suppressRef` lets the host
// element ignore the click that follows the gesture (e.g. a folder-toggle button).
// Plain factory (NOT a hook) so it can be called per-row inside a .map().
let pressTimer = null;
function editGestureProps(onEdit, suppressRef, ms = 500) {
  const fire = () => { clearTimeout(pressTimer); if (suppressRef) suppressRef.current = true; onEdit(); };
  return {
    onPointerDown: () => { clearTimeout(pressTimer); pressTimer = setTimeout(fire, ms); },
    onPointerUp: () => clearTimeout(pressTimer),
    onPointerLeave: () => clearTimeout(pressTimer),
    onContextMenu: (e) => e.preventDefault(),
    onDoubleClick: (e) => { e.preventDefault(); fire(); },
    style: { userSelect: 'none', WebkitTouchCallout: 'none' },
  };
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

function CategoryRow({ category, spreadsheetId, tab, onChanged }) {
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState(loadStock);
  const [builds, setBuilds] = useState(buildsCache || []);
  const [addingPart, setAddingPart] = useState(false);
  const [partForm, setPartForm] = useState({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '' });
  const [savingPart, setSavingPart] = useState(false);
  const [partErr, setPartErr] = useState(null);

  // Inline subcategory-title rename
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(category.name);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleErr, setTitleErr] = useState(null);
  const suppressToggle = useRef(false);
  const titleGesture = editGestureProps(() => { setTitleDraft(category.name); setTitleErr(null); setEditingTitle(true); }, suppressToggle);

  // Edit-part popup (also hosts Delete)
  const [editPart, setEditPart] = useState(null); // the original part being edited
  const [editForm, setEditForm] = useState({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState(null);
  const [confirmDelInEdit, setConfirmDelInEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openEditPart = (part) => {
    setEditPart(part);
    setEditForm({
      partName: part.partName || '', supplier: part.supplier || '',
      supplierLink: part.supplierLink || '', partNum: part.partNum || '', price: part.price || '',
      imageUrl: part.imageUrl || '',
    });
    setEditErr(null);
    setConfirmDelInEdit(false);
  };

  const saveEditPart = async () => {
    if (!editForm.partName.trim() || savingEdit) return;
    setSavingEdit(true);
    setEditErr(null);
    try {
      const token = await getSheetsAccessToken();
      await updatePartRow(spreadsheetId, tab, category.name, editPart, {
        partName: editForm.partName.trim(),
        supplier: editForm.supplier.trim(),
        supplierLink: editForm.supplierLink.trim(),
        partNum: editForm.partNum.trim(),
        price: editForm.price.trim(),
        imageUrl: editForm.imageUrl.trim(),
      }, token);
      setEditPart(null);
      onChanged && onChanged();
    } catch (e) {
      setEditErr(e.message || 'Failed to save part');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteEditPart = async () => {
    if (!editPart || deleting) return;
    setDeleting(true);
    setEditErr(null);
    try {
      const token = await getSheetsAccessToken();
      await deletePartRow(spreadsheetId, tab, category.name, editPart, token);
      setEditPart(null);
      onChanged && onChanged();
    } catch (e) {
      setEditErr(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const saveTitle = async () => {
    const name = titleDraft.trim();
    if (!name || savingTitle) return;
    if (name === category.name) { setEditingTitle(false); return; }
    setSavingTitle(true);
    setTitleErr(null);
    try {
      const token = await getSheetsAccessToken();
      await renameCategory(spreadsheetId, tab, category.name, name, token);
      setEditingTitle(false);
      onChanged && onChanged();
    } catch (e) {
      setTitleErr(e.message || 'Rename failed');
    } finally {
      setSavingTitle(false);
    }
  };

  const submitPart = async () => {
    if (!partForm.partName.trim() || savingPart) return;
    setSavingPart(true);
    setPartErr(null);
    try {
      const token = await getSheetsAccessToken();
      await addPartToCategory(spreadsheetId, tab, category.name, {
        partName: partForm.partName.trim(),
        supplier: partForm.supplier.trim(),
        supplierLink: partForm.supplierLink.trim(),
        partNum: partForm.partNum.trim(),
        price: partForm.price.trim(),
      }, token);
      setPartForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '' });
      setAddingPart(false);
      onChanged && onChanged();
    } catch (e) {
      setPartErr(e.message || 'Failed to add part');
    } finally {
      setSavingPart(false);
    }
  };

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
      {editingTitle ? (
        <div className="flex items-center gap-2 px-10 py-3">
          {open ? <FolderOpen className="w-4 h-4 text-gray-500" /> : <Folder className="w-4 h-4 text-gray-500" />}
          <input value={titleDraft} autoFocus
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-base focus:outline-none focus:border-zinc-500" />
          <button onClick={saveTitle} disabled={!titleDraft.trim() || savingTitle}
            className="bg-white text-black text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40">
            {savingTitle ? '…' : 'Save'}
          </button>
          <button onClick={() => { setEditingTitle(false); setTitleErr(null); }} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
          {titleErr && <p className="text-red-400 text-xs">{titleErr}</p>}
        </div>
      ) : (
        <button
          onClick={() => { if (suppressToggle.current) { suppressToggle.current = false; return; } setOpen(v => !v); }}
          className="w-full flex items-center justify-between px-10 py-4 text-left hover:bg-zinc-800/50 active:bg-zinc-700 transition-all duration-150 cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            {open ? <FolderOpen className="w-4 h-4 text-gray-500 flex-shrink-0" /> : <Folder className="w-4 h-4 text-gray-500 flex-shrink-0" />}
            <span {...titleGesture} className="text-gray-200 text-base font-medium truncate" title="Hold or double-tap to rename">{category.name}</span>
          </div>
          {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        </button>
      )}

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
              <div key={i} className="group flex items-center justify-between px-10 py-3 border-b border-zinc-900 last:border-b-0 hover:bg-zinc-800/30 transition-colors gap-4">
                {/* Picture */}
                <PartImage url={part.imageUrl} />

                {/* Counter (up / number / down) */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <button onClick={() => handleAddStock(part.partName)} className="text-gray-500 hover:text-white transition-colors -mb-0.5">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={stock[part.partName] ?? ''}
                    onChange={(e) => handleStockChange(part.partName, e.target.value)}
                    className="w-10 bg-zinc-800 text-white text-center px-0.5 py-0.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="—"
                  />
                  <button onClick={() => handleSubtractStock(part.partName)} className="text-gray-500 hover:text-white transition-colors -mt-0.5">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                {/* Middle: name + supplier + part# + price */}
                <div className="flex-1 min-w-0">
                  <span {...editGestureProps(() => openEditPart(part), null)} className="text-white text-sm leading-snug cursor-pointer" title="Hold or double-tap to edit">{part.partName}</span>
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

                {/* Right: allocated + status */}
                <div className="flex items-center gap-1 text-xs text-gray-400 min-w-[2rem] justify-end flex-shrink-0">
                  <span>{allocated}</span>
                  {statusIcon}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && category.parts.length === 0 && (
        <div className="px-10 pb-3">
          <p className="text-gray-600 text-sm">No parts found in this subcategory</p>
        </div>
      )}

      {/* Add part to this category */}
      {open && (
        <div className="px-10 pb-3">
          {addingPart ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 space-y-2">
              <input value={partForm.partName} autoFocus
                onChange={e => setPartForm(f => ({ ...f, partName: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') submitPart(); }}
                placeholder="Part name *"
                className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
              <div className="grid grid-cols-2 gap-2">
                <input value={partForm.supplier} onChange={e => setPartForm(f => ({ ...f, supplier: e.target.value }))}
                  placeholder="Supplier"
                  className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
                <input value={partForm.price} onChange={e => setPartForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="Price"
                  className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
                <input value={partForm.partNum} onChange={e => setPartForm(f => ({ ...f, partNum: e.target.value }))}
                  placeholder="Part #"
                  className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
                <input value={partForm.supplierLink} onChange={e => setPartForm(f => ({ ...f, supplierLink: e.target.value }))}
                  placeholder="Link https://…"
                  className="bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
              </div>
              {partErr && <p className="text-red-400 text-xs">{partErr}</p>}
              <div className="flex items-center gap-2">
                <button onClick={submitPart} disabled={!partForm.partName.trim() || savingPart}
                  className="flex-1 bg-white text-black text-sm font-semibold py-2 rounded-lg disabled:opacity-40">
                  {savingPart ? 'Adding…' : 'Add part'}
                </button>
                <button onClick={() => { setAddingPart(false); setPartErr(null); setPartForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '' }); }}
                  className="text-gray-400 hover:text-white px-2"><X className="w-4 h-4" /></button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingPart(true)}
              className="flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
              <Plus className="w-4 h-4" /> Add part
            </button>
          )}
        </div>
      )}

      {/* Edit part popup (name / supplier / part link / part# / price + delete) */}
      {editPart && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => !savingEdit && !deleting && setEditPart(null)} />
          <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Edit Part</h2>
              <button onClick={() => !savingEdit && !deleting && setEditPart(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <label className="text-xs text-gray-400 mb-1.5 block">Part name *</label>
            <input value={editForm.partName} autoFocus
              onChange={e => setEditForm(f => ({ ...f, partName: e.target.value }))}
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500" />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">Supplier</label>
                <input value={editForm.supplier} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))}
                  className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">Price</label>
                <input value={editForm.price} onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="$0.00"
                  className="w-full bg-black border border-zinc-700 rounded-xl px-3 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
              </div>
            </div>

            <label className="text-xs text-gray-400 mb-1.5 block">Part #</label>
            <input value={editForm.partNum} onChange={e => setEditForm(f => ({ ...f, partNum: e.target.value }))}
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500" />

            <label className="text-xs text-gray-400 mb-1.5 block">Part link</label>
            <input value={editForm.supplierLink} onChange={e => setEditForm(f => ({ ...f, supplierLink: e.target.value }))}
              placeholder="https://…"
              className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500" />

            <label className="text-xs text-gray-400 mb-1.5 block">Picture URL</label>
            <div className="flex items-center gap-3 mb-5">
              <PartImage url={editForm.imageUrl.trim()} className="w-14 h-14" />
              <input value={editForm.imageUrl} onChange={e => setEditForm(f => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://…/image.jpg"
                className="flex-1 bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
            </div>

            {editErr && <p className="text-red-400 text-xs mb-3">{editErr}</p>}

            <button onClick={saveEditPart} disabled={!editForm.partName.trim() || savingEdit || deleting}
              className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40 flex items-center justify-center gap-2 mb-3">
              {savingEdit ? 'Saving…' : <><Check className="w-4 h-4" /> Save changes</>}
            </button>

            {confirmDelInEdit ? (
              <button onClick={deleteEditPart} disabled={deleting}
                className="w-full flex items-center justify-center gap-2 bg-red-600 text-white py-3 rounded-xl font-semibold hover:bg-red-500 transition-colors disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Tap again to confirm delete'}
              </button>
            ) : (
              <button onClick={() => setConfirmDelInEdit(true)} disabled={savingEdit}
                className="w-full flex items-center justify-center gap-2 text-red-400 hover:text-red-300 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
                <Trash2 className="w-4 h-4" /> Delete part
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SheetFolder({ tab, spreadsheetId, onRenamed }) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const [catErr, setCatErr] = useState(null);

  // Inline Category-title rename
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(tab);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleErr, setTitleErr] = useState(null);
  const suppressToggle = useRef(false);
  const titleGesture = editGestureProps(() => { setTitleDraft(tab); setTitleErr(null); setEditingTitle(true); }, suppressToggle);

  const saveTitle = async () => {
    const name = titleDraft.trim();
    if (!name || savingTitle) return;
    if (name === tab) { setEditingTitle(false); return; }
    setSavingTitle(true);
    setTitleErr(null);
    try {
      const token = await getSheetsAccessToken();
      await renameSheetTab(spreadsheetId, tab, name, token);
      setEditingTitle(false);
      onRenamed && onRenamed();
    } catch (e) {
      setTitleErr(e.message || 'Rename failed');
    } finally {
      setSavingTitle(false);
    }
  };

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
      setCatErr(e.message || 'Failed to add subcategory');
    } finally {
      setSavingCat(false);
    }
  };

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      {editingTitle ? (
        <div className="flex items-center gap-2 px-6 py-4">
          {open ? <FolderOpen className="w-5 h-5 text-gray-400" /> : <Folder className="w-5 h-5 text-gray-400" />}
          <input value={titleDraft} autoFocus
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2 text-white text-lg focus:outline-none focus:border-zinc-500" />
          <button onClick={saveTitle} disabled={!titleDraft.trim() || savingTitle}
            className="bg-white text-black text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-40">
            {savingTitle ? '…' : 'Save'}
          </button>
          <button onClick={() => { setEditingTitle(false); setTitleErr(null); }} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
          {titleErr && <p className="text-red-400 text-xs">{titleErr}</p>}
        </div>
      ) : (
        <button
          onClick={() => { if (suppressToggle.current) { suppressToggle.current = false; return; } handleToggle(); }}
          className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-zinc-800 active:bg-zinc-700 transition-all duration-150 cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            {open ? <FolderOpen className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <Folder className="w-5 h-5 text-gray-400 flex-shrink-0" />}
            <span {...titleGesture} className="text-white text-lg font-medium tracking-wide truncate" title="Hold or double-tap to rename">{tab}</span>
          </div>
          {open ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronRight className="w-5 h-5 text-gray-500" />}
        </button>
      )}

      {open && (
        <div className="bg-black border-t border-zinc-800">
          {loading && (
            <div className="px-10 py-3">
              <p className="text-gray-500 text-sm">Loading subcategories...</p>
            </div>
          )}
          {!loading && categories.length === 0 && loaded && (
            <div className="px-10 py-3">
              <p className="text-gray-600 text-sm">No black-highlighted subcategories found</p>
            </div>
          )}
          {categories.map((cat, i) => (
            <CategoryRow key={cat.name + i} category={cat} spreadsheetId={spreadsheetId} tab={tab} onChanged={loadCategories} />
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
                      placeholder="New subcategory name…"
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
                  <Plus className="w-4 h-4" /> Add subcategory
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

  // Search across all tabs/categories. Parts load lazily per folder, so the first
  // search fetches every tab's parts once and caches the flat list.
  const [search, setSearch] = useState('');
  const [allParts, setAllParts] = useState(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const searchRef = useRef(null);
  const intentDone = useRef(false);

  useEffect(() => {
    if (!search.trim() || allParts || loadingAll || !spreadsheetId || sheetTabs.length === 0) return;
    setLoadingAll(true);
    Promise.all(sheetTabs.map(t =>
      getSheetCategories(spreadsheetId, t)
        .then(r => ({ tab: t, cats: r.data.categories || [] }))
        .catch(() => ({ tab: t, cats: [] }))
    )).then(results => {
      const flat = [];
      results.forEach(({ tab, cats }) =>
        cats.forEach(c => (c.parts || []).forEach(p => flat.push({ ...p, tab, category: c.name })))
      );
      setAllParts(flat);
    }).finally(() => setLoadingAll(false));
  }, [search, allParts, loadingAll, spreadsheetId, sheetTabs]);

  const q = search.trim().toLowerCase();
  const searchResults = q && allParts
    ? allParts.filter(p =>
        (p.partName || '').toLowerCase().includes(q)
        || (p.supplier || '').toLowerCase().includes(q)
        || (p.partNum || '').toLowerCase().includes(q)
        || (p.category || '').toLowerCase().includes(q))
    : [];

  const reloadTabs = async () => {
    if (!spreadsheetId) return;
    try {
      const res = await getSheetTabs(spreadsheetId);
      setSheetTabs(res.data.tabs || []);
    } catch { /* ignore */ }
  };

  // Backfill pictures: find a product image (via AI) for every part missing one,
  // and write it into the sheet's picture column.
  const [showBackfill, setShowBackfill] = useState(false);
  const [bfRunning, setBfRunning] = useState(false);
  const [bfDone, setBfDone] = useState(false);
  const [bfErr, setBfErr] = useState(null);
  const [bf, setBf] = useState({ total: 0, done: 0, found: 0, missing: 0, failed: 0, current: '' });
  const bfCancel = useRef(false);

  const openBackfill = () => { setBfErr(null); setBfDone(false); setBf({ total: 0, done: 0, found: 0, missing: 0, failed: 0, current: '' }); setShowBackfill(true); };

  const runBackfill = async () => {
    if (bfRunning) return;
    setBfRunning(true); setBfDone(false); setBfErr(null); bfCancel.current = false;
    setBf({ total: 0, done: 0, found: 0, missing: 0, failed: 0, current: 'Reading your sheet…' });
    try {
      const token = await getSheetsAccessToken();
      // Phase 1 — gather every part that has no picture yet.
      const jobs = [];
      for (const tab of sheetTabs) {
        if (bfCancel.current) break;
        try {
          const { sheetId, parts } = await getPartRowsForBackfill(spreadsheetId, tab, token);
          parts.forEach(p => { if (!p.imageUrl && p.partName) jobs.push({ ...p, tab, sheetId }); });
        } catch { /* skip unreadable tab */ }
      }
      setBf(s => ({ ...s, total: jobs.length, current: jobs.length ? '' : 'Every part already has a picture 🎉' }));

      // Phase 2 — find an image for each and write it in.
      let found = 0, missing = 0, failed = 0;
      for (let i = 0; i < jobs.length; i++) {
        if (bfCancel.current) break;
        const job = jobs[i];
        setBf(s => ({ ...s, done: i, current: job.partName }));
        try {
          const img = await findPartImage(job);
          if (img) { await writePartImageByRow(spreadsheetId, job.sheetId, job.rowIndex, img, token); found++; }
          else missing++;
        } catch { failed++; }
        setBf(s => ({ ...s, done: i + 1, found, missing, failed }));
      }
      setBfDone(true);
    } catch (e) {
      setBfErr(e.message || 'Backfill failed');
    } finally {
      setBfRunning(false);
    }
  };

  // Add Part flow
  const [showAdd, setShowAdd] = useState(false);
  const [addStarted, setAddStarted] = useState(false); // revealed after "Done" on the link step
  const [addTab, setAddTab] = useState('');
  const [addCats, setAddCats] = useState([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [addCategory, setAddCategory] = useState('');
  const pendingSubcatRef = useRef(null); // AI-guessed subcategory, applied once its tab's cats load
  const [pForm, setPForm] = useState({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '', imageUrl: '' });
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState(null);
  const [aiFilling, setAiFilling] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const photoInputRef = useRef(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoErr, setPhotoErr] = useState(null);

  // Take/upload a photo → Gemini identifies the part and finds a buy link.
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoLoading(true);
    setPhotoErr(null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await identifyPartFromImage(base64, file.type || 'image/jpeg');
      setPForm(f => ({
        ...f,
        partName: r.partName || f.partName,
        supplier: r.supplier || f.supplier,
        partNum: r.partNum || f.partNum,
        price: r.price || f.price,
        supplierLink: r.supplierLink || f.supplierLink,
        imageUrl: r.imageUrl || f.imageUrl,
      }));
      setAddStarted(true); // reveal the full form with the identified fields
    } catch (err) {
      setPhotoErr(err.message || 'Could not identify the part');
    } finally {
      setPhotoLoading(false);
    }
  };

  // "Done" on the link step: reveal the rest of the form and, if a link was given,
  // read it with Gemini to auto-fill the fields AND guess the best category /
  // subcategory from the library taxonomy. The category/subcategory pickers show
  // immediately so the user can choose while the AI is still loading.
  const handleDone = async () => {
    setAddStarted(true);
    const link = pForm.supplierLink.trim();
    if (!link || aiFilling) return;
    setAiFilling(true);
    setAiErr(null);
    try {
      const taxonomy = {};
      const results = await Promise.all(sheetTabs.map(t =>
        getSheetCategories(spreadsheetId, t)
          .then(r => ({ t, cats: r.data.categories || [] }))
          .catch(() => ({ t, cats: [] }))
      ));
      results.forEach(({ t, cats }) => { taxonomy[t] = cats.map(c => c.name); });

      const r = await extractPartFromUrl(link, taxonomy);
      setPForm(f => ({
        ...f,
        partName: r.partName || f.partName,
        supplier: r.supplier || f.supplier,
        partNum: r.partNum || f.partNum,
        price: r.price || f.price,
        imageUrl: r.imageUrl || f.imageUrl,
      }));
      // Preselect the AI's best-matching category/subcategory.
      const matchTab = sheetTabs.find(t => t.toLowerCase() === (r.category || '').toLowerCase());
      if (matchTab) {
        pendingSubcatRef.current = r.subcategory || null;
        setAddTab(matchTab);
      }
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
      setTabErr(e.message || 'Failed to add category');
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
    setAiErr(null);
    setQuickAdd(null);
    setAddStarted(false);
    setAddTab(''); // default to the "Select a category" placeholder
    setAddCategory('');
    setAddCats([]);
    pendingSubcatRef.current = null;
    setPForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '', imageUrl: '' });
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
      .then(res => {
        const cats = res.data.categories || [];
        setAddCats(cats);
        // Apply the AI-guessed subcategory once its tab's list is loaded.
        if (pendingSubcatRef.current) {
          const m = cats.find(c => c.name.toLowerCase() === pendingSubcatRef.current.toLowerCase());
          if (m) setAddCategory(m.name);
          pendingSubcatRef.current = null;
        }
      })
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
        imageUrl: pForm.imageUrl.trim(),
      }, token);
      setShowAdd(false);
      setPForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '', imageUrl: '' });
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
        setError('Could not load categories');
      } finally {
        setLoading(false);
      }
    };
    loadSheet();
  }, []);

  // Deep-link shortcuts from the Inventory page (?focus=search | ?add=1 | ?photo=1).
  useEffect(() => {
    if (intentDone.current || loading) return;
    const p = new URLSearchParams(window.location.search);
    const focus = p.get('focus') === 'search';
    const add = p.get('add') === '1';
    const photo = p.get('photo') === '1';
    if (!focus && !add && !photo) { intentDone.current = true; return; }
    if (focus) {
      if (sheetTabs.length === 0) return; // search box not rendered yet
      intentDone.current = true;
      setTimeout(() => searchRef.current?.focus(), 60);
    } else if (sheetTabs.length > 0) {
      intentDone.current = true;
      openAdd();
      if (photo) setTimeout(() => photoInputRef.current?.click(), 200);
    } else {
      return; // wait for tabs to load
    }
    // Clear the query so a refresh doesn't re-trigger.
    window.history.replaceState(null, '', '/PartsLibrary');
  }, [loading, sheetTabs]);

  return (
    <div className="min-h-screen flex justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-4xl font-bold text-white tracking-tight">Parts Library</h1>
            <p className="text-gray-400 mt-1">Manage your parts and components</p>
          </div>
          {sheetTabs.length > 0 && (
            <>
              <button
                onClick={openBackfill}
                title="Backfill pictures with AI"
                className="flex items-center justify-center bg-zinc-800 border border-zinc-700 text-gray-300 p-2 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                onClick={openAdd}
                className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Part
              </button>
            </>
          )}
        </div>

        {/* Search */}
        {sheetTabs.length > 0 && (
          <div className="relative mb-4">
            <Search className="w-4 h-4 text-gray-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search parts…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-11 pr-10 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-600"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {q ? (
          /* Search results */
          <div className="w-full max-w-2xl mx-auto rounded-2xl overflow-hidden border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            {loadingAll && (
              <div className="px-6 py-4"><p className="text-gray-500 text-sm">Searching all parts…</p></div>
            )}
            {!loadingAll && searchResults.length === 0 && (
              <div className="px-6 py-5 text-center"><p className="text-gray-600 text-sm">No parts match “{search.trim()}”</p></div>
            )}
            {!loadingAll && searchResults.map((p, i) => (
              <div key={p.tab + p.category + p.partName + i} className="flex items-start px-6 py-3 border-b border-zinc-900 last:border-b-0 gap-3">
                <PartImage url={p.imageUrl} className="w-12 h-12" />
                <div className="min-w-0">
                  <span className="text-white text-sm">{p.partName}</span>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    {p.supplierLink ? (
                      <a href={p.supplierLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs underline underline-offset-2">{p.supplier || 'Link'}</a>
                    ) : p.supplier ? (
                      <span className="text-gray-500 text-xs">{p.supplier}</span>
                    ) : null}
                    {p.partNum && <span className="text-gray-400 font-mono text-xs">{p.partNum}</span>}
                    {p.price && <span className="text-gray-400 text-xs">{p.price}</span>}
                  </div>
                  <div className="text-gray-600 text-[11px] mt-0.5">{p.tab} · {p.category}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
        /* Menu Card */
        <div className="w-full max-w-2xl mx-auto rounded-2xl overflow-hidden border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {loading && (
            <div className="px-6 py-4">
              <p className="text-gray-500 text-sm">Loading categories...</p>
            </div>
          )}
          {error && (
            <div className="px-6 py-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
          {sheetTabs.map((tab) => (
            <SheetFolder key={tab} tab={tab} spreadsheetId={spreadsheetId} onRenamed={reloadTabs} />
          ))}
          {!loading && !error && sheetTabs.length === 0 && (
            <div className="px-6 py-5 text-center">
              <p className="text-gray-600 text-sm">Link a Master Sheet to see categories</p>
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
                      placeholder="New category name…"
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
                  <Plus className="w-4 h-4" /> Add category
                </button>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* Add Part modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => !saving && setShowAdd(false)} />
          <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Add Part</h2>
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

            {/* Hidden photo input (used by the "identify from photo" fallback) */}
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
              onChange={handlePhoto} className="hidden" />

            {!addStarted ? (
              /* STEP 1 — just the part link. Done → AI reads it and fills the rest. */
              <>
                <label className="text-xs text-gray-400 mb-1.5 block">Part link</label>
                <input value={pForm.supplierLink} autoFocus
                  onChange={e => setPForm(f => ({ ...f, supplierLink: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleDone(); }}
                  placeholder="Paste the supplier / product link…"
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm mb-4 focus:outline-none focus:border-zinc-500" />

                <button onClick={handleDone}
                  className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> Done
                </button>
                <p className="text-gray-600 text-[11px] text-center mt-2 mb-4">AI reads the link and fills in the part for you.</p>

                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-zinc-800" />
                  <span className="text-gray-600 text-xs">or</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>

                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoLoading}
                  className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-3 rounded-xl mb-2 transition-all disabled:opacity-60"
                  style={{ background: 'rgba(59,130,246,0.18)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)' }}
                >
                  <Camera className="w-4 h-4" />
                  {photoLoading ? 'Identifying part…' : 'Identify from photo'}
                </button>
                {photoErr && <p className="text-red-400 text-xs mb-1">{photoErr}</p>}

                <button onClick={() => setAddStarted(true)}
                  className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 transition-colors">
                  Skip — enter manually
                </button>
              </>
            ) : (
              /* STEP 2 — category/subcategory pickers, revealed while AI fills the fields. */
              <>
                {aiFilling && (
                  <div className="mb-4 flex items-center gap-2 bg-violet-900/20 border border-violet-900/40 rounded-xl px-3 py-2.5">
                    <Sparkles className="w-4 h-4 text-violet-300 flex-shrink-0 animate-pulse" />
                    <p className="text-violet-200 text-xs">Reading the link and filling in the details… pick a category meanwhile.</p>
                  </div>
                )}

                <label className="text-xs text-gray-400 mb-1.5 block">Category</label>
                <select value={addTab} onChange={e => {
                    if (e.target.value === '__add_tab__') { setQuickAdd('tab'); setQuickName(''); setQuickErr(null); return; }
                    setQuickAdd(null); setAddTab(e.target.value);
                  }}
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-2 focus:outline-none focus:border-zinc-500">
                  <option value="__add_tab__">＋ Add new category</option>
                  <option value="">Select a category</option>
                  {sheetTabs.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {quickAdd === 'tab'
                  ? <QuickCreateRow placeholder="New category name…" value={quickName} onChange={setQuickName}
                      onSubmit={submitQuick} onCancel={() => { setQuickAdd(null); setQuickName(''); setQuickErr(null); }}
                      saving={quickSaving} err={quickErr} />
                  : <div className="mb-2" />}

                <label className="text-xs text-gray-400 mb-1.5 block">Subcategory</label>
                <select value={addCategory} onChange={e => {
                    if (e.target.value === '__add_cat__') { setQuickAdd('cat'); setQuickName(''); setQuickErr(null); return; }
                    setQuickAdd(null); setAddCategory(e.target.value);
                  }}
                  disabled={loadingCats || !addTab}
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-2 focus:outline-none focus:border-zinc-500 disabled:opacity-50">
                  <option value="__add_cat__">＋ Add subcategory</option>
                  <option value="">{loadingCats ? 'Loading subcategories…' : 'Select a subcategory'}</option>
                  {addCats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                {quickAdd === 'cat'
                  ? <QuickCreateRow placeholder="New subcategory name…" value={quickName} onChange={setQuickName}
                      onSubmit={submitQuick} onCancel={() => { setQuickAdd(null); setQuickName(''); setQuickErr(null); }}
                      saving={quickSaving} err={quickErr} />
                  : <div className="mb-3" />}

                {aiErr && <p className="text-red-400 text-xs mb-3">{aiErr}</p>}

                {/* Fields pop in once AI finishes (or immediately when entered manually). */}
                {aiFilling ? (
                  <div className="py-6 text-center">
                    <p className="text-gray-500 text-sm">Filling in part name, supplier, price, part # and link…</p>
                  </div>
                ) : (
                  <>
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

                    <label className="text-xs text-gray-400 mb-1.5 block">Part #</label>
                    <input value={pForm.partNum} onChange={e => setPForm(f => ({ ...f, partNum: e.target.value }))}
                      className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500" />

                    <label className="text-xs text-gray-400 mb-1.5 block">Part link</label>
                    <input value={pForm.supplierLink} onChange={e => setPForm(f => ({ ...f, supplierLink: e.target.value }))}
                      placeholder="https://…"
                      className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500" />

                    <label className="text-xs text-gray-400 mb-1.5 block">Picture URL</label>
                    <div className="flex items-center gap-3 mb-5">
                      <PartImage url={pForm.imageUrl.trim()} className="w-14 h-14" />
                      <input value={pForm.imageUrl} onChange={e => setPForm(f => ({ ...f, imageUrl: e.target.value }))}
                        placeholder="https://…/image.jpg"
                        className="flex-1 bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-zinc-500" />
                    </div>

                    {addErr && <p className="text-red-400 text-xs mb-3">{addErr}</p>}

                    <button onClick={submitPart} disabled={!addTab || !pForm.partName.trim() || !addCategory || saving}
                      className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                      {saving ? 'Adding…' : <><Check className="w-4 h-4" /> Add to sheet</>}
                    </button>
                    <p className="text-gray-600 text-[11px] text-center mt-2">First time, Google will ask you to sign in and allow Sheets access.</p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Backfill pictures modal */}
      {showBackfill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => !bfRunning && setShowBackfill(false)} />
          <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-2xl sm:rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><ImageIcon className="w-5 h-5" /> Backfill pictures</h2>
              {!bfRunning && (
                <button onClick={() => setShowBackfill(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              )}
            </div>

            {!isGoogleOAuthConfigured() && (
              <div className="mb-4 flex items-start gap-2 bg-amber-900/20 border border-amber-900/40 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-amber-300 text-xs">Google sign-in isn't configured yet — backfill can't write to the sheet until it is.</p>
              </div>
            )}

            {!bfRunning && !bfDone && (
              <>
                <p className="text-gray-300 text-sm mb-2">AI finds a product photo for every part that doesn't have one yet and writes it into your sheet's picture column.</p>
                <p className="text-gray-500 text-xs mb-5">This makes one AI call per part, so a big library can take a few minutes. You can cancel anytime — anything found so far is already saved.</p>
                {bfErr && <p className="text-red-400 text-xs mb-3">{bfErr}</p>}
                <button onClick={runBackfill}
                  className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> Start backfill
                </button>
              </>
            )}

            {bfRunning && (
              <>
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                    <span>{bf.total ? `${bf.done} / ${bf.total}` : 'Scanning…'}</span>
                    <span>{bf.found} found · {bf.missing} none · {bf.failed} failed</span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-violet-500 transition-all duration-300"
                      style={{ width: bf.total ? `${Math.round((bf.done / bf.total) * 100)}%` : '0%' }} />
                  </div>
                </div>
                <p className="text-gray-300 text-sm truncate mb-5"><Sparkles className="w-3.5 h-3.5 inline text-violet-300 animate-pulse mr-1" />{bf.current || 'Working…'}</p>
                <button onClick={() => { bfCancel.current = true; }}
                  className="w-full bg-zinc-800 text-white py-2.5 rounded-xl font-medium hover:bg-zinc-700 transition-colors">
                  Cancel
                </button>
              </>
            )}

            {bfDone && (
              <>
                <div className="text-center py-2 mb-4">
                  <Check className="w-10 h-10 text-green-400 mx-auto mb-2" />
                  <p className="text-white font-semibold">
                    {bf.found} picture{bf.found === 1 ? '' : 's'} added
                  </p>
                  <p className="text-gray-500 text-xs mt-1">{bf.missing} with no image found · {bf.failed} failed</p>
                </div>
                {bfErr && <p className="text-red-400 text-xs mb-3">{bfErr}</p>}
                <button onClick={() => window.location.reload()}
                  className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-gray-200 transition-colors">
                  Reload to see pictures
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}