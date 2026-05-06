import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Trash2, Folder, ChevronRight, Settings, ArrowLeft, Check, Edit2 } from 'lucide-react';
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
import LongPressRow from '@/components/LongPressRow';

export default function SOPList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const userCompanyId = user?.company_id;

  // Auto-assign new users to Vertex Vans if they don't have a company
  useEffect(() => {
    if (user && !user.company_id) {
      base44.auth.updateMe({ company_id: '699bc3c65ff184d7ed8449e5' }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['user'] });
      });
    }
  }, [user]);

  const { data: folders = [], isLoading } = useQuery({
    queryKey: ['folders', userCompanyId],
    queryFn: () => base44.entities.WorkOrder.filter({ company_id: userCompanyId }, 'name'),
    enabled: !!userCompanyId
  });

  const { data: sops = [] } = useQuery({
    queryKey: ['sops', userCompanyId],
    queryFn: () => base44.entities.SOP.filter({ company_id: userCompanyId }),
    enabled: !!userCompanyId
  });

  const [deleteModeActive, setDeleteModeActive] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const createFolderMutation = useMutation({
    mutationFn: (name) => base44.entities.WorkOrder.create({ name, company_id: userCompanyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Folder created');
      setNewFolderDialogOpen(false);
      setNewFolderName('');
    }
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id) => base44.entities.WorkOrder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Folder deleted');
    }
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }) => base44.entities.WorkOrder.update(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setEditingId(null);
      setEditingName('');
    }
  });

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolderMutation.mutate(newFolderName.trim());
  };

  const handleDeleteFolder = (folder) => {
    const sopCount = sops.filter(s => s.group === folder.name).length;
    if (sopCount > 0) {
      toast.error('Cannot delete a folder that contains SOPs');
      return;
    }
    deleteFolderMutation.mutate(folder.id);
  };

  const commitRename = (folder) => {
    if (!editingName.trim() || editingName === folder.name) {
      setEditingId(null);
      setEditingName('');
      return;
    }
    renameFolderMutation.mutate({ id: folder.id, name: editingName.trim() });
  };

  return (
    <div className="min-h-screen p-6">
      {/* Floating settings button — bottom left */}
      <button
        onClick={() => setDeleteModeActive(v => !v)}
        className={`fixed bottom-5 left-5 z-50 p-2.5 rounded-full backdrop-blur-sm transition-all duration-200 ${deleteModeActive ? 'bg-yellow-400/20 text-yellow-400' : 'bg-zinc-800/80 text-gray-400 hover:text-white hover:bg-zinc-700/80'}`}
      >
        {deleteModeActive ? <Check className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
      </button>

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-white hover:bg-zinc-800"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-4xl font-bold text-white tracking-tight">SOP's</h1>
              <p className="text-gray-400 mt-2">Create and manage your team's SOPs by department</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => navigate(createPageUrl('SOPEditor'))}
              variant="outline"
              className="border-zinc-700 text-white bg-transparent hover:bg-zinc-800 text-sm"
            >
              <Plus className="w-4 h-4 mr-1" />
              SOP
            </Button>
            <Button
              onClick={() => setNewFolderDialogOpen(true)}
              className="bg-white text-black hover:bg-gray-200 font-semibold text-sm"
            >
              <Plus className="w-4 h-4 mr-1" />
              Department
            </Button>
          </div>
        </div>

        {/* Folders List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-zinc-900 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : folders.length === 0 ? (
          <div className="text-center py-16">
            <Folder className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-gray-500 text-lg mb-1">No folders yet</p>
            <p className="text-gray-600 text-sm mb-6">Create a folder to organize your SOPs</p>
            <Button onClick={() => setNewFolderDialogOpen(true)} className="bg-white text-black hover:bg-gray-200">
              Create Folder
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {folders.map((folder, index) => {
              const sopCount = sops.filter(s => s.group === folder.name).length;
              const isEditing = editingId === folder.id;
              return (
                <LongPressRow
                  key={folder.id}
                  label={folder.name}
                  icon="Folder"
                  path={`/WorkOrderPage?id=${folder.id}`}
                  onClick={() => !isEditing && navigate(`/WorkOrderPage?id=${folder.id}`)}
                  className="flex items-center justify-between px-6 py-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors cursor-pointer"
                  style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
                >
                  <div
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <Folder className="w-5 h-5 text-white flex-shrink-0" />
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => commitRename(folder)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename(folder);
                          if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                        }}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-black border border-zinc-700 rounded px-2 py-0.5 text-white text-lg font-semibold focus:outline-none focus:border-zinc-500"
                        autoFocus
                      />
                    ) : (
                      <span className="text-lg font-medium text-white truncate">{folder.name}</span>
                    )}
                    {!isEditing && (
                      <span className="text-sm text-gray-500 whitespace-nowrap">({sopCount} SOP{sopCount !== 1 ? 's' : ''})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {deleteModeActive && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-400 hover:text-white hover:bg-zinc-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(folder.id);
                            setEditingName(folder.name);
                          }}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:bg-zinc-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFolder(folder);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  </div>
                </LongPressRow>
                );
                })}
                </div>
                )
                }
                </div>

      {/* New Folder Dialog */}
      <AlertDialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">New Department</AlertDialogTitle>
            <AlertDialogDescription>Enter a name for the new department.</AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
            placeholder="Folder name..."
            className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 focus:outline-none focus:border-zinc-500"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNewFolderName('')} className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCreateFolder}
              disabled={createFolderMutation.isPending}
              className="bg-white text-black hover:bg-gray-200"
            >
              {createFolderMutation.isPending ? 'Creating...' : 'Create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}