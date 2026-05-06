import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, FileText } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogCancel,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

export default function InsertMasterDialog({ open, onOpenChange, companyId, onSelect }) {
  const [search, setSearch] = useState('');

  const { data: masterSops = [], isLoading } = useQuery({
    queryKey: ['master-sops', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return base44.entities.SOP.filter({ company_id: companyId, type: 'Master' });
    },
    enabled: open && !!companyId
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return masterSops;
    const q = search.toLowerCase();
    return masterSops.filter(s =>
      s.title?.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.group?.toLowerCase().includes(q)
    );
  }, [masterSops, search]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>Insert From Master</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search master SOPs..."
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0 max-h-[50vh] py-2">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {masterSops.length === 0 ? 'No Master SOPs found. Set an SOP type to "Master" first.' : 'No results match your search.'}
            </p>
          ) : (
            filtered.map(sop => (
              <button
                key={sop.id}
                onClick={() => { onSelect(sop); onOpenChange(false); setSearch(''); }}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{sop.title}</p>
                    {sop.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{sop.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{sop.steps?.length || 0} steps</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setSearch('')}>Cancel</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}