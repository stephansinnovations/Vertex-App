import React, { useState, useEffect, useRef } from 'react';
import { X, Search, ArrowLeft, Plus, Folder, ExternalLink } from 'lucide-react';
import { getSheetTabs, getSheetCategories } from '@/api/googleSheets';

function extractSpreadsheetId(url) {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function PartRow({ part, onAdd, onDecrement, materials, showCategory }) {
  const qty = materials?.find(m => m.from_library && m.name === part.partName)?.qty || 0;

  const handleAdd = () => {
    onAdd({
      name: part.partName || '',
      partNum: part.partNum || '',
      supplier: part.supplier || '',
      supplierLink: part.supplierLink || '',
      price: part.price || '',
      from_library: true,
    });
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 last:border-b-0">
      <div className="flex-1 min-w-0 mr-3">
        <p className="text-white text-sm font-medium">{part.partName}</p>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          {showCategory && part._category && (
            <span className="text-zinc-500 text-xs">{part._category}</span>
          )}
          {part.partNum && <span className="text-gray-500 font-mono text-xs">{part.partNum}</span>}
          {part.supplier && <span className="text-gray-500 text-xs">{part.supplier}</span>}
          {part.price && <span className="text-gray-500 text-xs">{part.price}</span>}
        </div>
      </div>
      {qty > 0 ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onDecrement(part.partName)}
            className="w-7 h-7 rounded-full bg-zinc-700 hover:bg-zinc-600 active:scale-90 text-white flex items-center justify-center text-base leading-none transition-all">
            −
          </button>
          <span className="text-white text-sm font-semibold w-6 text-center">{qty}</span>
          <button onClick={handleAdd}
            className="w-7 h-7 rounded-full bg-zinc-700 hover:bg-zinc-600 active:scale-90 text-white flex items-center justify-center transition-all">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button onClick={handleAdd}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 active:scale-90 flex items-center justify-center transition-all">
          <Plus className="w-4 h-4 text-white" />
        </button>
      )}
    </div>
  );
}

export default function PartsBrowserSheet({ materials, onAdd, onDecrement, onClose }) {
  const [spreadsheetId, setSpreadsheetId] = useState(null);
  const [masterSheetUrl, setMasterSheetUrl] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(true);

  const [view, setView] = useState('tabs'); // 'tabs' | 'categories' | 'parts'
  const [selectedTab, setSelectedTab] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);

  const [query, setQuery] = useState('');
  const categoryCache = useRef({});

  useEffect(() => {
    const url = localStorage.getItem('masterSheetUrl');
    setMasterSheetUrl(url);
    const id = extractSpreadsheetId(url);
    if (!id) { setLoadingTabs(false); return; }
    setSpreadsheetId(id);
    getSheetTabs(id)
      .then(res => setTabs(res.data.tabs || []))
      .catch(() => {})
      .finally(() => setLoadingTabs(false));
  }, []);

  const selectTab = async (tab) => {
    setSelectedTab(tab);
    setView('categories');
    setSelectedCategory(null);
    setQuery('');
    if (categoryCache.current[tab]) {
      setCategories(categoryCache.current[tab]);
      return;
    }
    setLoadingCategories(true);
    try {
      const res = await getSheetCategories(spreadsheetId, tab);
      const cats = res.data.categories || [];
      categoryCache.current[tab] = cats;
      setCategories(cats);
    } catch {
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  };

  const selectCategory = (category) => {
    setSelectedCategory(category);
    setView('parts');
    setQuery('');
  };

  const goBack = () => {
    if (view === 'parts') {
      setView('categories');
      setSelectedCategory(null);
    } else if (view === 'categories') {
      setView('tabs');
      setSelectedTab(null);
      setCategories([]);
    }
  };

  // Flat list of all parts across all loaded categories (for search)
  const allLoadedParts = Object.values(categoryCache.current)
    .flat()
    .flatMap(cat => (cat.parts || []).map(p => ({ ...p, _category: cat.name })));

  const isSearching = query.trim().length > 0;
  const searchResults = isSearching
    ? allLoadedParts.filter(p => p.partName?.toLowerCase().includes(query.toLowerCase()))
    : [];

  const currentParts = selectedCategory?.parts || [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-zinc-900 rounded-t-2xl border-t border-zinc-700 flex flex-col" style={{ maxHeight: '88vh' }}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-zinc-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            {view !== 'tabs' && (
              <button onClick={goBack} className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-white font-semibold text-base">
              {view === 'tabs' && 'Parts Library'}
              {view === 'categories' && selectedTab}
              {view === 'parts' && selectedCategory?.name}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-zinc-800 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search parts..."
              className="w-full bg-black border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          {isSearching && allLoadedParts.length === 0 && (
            <p className="text-xs text-gray-600 mt-1.5">Browse a category first to enable search</p>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isSearching ? (
            searchResults.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-gray-500 text-sm mb-1">No parts found for "{query}"</p>
                <p className="text-gray-600 text-xs mb-4">Try browsing a category first or add a new part</p>
              </div>
            ) : (
              searchResults.map((part, i) => (
                <PartRow key={i} part={part} onAdd={onAdd} onDecrement={onDecrement} materials={materials} showCategory />
              ))
            )
          ) : view === 'tabs' ? (
            loadingTabs ? (
              <div className="px-4 py-10 text-center">
                <div className="animate-spin w-5 h-5 border-2 border-white/20 border-t-white rounded-full mx-auto" />
              </div>
            ) : tabs.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-gray-500 text-sm">No parts library connected</p>
                <p className="text-gray-600 text-xs mt-1">Link a Master Sheet in your profile settings</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4">
                {tabs.map(tab => (
                  <button key={tab} onClick={() => selectTab(tab)}
                    className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-left hover:bg-zinc-700 active:scale-95 transition-all">
                    <Folder className="w-6 h-6 text-gray-400 mb-2" />
                    <p className="text-white text-sm font-medium leading-snug">{tab}</p>
                  </button>
                ))}
              </div>
            )
          ) : view === 'categories' ? (
            loadingCategories ? (
              <div className="px-4 py-10 text-center">
                <div className="animate-spin w-5 h-5 border-2 border-white/20 border-t-white rounded-full mx-auto" />
              </div>
            ) : categories.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-gray-500 text-sm">No categories found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4">
                {categories.map((cat, i) => (
                  <button key={i} onClick={() => selectCategory(cat)}
                    className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-left hover:bg-zinc-700 active:scale-95 transition-all">
                    <Folder className="w-6 h-6 text-gray-400 mb-2" />
                    <p className="text-white text-sm font-medium leading-snug">{cat.name}</p>
                    <p className="text-gray-500 text-xs mt-1">{cat.parts?.length || 0} parts</p>
                  </button>
                ))}
              </div>
            )
          ) : (
            currentParts.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-gray-500 text-sm">No parts in this category</p>
              </div>
            ) : (
              currentParts.map((part, i) => (
                <PartRow key={i} part={part} onAdd={onAdd} onDecrement={onDecrement} materials={materials} />
              ))
            )
          )}
        </div>

        {/* Footer */}
        {masterSheetUrl && (
          <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
            <button
              onClick={() => window.open(masterSheetUrl, '_blank')}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 border border-zinc-700 text-white text-sm py-3 rounded-xl hover:bg-zinc-700 active:bg-zinc-600 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Add New Part to Master Sheet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
