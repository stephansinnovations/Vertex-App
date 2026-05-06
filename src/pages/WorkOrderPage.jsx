import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, FileText, ChevronRight, Settings, Check } from 'lucide-react';
import { format } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export default function WorkOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const workOrderId = urlParams.get('id');

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sopToDelete, setSopToDelete] = useState(null);
  const [deleteModeActive, setDeleteModeActive] = useState(false);

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const { data: workOrder, isLoading: woLoading } = useQuery({
    queryKey: ['workOrder', workOrderId],
    queryFn: async () => {
      const results = await base44.entities.WorkOrder.filter({ id: workOrderId });
      return results[0];
    },
    enabled: !!workOrderId
  });

  const { data: sops = [], isLoading: sopsLoading } = useQuery({
    queryKey: ['sops-wo', workOrderId, workOrder?.name],
    queryFn: async () => {
      if (!workOrder?.name || !user?.company_id) return [];
      const all = await base44.entities.SOP.filter({ company_id: user.company_id, group: workOrder.name });
      if (workOrder.is_test_campaign) {
        return all.sort((a, b) => (b.test_number ?? 0) - (a.test_number ?? 0));
      }
      return all.sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : new Date(a.created_date).getTime();
        const orderB = b.order !== undefined ? b.order : new Date(b.created_date).getTime();
        return orderA - orderB;
      });
    },
    enabled: !!workOrder?.name && !!user?.company_id
  });

  const deleteMutation = useMutation({
    mutationFn: (sopId) => base44.entities.SOP.delete(sopId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops-wo'] });
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      toast.success('SOP deleted');
      setDeleteDialogOpen(false);
      setSopToDelete(null);
    }
  });

  const moveSop = async (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sops.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    await Promise.all([
      base44.entities.SOP.update(sops[index].id, { order: targetIndex }),
      base44.entities.SOP.update(sops[targetIndex].id, { order: index })
    ]);
    queryClient.invalidateQueries({ queryKey: ['sops-wo'] });
  };

  const getNewSopUrl = () => {
    const base = createPageUrl('SOPEditor');
    const params = new URLSearchParams();
    params.set('group', workOrder.name);
    if (workOrder.department) params.set('department', workOrder.department);
    if (workOrder.is_test_campaign) {
      params.set('is_test_campaign', 'true');
      const nextTestNumber = Math.max(0, ...sops.map(s => s.test_number || 0)) + 1;
      params.set('test_number', String(nextTestNumber));
    }
    return `${base}?${params.toString()}`;
  };

  const isLoading = woLoading || sopsLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-center">
          <p className="mb-4">Work order not found.</p>
          <Button onClick={() => navigate(createPageUrl('SOPList'))} className="bg-white text-black hover:bg-gray-200">Back to SOPs</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-zinc-800" onClick={() => navigate(createPageUrl('SOPList'))}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-4xl font-bold text-white tracking-tight">{workOrder.name}</h1>
              <p className="text-gray-400 mt-2">{sops.length} SOP{sops.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <Button
            onClick={() => navigate(getNewSopUrl())}
            variant="outline"
            className="border-zinc-700 text-white bg-transparent hover:bg-zinc-800 text-sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            {workOrder.is_test_campaign ? 'New Test' : 'New SOP'}
          </Button>
        </div>

        {/* SOPs List */}
        {sops.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-gray-500 text-lg mb-1">No SOPs yet</p>
            <p className="text-gray-600 text-sm mb-6">Create the first SOP in this department</p>
            <Button onClick={() => navigate(getNewSopUrl())} className="bg-white text-black hover:bg-gray-200 font-semibold">
              <Plus className="w-4 h-4 mr-2" />
              {workOrder.is_test_campaign ? 'Create First Test' : 'Create First SOP'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sops.map((sop, index) => (
              <div
                key={sop.id}
                className="group flex items-center justify-between px-6 py-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors cursor-pointer"
                style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
                onClick={() => navigate(createPageUrl('SOPView') + '?id=' + sop.id + '&returnTo=' + encodeURIComponent(`/WorkOrderPage?id=${workOrder.id}`))}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-medium text-white truncate">{sop.title}</span>
                      {workOrder.is_test_campaign && sop.test_number != null && (
                        <span className="text-xs bg-zinc-700 text-gray-300 px-2 py-0.5 rounded whitespace-nowrap">#{sop.test_number}</span>
                      )}
                    </div>
                    {sop.description && (
                      <p className="text-sm text-gray-500 truncate">{sop.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {deleteModeActive && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-zinc-700"
                        onClick={(e) => { e.stopPropagation(); moveSop(index, 'up'); }} disabled={index === 0}>
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white hover:bg-zinc-700"
                        onClick={(e) => { e.stopPropagation(); moveSop(index, 'down'); }} disabled={index === sops.length - 1}>
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-zinc-700"
                        onClick={(e) => { e.stopPropagation(); setSopToDelete(sop); setDeleteDialogOpen(true); }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  <ChevronRight className="w-5 h-5 text-gray-500" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom delete mode toggle */}
      <button
        onClick={() => setDeleteModeActive(v => !v)}
        className={`fixed bottom-5 left-5 z-50 p-2.5 rounded-full backdrop-blur-sm transition-all duration-200 ${deleteModeActive ? 'bg-yellow-400/20 text-yellow-400' : 'bg-zinc-800/80 text-gray-400 hover:text-white hover:bg-zinc-700/80'}`}
      >
        {deleteModeActive ? <Check className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
      </button>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{sopToDelete?.title}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate(sopToDelete.id)} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}