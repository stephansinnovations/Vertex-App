import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Plus, Trash2, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function extractSpreadsheetId(url) {
  try {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function SubFolderPicker({ onSelect, onClose }) {
  const [spreadsheetId] = useState(() => {
    const url = localStorage.getItem('masterSheetUrl');
    return url ? extractSpreadsheetId(url) : null;
  });
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [expandedTab, setExpandedTab] = useState(null);
  const [categories, setCategories] = useState({});
  const [loadingCat, setLoadingCat] = useState(null);

  useEffect(() => {
    if (!spreadsheetId) return;
    setLoadingTabs(true);
    base44.functions.invoke('getSheetTabs', { spreadsheetId })
      .then(res => setTabs(res.data.tabs || []))
      .finally(() => setLoadingTabs(false));
  }, [spreadsheetId]);

  const handleTabClick = (tab) => {
    if (expandedTab === tab) { setExpandedTab(null); return; }
    setExpandedTab(tab);
    if (!categories[tab]) {
      setLoadingCat(tab);
      base44.functions.invoke('getSheetCategories', { spreadsheetId, sheetName: tab })
        .then(res => setCategories(prev => ({ ...prev, [tab]: res.data.categories || [] })))
        .finally(() => setLoadingCat(null));
    }
  };

  if (!spreadsheetId) {
    return (
      <div className="py-6 text-center text-gray-500 text-sm">
        No Master Sheet linked. Go to Parts Library to set one up.
      </div>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-700 mt-1">
      {loadingTabs && <div className="px-4 py-3 text-gray-500 text-sm">Loading sheets...</div>}
      {tabs.map(tab => (
        <div key={tab} className="border-b border-zinc-800 last:border-b-0">
          <button
            onClick={() => handleTabClick(tab)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-gray-400" />
              <span className="text-white text-sm font-medium">{tab}</span>
            </div>
            {expandedTab === tab ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
          </button>
          {expandedTab === tab && (
            <div className="bg-black">
              {loadingCat === tab && <div className="px-8 py-2 text-gray-500 text-xs">Loading...</div>}
              {(categories[tab] || []).map(cat => (
                <button
                  key={cat.name}
                  onClick={() => onSelect(cat.name)}
                  className="w-full flex items-center gap-2 px-8 py-2.5 hover:bg-zinc-900 transition-colors text-left"
                >
                  <Folder className="w-3 h-3 text-gray-600" />
                  <span className="text-gray-300 text-sm">{cat.name}</span>
                </button>
              ))}
              {!loadingCat && (categories[tab] || []).length === 0 && categories[tab] && (
                <div className="px-8 py-2 text-gray-600 text-xs">No categories found</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function StockLocation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = searchParams.get('location') || '';
  const queryClient = useQueryClient();

  const [addFolderOpen, setAddFolderOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['stockItems', location],
    queryFn: () => base44.entities.StockItem.filter({ location }),
    enabled: !!location,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.StockItem.create({ ...data, location }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockItems', location] });
      setAddFolderOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.StockItem.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stockItems', location] }),
  });

  const handleSelectSubFolder = (categoryName) => {
    createMutation.mutate({ name: categoryName, notes: 'subfolder' });
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/Stock')} className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-4xl font-bold text-white tracking-tight">{location}</h1>
          </div>
          <button
            onClick={() => setAddFolderOpen(true)}
            className="flex items-center gap-2 bg-white text-black font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Sub-folder
          </button>
        </div>

        <div className="rounded-2xl overflow-hidden border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {isLoading && <div className="px-6 py-5 text-gray-500 text-sm">Loading...</div>}
          {!isLoading && items.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 text-lg mb-1">No items yet</p>
              <p className="text-gray-600 text-sm">Add sub-folders from the parts library</p>
            </div>
          )}
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`flex items-center justify-between px-6 py-4 ${index !== items.length - 1 ? 'border-b border-zinc-800' : ''}`}
            >
              <div className="flex items-center gap-3">
                <Folder className="w-4 h-4 text-gray-400" />
                <div>
                  <p className="text-white font-medium">{item.name}</p>
                  {item.quantity != null && (
                    <p className="text-gray-500 text-sm mt-0.5">
                      {item.quantity}{item.unit ? ' ' + item.unit : ''}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteMutation.mutate(item.id)}
                className="text-gray-600 hover:text-red-400 transition-colors ml-4"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <AlertDialog open={addFolderOpen} onOpenChange={setAddFolderOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800 max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Add Sub-folder from Parts Library</AlertDialogTitle>
          </AlertDialogHeader>
          <SubFolderPicker onSelect={handleSelectSubFolder} onClose={() => setAddFolderOpen(false)} />
          <AlertDialogFooter className="mt-3">
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}