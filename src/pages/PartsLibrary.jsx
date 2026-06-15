import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, Plus, Minus, AlertCircle, Check, X, Sparkles, Camera, Trash2, Search, Image as ImageIcon, ShoppingCart, Pencil, Mail } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { getSheetTabs, getSheetCategories, addPartToCategory, addSheetTab, addCategory as addCategoryToSheet, deletePartRow, renameSheetTab, renameCategory, updatePartRow } from '@/api/googleSheets';
import { getSheetsAccessToken, isGoogleOAuthConfigured } from '@/api/googleAuth';
import { extractPartFromUrl, identifyPartFromImage, scanPartFromImage, fillPartField, guessPartCategory } from '@/api/geminiParts';
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

// ── Cart (parts the user wants to order) ────────────────────────────────────
// Persisted in localStorage; a 'cartchange' event keeps every component in sync.
const CART_KEY = 'partsLibraryCart';

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
}

function saveCart(c) {
  localStorage.setItem(CART_KEY, JSON.stringify(c));
  window.dispatchEvent(new Event('cartchange'));
}

function useCart() {
  const [cart, setCart] = useState(loadCart);
  useEffect(() => {
    const h = () => setCart(loadCart());
    window.addEventListener('cartchange', h);
    return () => window.removeEventListener('cartchange', h);
  }, []);
  const add = (part) => {
    const c = loadCart();
    const k = part.partName;
    if (!k) return;
    c[k] = { part: { ...(c[k]?.part || {}), ...part }, qty: (c[k]?.qty || 0) + 1 };
    saveCart(c);
  };
  const setQty = (k, q) => {
    const c = loadCart();
    if (q <= 0) delete c[k]; else if (c[k]) c[k].qty = q;
    saveCart(c);
  };
  const remove = (k) => { const c = loadCart(); delete c[k]; saveCart(c); };
  const clear = () => saveCart({});
  const count = Object.values(cart).reduce((n, i) => n + (i.qty || 0), 0);
  return { cart, add, setQty, remove, clear, count };
}

// Stock circle color from how much is on-hand vs. allocated to builds.
// gray = no count yet (null) · green = surplus · blue = exact · red = short.
function stockColor(hasStock, stockVal, allocated) {
  if (!hasStock) return 'bg-gray-400';
  if (allocated > stockVal) return 'bg-red-500';
  if (allocated === stockVal) return 'bg-blue-500';
  return 'bg-green-500';
}

// A part's picture: medium thumbnail, with a graceful placeholder when there's
// no image (or the URL fails to load).
function PartImage({ url, className = 'w-14 h-14' }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className={`${className} rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0`}>
        <ImageIcon className="w-5 h-5 text-gray-300" />
      </div>
    );
  }
  return <img src={url} alt="" loading="lazy" draggable={false} onError={() => setErr(true)}
    // Some endpoints (e.g. Amazon's ASIN image for items with no photo) return a
    // 1×1 transparent placeholder with HTTP 200 — treat those as "no image".
    onLoad={(e) => { if (e.target.naturalWidth <= 1 || e.target.naturalHeight <= 1) setErr(true); }}
    className={`${className} rounded-lg object-cover bg-white border border-gray-200 flex-shrink-0`} />;
}

// Low-key AI auto-fill icon, shown to the right of an Add-Part field's label.
// Click → ask AI to fill just that field. Spins while working.
function AiFillButton({ onClick, busy, disabled, title = 'AI auto-fill this' }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} title={title}
      className="text-gray-300 hover:text-violet-600 disabled:opacity-50 disabled:hover:text-gray-300 transition-colors">
      {busy
        ? <span className="block w-3.5 h-3.5 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
        : <Sparkles className="w-3.5 h-3.5" />}
    </button>
  );
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

// Upload an image file to the "part-images" Supabase Storage bucket → public URL.
async function uploadPartImage(file) {
  const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const { data, error } = await supabase.storage.from('part-images').upload(fileName, file, { upsert: true });
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('part-images').getPublicUrl(data.path);
  return urlData.publicUrl;
}

function CategoryRow({ category, spreadsheetId, tab, onChanged, onAddPart, onEditPart }) {
  const { add: addToCart, cart: cartItems } = useCart();
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState(loadStock);
  const [builds, setBuilds] = useState(buildsCache || []);
  const [editStockKey, setEditStockKey] = useState(null); // part whose qty circle is being edited
  const [addedKey, setAddedKey] = useState(null); // part just added to cart (for the ✓ flash)

  // Inline subcategory-title rename
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(category.name);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleErr, setTitleErr] = useState(null);
  const suppressToggle = useRef(false);
  const titleGesture = editGestureProps(() => { setTitleDraft(category.name); setTitleErr(null); setEditingTitle(true); }, suppressToggle);

  // Drag a part onto another subcategory to move it there.
  const [dragOver, setDragOver] = useState(false);
  const [moving, setMoving] = useState(false);
  const handleDropPart = async (e) => {
    e.preventDefault();
    setDragOver(false);
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
    if (!payload?.part?.partName) return;
    if (payload.tab === tab && payload.category === category.name) return; // same place
    setMoving(true);
    try {
      const token = await getSheetsAccessToken();
      // Add to the target first, then remove from the source — a failure mid-way
      // leaves a duplicate (recoverable) rather than losing the part.
      await addPartToCategory(spreadsheetId, tab, category.name, payload.part, token);
      await deletePartRow(spreadsheetId, payload.tab, payload.category, payload.part, token);
      if (payload.tab === tab) onChanged && onChanged();
      else window.location.reload(); // cross-tab: refresh so the source tab updates too
    } catch (err) {
      alert(`Could not move "${payload.part.partName}": ${err.message || 'failed'}`);
    } finally {
      setMoving(false);
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

  const getAllocatedQuantity = (partName) => {
    let allocated = 0;
    builds.forEach(build => {
      (build.parts || []).forEach(part => {
        if (part.partName === partName) allocated += part.quantity || 0;
      });
    });
    return allocated;
  };

  const handleAddToCart = (part) => {
    addToCart(part);
    setAddedKey(part.partName);
    setTimeout(() => setAddedKey(k => (k === part.partName ? null : k)), 800);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={handleDropPart}
      className={`relative border-b border-gray-100 last:border-b-0 transition-colors ${dragOver ? 'bg-violet-50 ring-2 ring-inset ring-violet-400 rounded-xl' : ''}`}
    >
      {moving && (
        <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center rounded-xl">
          <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
        </div>
      )}
      {editingTitle ? (
        <div className="flex items-center gap-2 px-4 py-3">
          <input value={titleDraft} autoFocus
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-gray-900 text-base focus:outline-none focus:border-[#146EB4]" />
          <button onClick={saveTitle} disabled={!titleDraft.trim() || savingTitle}
            className="bg-[#146EB4] text-white text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40">{savingTitle ? '…' : 'Save'}</button>
          <button onClick={() => { setEditingTitle(false); setTitleErr(null); }} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
          {titleErr && <p className="text-red-600 text-xs">{titleErr}</p>}
        </div>
      ) : (
        <button
          onClick={() => { if (suppressToggle.current) { suppressToggle.current = false; return; } setOpen(v => !v); }}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-50/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown className="w-4 h-4 text-[#146EB4] flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#146EB4] flex-shrink-0" />}
            <span {...titleGesture} className="text-[#0F1111] text-[15px] font-bold truncate" title="Hold or double-tap to rename">{category.name}</span>
            <span className="text-gray-400 text-xs font-normal flex-shrink-0">({category.parts.length})</span>
          </div>
        </button>
      )}

      {open && (
        <div className="px-4 pb-4">
          {category.parts.length === 0 ? (
            <p className="text-gray-400 text-sm py-2">No parts found in this subcategory</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {category.parts.map((part, i) => {
                const allocated = getAllocatedQuantity(part.partName);
                const hasStock = stock[part.partName] !== undefined && stock[part.partName] !== '';
                const stockVal = hasStock ? parseInt(stock[part.partName]) : null;
                const circleColor = stockColor(hasStock, stockVal, allocated);
                const editingThis = editStockKey === part.partName;
                const added = addedKey === part.partName;
                const cartQty = cartItems[part.partName]?.qty || 0;

                return (
                  <div key={i}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/json', JSON.stringify({ tab, category: category.name, part })); e.currentTarget.style.opacity = '0.4'; }}
                    onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onClick={(e) => {
                      // Click anywhere on the card opens the part's link — but never
                      // when a real control (button/link/input) was clicked.
                      if (e.target.closest('button, a, input')) return;
                      if (part.supplierLink) window.open(part.supplierLink, '_blank', 'noopener,noreferrer');
                    }}
                    title="Click to open link · drag to move"
                    className={`group flex flex-col bg-white border border-gray-200 rounded-xl p-3 hover:shadow-lg hover:border-gray-300 transition-all active:cursor-grabbing ${part.supplierLink ? 'cursor-pointer' : 'cursor-grab'}`}>
                    <div className="relative w-full aspect-square mb-3">
                      <PartImage url={part.imageUrl} className="w-full h-full" />

                      {/* Quantity (stock) circle — bottom-left, colored by stock logic */}
                      {editingThis ? (
                        <input
                          type="number" min="0" autoFocus
                          value={stock[part.partName] ?? ''}
                          onChange={(e) => handleStockChange(part.partName, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditStockKey(null); }}
                          onBlur={() => setEditStockKey(null)}
                          placeholder="0"
                          className="absolute bottom-1.5 left-1.5 w-12 h-9 rounded-full bg-white border-2 border-[#146EB4] text-gray-900 text-center text-sm font-semibold shadow focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      ) : (
                        <button
                          onClick={() => setEditStockKey(part.partName)}
                          title="Set quantity on hand"
                          className={`absolute bottom-1.5 left-1.5 w-9 h-9 rounded-full ${circleColor} text-white text-sm font-bold shadow-md ring-2 ring-white flex items-center justify-center hover:scale-105 transition-transform`}
                        >
                          {hasStock ? stockVal : <Plus className="w-4 h-4" />}
                        </button>
                      )}

                      {/* Add-to-cart circle — bottom-right (Amazon yellow). On click it
                          flashes green showing the in-cart quantity; a small badge in the
                          top-right corner shows that quantity whenever it's 1 or more. */}
                      <button
                        onClick={() => handleAddToCart(part)}
                        title="Add to cart"
                        className={`absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full shadow-md ring-2 ring-white flex items-center justify-center transition-all hover:scale-105 ${added ? 'bg-green-500 text-white' : 'bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111]'}`}
                      >
                        {added ? <span className="text-sm font-extrabold leading-none">{cartQty}</span> : <ShoppingCart className="w-4 h-4" />}
                        {cartQty > 0 && !added && (
                          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#146EB4] text-white text-[10px] font-bold flex items-center justify-center ring-1 ring-white">{cartQty}</span>
                        )}
                      </button>
                    </div>

                    <span className="text-[#0F1111] text-sm leading-snug line-clamp-2">{part.partName}</span>
                    {part.price && <div className="mt-1 text-[#0F1111] text-base font-bold">{part.price}</div>}
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {part.supplierLink ? (
                        <a href={part.supplierLink} target="_blank" rel="noopener noreferrer" draggable={false} className="text-[#007185] hover:text-[#C7511F] text-xs hover:underline">{part.supplier || 'Link'}</a>
                      ) : part.supplier ? (
                        <button onClick={() => navigator.clipboard.writeText(part.supplier)} className="text-gray-500 text-xs hover:text-gray-900 cursor-copy" title="Copy supplier name">{part.supplier}</button>
                      ) : null}
                      {part.partNum && (
                        <button onClick={() => navigator.clipboard.writeText(part.partNum)} className="text-gray-500 font-mono text-xs hover:text-gray-900 cursor-copy" title="Copy part number">{part.partNum}</button>
                      )}
                      {part.contactEmail && (
                        <a href={`mailto:${part.contactEmail}`} draggable={false} className="inline-flex items-center gap-1 text-[#007185] hover:text-[#C7511F] text-xs hover:underline" title={`Email ${part.contactEmail}`}>
                          <Mail className="w-3 h-3" /> Contact
                        </a>
                      )}
                    </div>
                    <div className="mt-auto pt-2 flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">Allocated: {allocated}</span>
                      <button
                        onClick={() => onEditPart && onEditPart(tab, category.name, part)}
                        title="Edit part"
                        className="text-gray-300 hover:text-[#146EB4] transition-colors p-0.5"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add part to this subcategory — opens the full Add Part flow with this
              category + subcategory already filled in. */}
          <div className="mt-3">
            <button onClick={() => onAddPart && onAddPart(tab, category.name)}
              className="flex items-center gap-2 text-[#007185] hover:text-[#C7511F] text-sm transition-colors">
              <Plus className="w-4 h-4" /> Add part
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function SheetFolder({ tab, spreadsheetId, onRenamed, onAddPart, onEditPart }) {
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
    <section className="mb-4 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {editingTitle ? (
        <div className="flex items-center gap-2 px-5 py-4 bg-blue-50">
          <input value={titleDraft} autoFocus
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-lg focus:outline-none focus:border-[#146EB4]" />
          <button onClick={saveTitle} disabled={!titleDraft.trim() || savingTitle}
            className="bg-[#146EB4] text-white text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-40">{savingTitle ? '…' : 'Save'}</button>
          <button onClick={() => { setEditingTitle(false); setTitleErr(null); }} className="text-gray-500 hover:text-gray-900"><X className="w-4 h-4" /></button>
          {titleErr && <p className="text-red-600 text-xs">{titleErr}</p>}
        </div>
      ) : (
        <button
          onClick={() => { if (suppressToggle.current) { suppressToggle.current = false; return; } handleToggle(); }}
          className="w-full flex items-center justify-between px-5 py-4 text-left bg-gradient-to-b from-white to-[#f3f6fa] hover:to-[#e9f0f8] transition-colors cursor-pointer border-b border-gray-100"
        >
          <div className="flex items-center gap-3 min-w-0">
            {open ? <ChevronDown className="w-5 h-5 text-[#146EB4] flex-shrink-0" /> : <ChevronRight className="w-5 h-5 text-[#146EB4] flex-shrink-0" />}
            <span {...titleGesture} className="text-[#0F1111] text-lg font-bold tracking-wide truncate" title="Hold or double-tap to rename">{tab}</span>
          </div>
        </button>
      )}

      {open && (
        <div>
          {loading && <div className="px-5 py-4"><p className="text-gray-400 text-sm">Loading subcategories…</p></div>}
          {!loading && categories.length === 0 && loaded && (
            <div className="px-5 py-4"><p className="text-gray-400 text-sm">No subcategories found</p></div>
          )}
          {categories.map((cat, i) => (
            <CategoryRow key={cat.name + i} category={cat} spreadsheetId={spreadsheetId} tab={tab} onChanged={loadCategories} onAddPart={onAddPart} onEditPart={onEditPart} />
          ))}

          {!loading && (
            <div className="px-4 py-3 border-t border-gray-100">
              {addingCat ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitCategory(); }}
                      placeholder="New subcategory name…" autoFocus
                      className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder:text-gray-400 text-sm focus:outline-none focus:border-[#146EB4]" />
                    <button onClick={submitCategory} disabled={!newCatName.trim() || savingCat}
                      className="bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] text-sm font-semibold px-3 py-2 rounded-full disabled:opacity-40">{savingCat ? '…' : 'Add'}</button>
                    <button onClick={() => { setAddingCat(false); setNewCatName(''); setCatErr(null); }} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
                  </div>
                  {catErr && <p className="text-red-600 text-xs">{catErr}</p>}
                </div>
              ) : (
                <button onClick={() => setAddingCat(true)} className="flex items-center gap-2 text-[#007185] hover:text-[#C7511F] text-sm transition-colors">
                  <Plus className="w-4 h-4" /> Add subcategory
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
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
          className="flex-1 bg-white border border-gray-300 rounded-xl px-4 py-2.5 text-gray-900 placeholder:text-gray-400 text-sm focus:outline-none focus:border-[#146EB4]"
        />
        <button onClick={onSubmit} disabled={!value.trim() || saving}
          className="bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] text-sm font-semibold px-4 py-2.5 rounded-full disabled:opacity-40">
          {saving ? '…' : 'Add'}
        </button>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
      </div>
      {err && <p className="text-red-600 text-xs mt-1.5">{err}</p>}
    </div>
  );
}

// Parse a price string like "$24.99" → 24.99 (best effort).
function parsePrice(p) {
  const n = parseFloat(String(p || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── Fuzzy library matching (scan → find the part you already stock) ──────────
// Identified names are wordy ("Victron 100/30 MPPT Solar Charge Controller"); the
// library entries are terser. Score by how many significant tokens overlap, in
// either direction, and surface the few best candidates for the user to confirm.
function tokenize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length > 2);
}
function overlapScore(a, b) {
  const ta = tokenize(a);
  if (!ta.length) return 0;
  const tb = new Set(tokenize(b));
  return ta.filter(t => tb.has(t)).length / ta.length;
}
function findLibraryMatches(name, parts) {
  if (!name || !parts?.length) return [];
  return parts
    .map(p => ({ p, score: Math.max(overlapScore(name, p.partName), overlapScore(p.partName, name)) }))
    .filter(x => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(x => x.p);
}

export default function PartsLibrary() {
  const navigate = useNavigate();
  const cart = useCart();
  const [showCart, setShowCart] = useState(false);
  const [orderBlocked, setOrderBlocked] = useState(false); // browser blocked the extra Order tabs
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
  const allPartsPromise = useRef(null);

  // Fetch every tab's parts once and cache the flat list. Shared by search and the
  // scan flow; dedupes concurrent callers via a promise ref so we fetch at most once.
  const loadAllParts = () => {
    if (allParts) return Promise.resolve(allParts);
    if (allPartsPromise.current) return allPartsPromise.current;
    if (!spreadsheetId || sheetTabs.length === 0) return Promise.resolve([]);
    allPartsPromise.current = Promise.all(sheetTabs.map(t =>
      getSheetCategories(spreadsheetId, t)
        .then(r => ({ tab: t, cats: r.data.categories || [] }))
        .catch(() => ({ tab: t, cats: [] }))
    )).then(results => {
      const flat = [];
      results.forEach(({ tab, cats }) =>
        cats.forEach(c => (c.parts || []).forEach(p => flat.push({ ...p, tab, category: c.name })))
      );
      setAllParts(flat);
      return flat;
    });
    return allPartsPromise.current;
  };

  useEffect(() => {
    if (!search.trim() || allParts || loadingAll || !spreadsheetId || sheetTabs.length === 0) return;
    setLoadingAll(true);
    loadAllParts().finally(() => setLoadingAll(false));
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

  // Add Part flow
  const [showAdd, setShowAdd] = useState(false);
  const [addStarted, setAddStarted] = useState(false); // revealed after "Done" on the link step
  const [addTab, setAddTab] = useState('');
  const [addCats, setAddCats] = useState([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [addCategory, setAddCategory] = useState('');
  const pendingSubcatRef = useRef(null); // AI-guessed subcategory, applied once its tab's cats load
  // Latest user selection, readable inside the async AI fill (whose closure is stale)
  // so the AI never overwrites a category the user picked while it was working.
  const addTabRef = useRef('');
  useEffect(() => { addTabRef.current = addTab; }, [addTab]);
  const [pForm, setPForm] = useState({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '', imageUrl: '', contactEmail: '' });
  const [saving, setSaving] = useState(false);
  const [submitTried, setSubmitTried] = useState(false); // flags missing category/subcategory red
  const [addErr, setAddErr] = useState(null);
  const [aiFilling, setAiFilling] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const photoInputRef = useRef(null);
  const addFileRef = useRef(null); // Add Part "Upload photo" file input
  const [uploadingAddImg, setUploadingAddImg] = useState(false);

  // Upload a picture file for the Add Part form → Supabase Storage → set the URL.
  const onPickAddImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAddImg(true);
    setAddErr(null);
    try {
      const url = await uploadPartImage(file);
      setPForm(f => ({ ...f, imageUrl: url }));
    } catch {
      setAddErr('Image upload failed — create a "part-images" bucket (public) in Supabase Storage.');
    } finally {
      setUploadingAddImg(false);
    }
  };

  // Take/upload a photo → Gemini identifies the part and finds a buy link.
  // Reached via the Inventory deep-link (?photo=1); the in-modal button was removed.
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
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
    } catch {
      // Identify failed — user can still fill the form in manually.
    }
  };

  // ── Scan a part (the purple orb on this page) ──────────────────────────────
  // Take a photo → identify it + find it on Amazon AND search the library, in
  // parallel. If it's in the library you confirm the match and add a qty to the
  // cart; if not, the Amazon link is already there + an Add-to-Library shortcut.
  const scanInputRef = useRef(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanErr, setScanErr] = useState(null);
  const [scanResult, setScanResult] = useState(null); // { partName, supplier, supplierLink, price, imageUrl }
  const [scanMatches, setScanMatches] = useState([]);
  const [scanChosen, setScanChosen] = useState(null); // the library part the user confirmed
  const [scanQty, setScanQty] = useState(1);
  const [scanAdded, setScanAdded] = useState(false);

  // The orb on the Parts Library dispatches this; open the camera within the gesture.
  useEffect(() => {
    const h = () => scanInputRef.current?.click();
    window.addEventListener('vertex:scan-part', h);
    return () => window.removeEventListener('vertex:scan-part', h);
  }, []);

  const handleScan = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanOpen(true);
    setScanLoading(true);
    setScanErr(null);
    setScanResult(null);
    setScanMatches([]);
    setScanChosen(null);
    setScanQty(1);
    setScanAdded(false);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      // Amazon lookup and library load run together — so if the part isn't in the
      // library, the Amazon link is already waiting (no extra round-trip to wait on).
      const [info, parts] = await Promise.all([
        scanPartFromImage(base64, file.type || 'image/jpeg'),
        loadAllParts(),
      ]);
      setScanResult(info);
      setScanMatches(findLibraryMatches(info.partName, parts));
    } catch (err) {
      setScanErr(err.message || 'Could not identify the part');
    } finally {
      setScanLoading(false);
    }
  };

  const addScannedToCart = () => {
    if (!scanChosen) return;
    for (let i = 0; i < scanQty; i++) cart.add(scanChosen);
    setScanAdded(true);
  };

  // "Add to Parts Library" from a no-match scan: prefill + open the Add Part modal.
  const addScannedToLibrary = () => {
    const r = scanResult || {};
    openAdd();
    setPForm({
      partName: r.partName || '',
      supplier: r.supplier || '',
      supplierLink: r.supplierLink || '',
      partNum: r.partNum || '',
      price: r.price || '',
      imageUrl: r.imageUrl || '',
      contactEmail: r.contactEmail || '',
    });
    setAddStarted(true);
    setScanOpen(false);
  };

  // "Done" on the link step: reveal the rest of the form and, if a link was given,
  // read it with Gemini to auto-fill the fields AND guess the best category /
  // subcategory from the library taxonomy.
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
      // Only auto-pick a category/subcategory if the user hasn't chosen one while
      // the AI was working (subcategory can't be set without a category, so the
      // category check covers both).
      const matchTab = sheetTabs.find(t => t.toLowerCase() === (r.category || '').toLowerCase());
      if (matchTab && !addTabRef.current) {
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

  // When set, the Add Part modal is in "edit" mode for this existing part
  // ({ tab, category, part }); saving updates it (or moves it if its category /
  // subcategory changed) instead of inserting a new row.
  const [editingOriginal, setEditingOriginal] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const openAdd = () => {
    setAddErr(null);
    setAiErr(null);
    setQuickAdd(null);
    setAddStarted(false);
    setSubmitTried(false);
    setEditingOriginal(null);
    setConfirmDel(false);
    setAddTab('');
    setAddCategory('');
    setAddCats([]);
    pendingSubcatRef.current = null;
    setPForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '', imageUrl: '', contactEmail: '' });
    setShowAdd(true);
  };

  // Shortcut from a subcategory's "Add part": open the full Add Part flow with the
  // category + subcategory prefilled, jumping straight to the form (skip the link step).
  const openAddFor = (presetTab, presetSubcat) => {
    openAdd();
    setAddStarted(true);
    setAddTab(presetTab);
    pendingSubcatRef.current = presetSubcat || null; // applied when the tab's cats load
  };

  // Edit a part: open the same Add Part form, prefilled with the part (including its
  // category + subcategory). Saving updates it in place, or moves it if you change
  // the category/subcategory.
  const openEditFor = (srcTab, srcCat, part) => {
    setAddErr(null);
    setAiErr(null);
    setQuickAdd(null);
    setSubmitTried(false);
    setConfirmDel(false);
    setEditingOriginal({ tab: srcTab, category: srcCat, part });
    setAddStarted(true);
    setAddTab(srcTab);
    setAddCategory('');
    setAddCats([]);
    pendingSubcatRef.current = srcCat || null; // applied when the tab's cats load
    setPForm({
      partName: part.partName || '', supplier: part.supplier || '', supplierLink: part.supplierLink || '',
      partNum: part.partNum || '', price: part.price || '', imageUrl: part.imageUrl || '',
      contactEmail: part.contactEmail || '',
    });
    setShowAdd(true);
  };

  // Per-field AI auto-fill (the little sparkle next to each Add-Part field).
  const [aiField, setAiField] = useState(null); // which field is currently AI-filling

  const aiFillOne = async (field) => {
    if (aiField) return;
    setAiField(field);
    setAiErr(null);
    try {
      const val = await fillPartField(field, pForm);
      if (val) setPForm(f => ({ ...f, [field]: val }));
      else setAiErr('AI couldn’t fill that — paste a part link (or add more details) first.');
    } catch (e) {
      setAiErr(e?.message || 'AI fill failed.');
    } finally {
      setAiField(null);
    }
  };

  // AI-pick the category/subcategory. If the user already chose a category, only
  // fill the subcategory within it; otherwise guess both.
  const aiGuessCategory = async () => {
    if (aiField || !spreadsheetId || sheetTabs.length === 0) return;
    setAiField('category');
    setAiErr(null);
    try {
      const taxonomy = {};
      const results = await Promise.all(sheetTabs.map(t =>
        getSheetCategories(spreadsheetId, t)
          .then(r => ({ t, cats: r.data.categories || [] }))
          .catch(() => ({ t, cats: [] }))
      ));
      results.forEach(({ t, cats }) => { taxonomy[t] = cats.map(c => c.name); });
      const scope = addTab ? { [addTab]: taxonomy[addTab] || [] } : taxonomy;
      const g = await guessPartCategory(pForm, scope);
      if (!addTab) {
        const matchTab = sheetTabs.find(t => t.toLowerCase() === (g.category || '').toLowerCase());
        if (matchTab) { pendingSubcatRef.current = g.subcategory || null; setAddTab(matchTab); }
        else setAiErr('AI couldn’t pick a category — paste a part link or a part name first.');
      } else {
        const m = addCats.find(c => c.name.toLowerCase() === (g.subcategory || '').toLowerCase());
        if (m) setAddCategory(m.name);
        else setAiErr('AI couldn’t pick a subcategory here — paste a part link or a part name first.');
      }
    } catch (e) {
      setAiErr(e?.message || 'AI fill failed.');
    } finally {
      setAiField(null);
    }
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
        setAddTab(name);
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
    if (saving) return;
    if (!addTab || !addCategory) { setSubmitTried(true); return; } // turn the empty select(s) red
    if (!pForm.partName.trim()) return;
    setSaving(true);
    setAddErr(null);
    try {
      const token = await getSheetsAccessToken();
      const fields = {
        partName: pForm.partName.trim(),
        supplier: pForm.supplier.trim(),
        supplierLink: pForm.supplierLink.trim(),
        partNum: pForm.partNum.trim(),
        price: pForm.price.trim(),
        imageUrl: pForm.imageUrl.trim(),
        contactEmail: pForm.contactEmail.trim(),
      };
      if (editingOriginal) {
        const samePlace = addTab === editingOriginal.tab && addCategory === editingOriginal.category;
        if (samePlace) {
          await updatePartRow(spreadsheetId, addTab, addCategory, editingOriginal.part, fields, token);
        } else {
          // Category/subcategory changed → move: add to the new spot, then remove the old.
          await addPartToCategory(spreadsheetId, addTab, addCategory, fields, token);
          await deletePartRow(spreadsheetId, editingOriginal.tab, editingOriginal.category, editingOriginal.part, token);
        }
      } else {
        await addPartToCategory(spreadsheetId, addTab, addCategory, fields, token);
      }
      setShowAdd(false);
      setPForm({ partName: '', supplier: '', supplierLink: '', partNum: '', price: '', imageUrl: '', contactEmail: '' });
      window.location.reload();
    } catch (e) {
      setAddErr(e.message || (editingOriginal ? 'Failed to save part' : 'Failed to add part'));
    } finally {
      setSaving(false);
    }
  };

  // Delete the part being edited (only available in edit mode).
  const deleteEditingPart = async () => {
    if (!editingOriginal || saving) return;
    setSaving(true);
    setAddErr(null);
    try {
      const token = await getSheetsAccessToken();
      await deletePartRow(spreadsheetId, editingOriginal.tab, editingOriginal.category, editingOriginal.part, token);
      setShowAdd(false);
      window.location.reload();
    } catch (e) {
      setAddErr(e.message || 'Failed to delete part');
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
      if (sheetTabs.length === 0) return;
      intentDone.current = true;
      setTimeout(() => searchRef.current?.focus(), 60);
    } else if (sheetTabs.length > 0) {
      intentDone.current = true;
      openAdd();
      if (photo) setTimeout(() => photoInputRef.current?.click(), 200);
    } else {
      return;
    }
    window.history.replaceState(null, '', '/PartsLibrary');
  }, [loading, sheetTabs]);

  const cartTotal = Object.values(cart.cart).reduce((s, i) => s + parsePrice(i.part?.price) * (i.qty || 0), 0);

  // Everything in the cart is routable (a real link, or a name we can search).
  const buyableCount = Object.keys(cart.cart).length;

  // Order: open every cart item's link in its own tab. Browsers allow only the
  // first new tab per click and block the rest until the site is allowed to open
  // pop-ups — so we open what we can and, if any were blocked, surface a one-time
  // hint telling the user to allow pop-ups (after which every part opens at once).
  // Parts without a link fall back to an Amazon search by name.
  // Open a Gmail compose tab (signed-in account) pre-addressed to the supplier,
  // with an "Order …" subject and the part # + quantity in the body.
  const emailSupplier = (item) => {
    const part = item.part || {};
    const to = part.contactEmail || '';
    const su = `Order ${part.partName || 'part'}`;
    const body = [
      part.partName ? `Part: ${part.partName}` : '',
      part.partNum ? `Part #: ${part.partNum}` : '',
      `Quantity: ${item.qty || 1}`,
    ].filter(Boolean).join('\n');
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleOrder = () => {
    const urls = Object.values(cart.cart).map(({ part }) => {
      const link = (part?.supplierLink || '').trim();
      const name = (part?.partName || '').trim();
      return link || (name ? `https://www.amazon.com/s?k=${encodeURIComponent(name)}` : '');
    }).filter(Boolean);
    let blocked = 0;
    urls.forEach(url => {
      const w = window.open(url, '_blank');
      if (w) { try { w.opener = null; } catch { /* cross-origin */ } }
      else blocked++;
    });
    setOrderBlocked(blocked > 0);
  };

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      {/* ───────────── Top bar (Amazon blue) ───────────── */}
      <header className="sticky top-0 z-30 shadow-md">
        <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap" style={{ background: 'linear-gradient(180deg,#232F3E 0%,#131A22 100%)' }}>
          <button onClick={() => navigate('/')} className="text-gray-200 hover:text-white transition-colors" title="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white text-xl font-extrabold tracking-tight whitespace-nowrap">Parts Library</h1>

          {sheetTabs.length > 0 && (
            <div className="relative flex-1 min-w-[180px] max-w-2xl order-last w-full sm:order-none sm:w-auto">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search parts…"
                className="w-full bg-white rounded-md pl-9 pr-9 py-2 text-gray-900 placeholder:text-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#febd69]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {sheetTabs.length > 0 && (
              <button onClick={openAdd}
                className="flex items-center gap-1.5 bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] font-semibold text-sm px-3 py-2 rounded-full transition-colors">
                <Plus className="w-4 h-4" /> Add Part
              </button>
            )}
            <button onClick={() => setShowCart(true)} title="Cart"
              className="relative flex items-center justify-center text-white border border-[#3a4553] bg-[#2b3848] hover:bg-[#3a4553] p-2 rounded-md transition-colors">
              <ShoppingCart className="w-5 h-5" />
              {cart.count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FFD814] text-[#0F1111] text-[11px] font-bold flex items-center justify-center">{cart.count}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {q ? (
          /* Search results */
          <div>
            {loadingAll && <p className="text-gray-600 text-sm mb-3">Searching all parts…</p>}
            {!loadingAll && (
              <p className="text-gray-700 text-sm mb-3">
                {searchResults.length} result{searchResults.length === 1 ? '' : 's'} for “<span className="font-semibold">{search.trim()}</span>”
              </p>
            )}
            {!loadingAll && searchResults.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl px-6 py-8 text-center">
                <p className="text-gray-500 text-sm">No parts match “{search.trim()}”</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {searchResults.map((p, i) => (
                  <div key={p.tab + p.category + p.partName + i} className="group flex flex-col bg-white border border-gray-200 rounded-xl p-3 hover:shadow-lg transition-all">
                    <div className="relative w-full aspect-square mb-3">
                      <PartImage url={p.imageUrl} className="w-full h-full" />
                      <button onClick={() => cart.add(p)} title="Add to cart"
                        className="absolute bottom-1.5 right-1.5 w-9 h-9 rounded-full bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] shadow-md ring-2 ring-white flex items-center justify-center transition-all hover:scale-105">
                        <ShoppingCart className="w-4 h-4" />
                      </button>
                    </div>
                    <span className="text-[#0F1111] text-sm leading-snug line-clamp-2">{p.partName}</span>
                    {p.price && <div className="mt-1 text-[#0F1111] text-base font-bold">{p.price}</div>}
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {p.supplierLink ? (
                        <a href={p.supplierLink} target="_blank" rel="noopener noreferrer" className="text-[#007185] hover:text-[#C7511F] text-xs hover:underline">{p.supplier || 'Link'}</a>
                      ) : p.supplier ? (
                        <span className="text-gray-500 text-xs">{p.supplier}</span>
                      ) : null}
                      {p.partNum && <span className="text-gray-500 font-mono text-xs">{p.partNum}</span>}
                    </div>
                    <div className="text-gray-400 text-[11px] mt-2">{p.tab} · {p.category}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {loading && <p className="text-gray-600 text-sm">Loading categories…</p>}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {sheetTabs.map((tab) => (
              <SheetFolder key={tab} tab={tab} spreadsheetId={spreadsheetId} onRenamed={reloadTabs} onAddPart={openAddFor} onEditPart={openEditFor} />
            ))}
            {!loading && !error && sheetTabs.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl px-6 py-8 text-center">
                <p className="text-gray-500 text-sm">Link a Master Sheet to see categories</p>
              </div>
            )}
            {!loading && spreadsheetId && (
              <div className="mt-2">
                {addingTab ? (
                  <div className="flex flex-col gap-2 bg-white border border-gray-200 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <input value={newTabName} onChange={e => setNewTabName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitTab(); }}
                        placeholder="New category name…" autoFocus
                        className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2.5 text-gray-900 placeholder:text-gray-400 text-sm focus:outline-none focus:border-[#146EB4]" />
                      <button onClick={submitTab} disabled={!newTabName.trim() || savingTab}
                        className="bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] text-sm font-semibold px-4 py-2.5 rounded-full disabled:opacity-40">{savingTab ? '…' : 'Add'}</button>
                      <button onClick={() => { setAddingTab(false); setNewTabName(''); setTabErr(null); }} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
                    </div>
                    {tabErr && <p className="text-red-600 text-xs">{tabErr}</p>}
                  </div>
                ) : (
                  <button onClick={() => setAddingTab(true)}
                    className="flex items-center gap-2 text-[#007185] hover:text-[#C7511F] text-sm font-medium transition-colors">
                    <Plus className="w-4 h-4" /> Add category
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ───────────── Cart modal ───────────── */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCart(false)} />
          <div className="relative w-full sm:max-w-md bg-white border border-gray-200 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> Cart ({cart.count})</h2>
              <button onClick={() => setShowCart(false)} className="text-gray-400 hover:text-gray-900"><X className="w-5 h-5" /></button>
            </div>

            {Object.keys(cart.cart).length === 0 ? (
              <p className="text-gray-500 text-sm py-6 text-center">Your cart is empty. Tap the yellow cart button on a part to add it.</p>
            ) : (
              <>
                <div className="space-y-3 mb-5">
                  {Object.entries(cart.cart).map(([key, item]) => (
                    <div key={key}
                      onClick={(e) => {
                        // Click anywhere on the row (but not a control) opens the part's link.
                        if (e.target.closest('button, a, input')) return;
                        if (item.part?.supplierLink) window.open(item.part.supplierLink, '_blank', 'noopener,noreferrer');
                      }}
                      className={`flex items-center gap-3 border border-gray-100 rounded-xl p-2 ${item.part?.supplierLink ? 'cursor-pointer hover:border-gray-300' : ''}`}>
                      <PartImage url={item.part?.imageUrl} className="w-12 h-12" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[#0F1111] text-sm leading-snug line-clamp-2">{item.part?.partName || key}</p>
                        {item.part?.price && <p className="text-[#0F1111] text-sm font-bold">{item.part.price}</p>}
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          {item.part?.partNum && (
                            <button onClick={() => navigator.clipboard.writeText(item.part.partNum)}
                              className="text-gray-500 font-mono text-xs hover:text-gray-900 cursor-copy" title="Copy part number">#{item.part.partNum}</button>
                          )}
                          {item.part?.contactEmail && (
                            <button onClick={() => emailSupplier(item)}
                              className="inline-flex items-center gap-1 text-[#007185] hover:text-[#C7511F] text-xs" title={`Email ${item.part.contactEmail} to order`}>
                              <Mail className="w-3 h-3" /> Contact
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-1">
                        <button onClick={() => cart.setQty(key, (item.qty || 1) - 1)} className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-gray-900"><Minus className="w-3.5 h-3.5" /></button>
                        <span className="w-5 text-center text-sm text-gray-900">{item.qty}</span>
                        <button onClick={() => cart.setQty(key, (item.qty || 0) + 1)} className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-gray-900"><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                      <button onClick={() => cart.remove(key)} className="text-gray-400 hover:text-red-600 px-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                {cartTotal > 0 && (
                  <div className="flex items-center justify-between mb-4 text-[#0F1111]">
                    <span className="text-sm text-gray-600">Estimated total</span>
                    <span className="text-lg font-bold">${cartTotal.toFixed(2)}</span>
                  </div>
                )}
                <button onClick={handleOrder} disabled={buyableCount === 0}
                  className="w-full flex items-center justify-center gap-2 bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] font-bold py-3.5 rounded-full transition-colors disabled:opacity-40 mb-2">
                  <ShoppingCart className="w-4 h-4" /> Order{buyableCount > 0 ? ` (${buyableCount})` : ''}
                </button>
                {orderBlocked ? (
                  <div className="mb-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-amber-700 text-[11px]">Your browser blocked the other tabs. Click the blocked-pop-ups icon in the address bar, choose <span className="font-semibold">“Always allow pop-ups from this site,”</span> then press Order again.</p>
                  </div>
                ) : (
                  <p className="text-gray-400 text-[11px] text-center mb-2">Opens every part in its own tab, all at once.</p>
                )}
                <button onClick={() => cart.clear()}
                  className="w-full flex items-center justify-center gap-2 text-gray-600 hover:text-red-600 py-2.5 rounded-full font-medium transition-colors">
                  <Trash2 className="w-4 h-4" /> Clear cart
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ───────────── Add Part modal ───────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setShowAdd(false)} />
          <div className="relative w-full sm:max-w-md bg-white border border-gray-200 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">{editingOriginal ? 'Edit Part' : 'Add Part'}</h2>
              <button onClick={() => !saving && setShowAdd(false)} className="text-gray-400 hover:text-gray-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!isGoogleOAuthConfigured() && (
              <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-amber-700 text-xs">Google sign-in isn't configured yet (VITE_GOOGLE_OAUTH_CLIENT_ID). Adding a part will fail until it's set.</p>
              </div>
            )}

            <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
              onChange={handlePhoto} className="hidden" />

            {!addStarted ? (
              <>
                <label className="text-xs text-gray-500 mb-1.5 block">Part link</label>
                <input value={pForm.supplierLink} autoFocus
                  onChange={e => setPForm(f => ({ ...f, supplierLink: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleDone(); }}
                  placeholder="Paste the supplier / product link…"
                  className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 text-sm mb-4 focus:outline-none focus:border-[#146EB4]" />

                <button onClick={handleDone}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-3.5 rounded-full transition-colors flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> Fill with AI
                </button>
                <p className="text-gray-400 text-[11px] text-center mt-2 mb-4">AI reads the link and fills in the part for you.</p>

                <button onClick={() => setAddStarted(true)}
                  className="w-full text-gray-500 hover:text-gray-700 text-xs py-2 transition-colors">
                  Skip — enter manually
                </button>
              </>
            ) : (
              <>
                {aiFilling && (
                  <div className="mb-4 flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5">
                    <Sparkles className="w-4 h-4 text-violet-600 flex-shrink-0 animate-pulse" />
                    <p className="text-violet-700 text-xs">Reading the link and filling in the details… pick a category meanwhile.</p>
                  </div>
                )}

                {/* Part link + AI: paste a link, then "Fill with AI" fills every
                    field at once — or use the ✨ next to any single field. */}
                <label className="text-xs text-gray-500 mb-1.5 block">Part link</label>
                <input value={pForm.supplierLink}
                  onChange={e => setPForm(f => ({ ...f, supplierLink: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleDone(); }}
                  placeholder="Paste the supplier / product link…"
                  className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 text-sm mb-2 focus:outline-none focus:border-[#146EB4]" />
                <button onClick={handleDone} disabled={aiFilling || !pForm.supplierLink.trim()}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4" /> {aiFilling ? 'Filling…' : 'Fill with AI'}
                </button>
                <p className="text-gray-400 text-[11px] text-center mb-4">Fills every field from the link — or tap ✨ next to any field to fill just that one.</p>

                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-500">Category</label>
                  <AiFillButton onClick={aiGuessCategory} busy={aiField === 'category'} title="AI pick category" />
                </div>
                <select value={addTab} onChange={e => {
                    if (e.target.value === '__add_tab__') { setQuickAdd('tab'); setQuickName(''); setQuickErr(null); return; }
                    setQuickAdd(null); setAddTab(e.target.value);
                  }}
                  className={`w-full bg-white border rounded-xl px-4 py-3 text-gray-900 text-sm mb-2 focus:outline-none ${submitTried && !addTab ? 'border-red-500 focus:border-red-500' : 'border-gray-300 focus:border-[#146EB4]'}`}>
                  <option value="__add_tab__">＋ Add new category</option>
                  <option value="">Select a category</option>
                  {sheetTabs.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {quickAdd === 'tab'
                  ? <QuickCreateRow placeholder="New category name…" value={quickName} onChange={setQuickName}
                      onSubmit={submitQuick} onCancel={() => { setQuickAdd(null); setQuickName(''); setQuickErr(null); }}
                      saving={quickSaving} err={quickErr} />
                  : <div className="mb-2" />}

                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-500">Subcategory</label>
                  <AiFillButton onClick={aiGuessCategory} busy={aiField === 'category'} disabled={!addTab} title="AI pick subcategory" />
                </div>
                <select value={addCategory} onChange={e => {
                    if (e.target.value === '__add_cat__') { setQuickAdd('cat'); setQuickName(''); setQuickErr(null); return; }
                    setQuickAdd(null); setAddCategory(e.target.value);
                  }}
                  disabled={loadingCats || !addTab}
                  className={`w-full bg-white border rounded-xl px-4 py-3 text-gray-900 text-sm mb-2 focus:outline-none disabled:opacity-50 ${submitTried && !addCategory ? 'border-red-500 focus:border-red-500' : 'border-gray-300 focus:border-[#146EB4]'}`}>
                  <option value="__add_cat__">＋ Add subcategory</option>
                  <option value="">{loadingCats ? 'Loading subcategories…' : 'Select a subcategory'}</option>
                  {addCats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                {quickAdd === 'cat'
                  ? <QuickCreateRow placeholder="New subcategory name…" value={quickName} onChange={setQuickName}
                      onSubmit={submitQuick} onCancel={() => { setQuickAdd(null); setQuickName(''); setQuickErr(null); }}
                      saving={quickSaving} err={quickErr} />
                  : <div className="mb-3" />}

                {aiErr && <p className="text-red-600 text-xs mb-3">{aiErr}</p>}

                {aiFilling ? (
                  <div className="py-6 text-center">
                    <p className="text-gray-500 text-sm">Filling in part name, supplier, price, part # and link…</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-gray-500">Part name *</label>
                      <AiFillButton onClick={() => aiFillOne('partName')} busy={aiField === 'partName'} />
                    </div>
                    <input value={pForm.partName} onChange={e => setPForm(f => ({ ...f, partName: e.target.value }))}
                      placeholder="e.g. 12V LED strip"
                      className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 text-sm mb-4 focus:outline-none focus:border-[#146EB4]" />

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-gray-500">Supplier</label>
                          <AiFillButton onClick={() => aiFillOne('supplier')} busy={aiField === 'supplier'} />
                        </div>
                        <input value={pForm.supplier} onChange={e => setPForm(f => ({ ...f, supplier: e.target.value }))}
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-3 text-gray-900 text-sm focus:outline-none focus:border-[#146EB4]" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-gray-500">Price</label>
                          <AiFillButton onClick={() => aiFillOne('price')} busy={aiField === 'price'} />
                        </div>
                        <input value={pForm.price} onChange={e => setPForm(f => ({ ...f, price: e.target.value }))}
                          placeholder="$0.00"
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-3 text-gray-900 text-sm focus:outline-none focus:border-[#146EB4]" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-gray-500">Part #</label>
                      <AiFillButton onClick={() => aiFillOne('partNum')} busy={aiField === 'partNum'} />
                    </div>
                    <input value={pForm.partNum} onChange={e => setPForm(f => ({ ...f, partNum: e.target.value }))}
                      className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-gray-900 text-sm mb-4 focus:outline-none focus:border-[#146EB4]" />

                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-gray-500">Supplier contact email</label>
                      <AiFillButton onClick={() => aiFillOne('contactEmail')} busy={aiField === 'contactEmail'} title="AI find a contact email" />
                    </div>
                    <input type="email" value={pForm.contactEmail} onChange={e => setPForm(f => ({ ...f, contactEmail: e.target.value }))}
                      placeholder="contact@supplier.com"
                      className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 text-sm mb-4 focus:outline-none focus:border-[#146EB4]" />

                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-gray-500">Picture</label>
                      <AiFillButton onClick={() => aiFillOne('imageUrl')} busy={aiField === 'imageUrl'} title="AI find an image" />
                    </div>
                    <div className="flex items-start gap-3 mb-5">
                      <PartImage url={pForm.imageUrl.trim()} className="w-20 h-20" />
                      <div className="flex-1 flex flex-col gap-2">
                        <input ref={addFileRef} type="file" accept="image/*" capture="environment" onChange={onPickAddImage} className="hidden" />
                        <button type="button" onClick={() => addFileRef.current?.click()} disabled={uploadingAddImg}
                          className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-60">
                          <Camera className="w-4 h-4" /> {uploadingAddImg ? 'Uploading…' : 'Upload photo'}
                        </button>
                        <input value={pForm.imageUrl} onChange={e => setPForm(f => ({ ...f, imageUrl: e.target.value }))}
                          placeholder="…or paste an image URL"
                          className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-[#146EB4]" />
                      </div>
                    </div>

                    {addErr && <p className="text-red-600 text-xs mb-3">{addErr}</p>}
                    {submitTried && (!addTab || !addCategory) && (
                      <p className="text-red-600 text-xs mb-3">Pick a category and subcategory before adding to the sheet.</p>
                    )}

                    <button onClick={submitPart} disabled={!pForm.partName.trim() || saving}
                      className="w-full bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] font-bold py-3.5 rounded-full transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                      {saving ? (editingOriginal ? 'Saving…' : 'Adding…') : <><Check className="w-4 h-4" /> {editingOriginal ? 'Save changes' : 'Add to sheet'}</>}
                    </button>

                    {editingOriginal && (
                      confirmDel ? (
                        <button onClick={deleteEditingPart} disabled={saving}
                          className="w-full mt-3 flex items-center justify-center gap-2 bg-red-600 text-white py-3 rounded-full font-semibold hover:bg-red-500 transition-colors disabled:opacity-50">
                          <Trash2 className="w-4 h-4" /> {saving ? 'Deleting…' : 'Tap again to confirm delete'}
                        </button>
                      ) : (
                        <button onClick={() => setConfirmDel(true)} disabled={saving}
                          className="w-full mt-3 flex items-center justify-center gap-2 text-red-600 hover:text-red-700 py-2.5 rounded-full font-medium transition-colors disabled:opacity-50">
                          <Trash2 className="w-4 h-4" /> Delete part
                        </button>
                      )
                    )}

                    {!editingOriginal && <p className="text-gray-400 text-[11px] text-center mt-2">First time, Google will ask you to sign in and allow Sheets access.</p>}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Hidden camera input — opened by the purple orb's scan event */}
      <input ref={scanInputRef} type="file" accept="image/*" capture="environment"
        onChange={handleScan} className="hidden" />

      {/* ───────────── Scan-to-cart sheet ───────────── */}
      {scanOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setScanOpen(false)} />
          <div className="relative w-full sm:max-w-md bg-white border border-gray-200 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Camera className="w-5 h-5 text-violet-600" /> Scan a part
              </h2>
              <button onClick={() => setScanOpen(false)} className="text-gray-400 hover:text-gray-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            {scanLoading ? (
              <div className="py-10 text-center">
                <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                <p className="text-gray-600 text-sm">Identifying the part & searching your library…</p>
                <p className="text-gray-400 text-xs mt-1">Also finding it on Amazon, just in case.</p>
              </div>
            ) : scanErr ? (
              <div className="py-8 text-center">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-red-600 text-sm mb-4">{scanErr}</p>
                <button onClick={() => scanInputRef.current?.click()}
                  className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-full">
                  Try again
                </button>
              </div>
            ) : scanAdded ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
                <p className="text-gray-900 font-semibold">Added to cart</p>
                <p className="text-gray-500 text-sm mt-1">{scanQty} × {scanChosen?.partName}</p>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => { setScanOpen(false); setShowCart(true); }}
                    className="flex-1 bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] font-bold py-3 rounded-full">View cart</button>
                  <button onClick={() => setScanOpen(false)}
                    className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-full hover:bg-gray-50">Done</button>
                </div>
              </div>
            ) : scanChosen ? (
              <>
                <button onClick={() => setScanChosen(null)}
                  className="text-gray-400 hover:text-gray-700 text-xs mb-3 flex items-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <div className="flex items-center gap-3 mb-5">
                  <PartImage url={scanChosen.imageUrl} className="w-16 h-16" />
                  <div className="min-w-0">
                    <p className="text-gray-900 font-semibold text-sm leading-snug">{scanChosen.partName}</p>
                    {scanChosen.price && <p className="text-gray-900 font-bold mt-0.5">{scanChosen.price}</p>}
                    <p className="text-gray-400 text-xs mt-0.5">{scanChosen.tab} · {scanChosen.category}</p>
                  </div>
                </div>
                <label className="text-xs text-gray-500 mb-1.5 block">Quantity</label>
                <div className="flex items-center gap-3 mb-5">
                  <button onClick={() => setScanQty(q => Math.max(1, q - 1))}
                    className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"><Minus className="w-4 h-4" /></button>
                  <span className="text-2xl font-bold text-gray-900 w-12 text-center">{scanQty}</span>
                  <button onClick={() => setScanQty(q => q + 1)}
                    className="w-10 h-10 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"><Plus className="w-4 h-4" /></button>
                </div>
                <button onClick={addScannedToCart}
                  className="w-full bg-[#FFD814] hover:bg-[#F7CA00] text-[#0F1111] font-bold py-3.5 rounded-full flex items-center justify-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> Add {scanQty} to cart
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <PartImage url={scanResult?.imageUrl} className="w-16 h-16" />
                  <div className="min-w-0">
                    <p className="text-gray-400 text-xs">Identified</p>
                    <p className="text-gray-900 font-semibold text-sm leading-snug">{scanResult?.partName || 'Unknown part'}</p>
                    {scanResult?.price && <p className="text-gray-900 font-bold mt-0.5">{scanResult.price}</p>}
                  </div>
                </div>

                {scanMatches.length > 0 ? (
                  <>
                    <p className="text-sm font-semibold text-gray-900 mb-2">Found in your library — confirm the match:</p>
                    <div className="space-y-2 mb-4">
                      {scanMatches.map((p, i) => (
                        <button key={i} onClick={() => { setScanChosen(p); setScanQty(1); }}
                          className="w-full flex items-center gap-3 border border-gray-200 rounded-xl p-2.5 hover:border-violet-400 hover:bg-violet-50/40 text-left transition-colors">
                          <PartImage url={p.imageUrl} className="w-12 h-12" />
                          <div className="min-w-0 flex-1">
                            <p className="text-gray-900 text-sm font-medium leading-snug line-clamp-2">{p.partName}</p>
                            <p className="text-gray-400 text-xs mt-0.5">{p.tab} · {p.category}{p.price ? ` · ${p.price}` : ''}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                    <p className="text-gray-400 text-xs text-center mb-2">Not one of these?</p>
                  </>
                ) : (
                  <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <p className="text-amber-800 text-sm font-medium">Not in your parts library yet.</p>
                    <p className="text-amber-700 text-xs mt-0.5">Grab it on Amazon, then add it to the library.</p>
                  </div>
                )}

                <a href={scanResult?.supplierLink || `https://www.amazon.com/s?k=${encodeURIComponent(scanResult?.partName || '')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-[#FF9900] hover:bg-[#e88b00] text-[#0F1111] font-bold py-3 rounded-full mb-2 transition-colors">
                  <ShoppingCart className="w-4 h-4" /> View on Amazon
                </a>
                <button onClick={addScannedToLibrary}
                  className="w-full flex items-center justify-center gap-2 border border-gray-300 text-gray-700 font-semibold py-3 rounded-full hover:bg-gray-50">
                  <Plus className="w-4 h-4" /> Add to Parts Library
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
