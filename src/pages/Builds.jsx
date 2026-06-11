import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Plus, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function Builds() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVanModel, setNewVanModel] = useState('');
  const [newSheetUrl, setNewSheetUrl] = useState('');

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: builds = [], isLoading } = useQuery({
    queryKey: ['builds', user?.company_id],
    queryFn: () => base44.entities.Build.filter({ company_id: user.company_id }, '-created_date'),
    enabled: !!user?.company_id,
  });

  const { data: allSops = [] } = useQuery({
    queryKey: ['all-sops', user?.company_id],
    queryFn: () => base44.entities.SOP.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id,
  });

  const getSOPProgress = (sop) => {
    try {
      const saved = localStorage.getItem(`sopProgress_${sop.id}`);
      const completedSteps = saved ? JSON.parse(saved) : {};
      const totalSteps = sop.steps?.length || 0;
      if (totalSteps === 0) return 0;
      const completedCount = Object.values(completedSteps).filter(Boolean).length;
      return Math.round((completedCount / totalSteps) * 100);
    } catch {
      return 0;
    }
  };

  const getBuildProgress = (build) => {
    if (!build.sop_ids || build.sop_ids.length === 0) return 0;
    const sopList = build.sop_ids.map(id => allSops.find(s => s.id === id)).filter(Boolean);
    if (sopList.length === 0) return 0;
    const totalProgress = sopList.reduce((sum, sop) => sum + getSOPProgress(sop), 0);
    return Math.round(totalProgress / sopList.length);
  };

  const createMutation = useMutation({
    mutationFn: ({ name, van_model, build_sheet_url }) => base44.entities.Build.create({ name, van_model, build_sheet_url, company_id: user.company_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builds'] });
      setDialogOpen(false);
      setNewName('');
      setNewVanModel('');
      setNewSheetUrl('');
    },
  });

  const handleCreate = () => {
    if (!newName.trim() || !newSheetUrl.trim()) return;
    createMutation.mutate({ name: newName.trim(), van_model: newVanModel, build_sheet_url: newSheetUrl.trim() });
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-4xl font-bold text-white tracking-tight">Vertex Builds</h1>
          </div>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 bg-white text-black font-semibold px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            New Build
          </button>
        </div>

        {/* Builds List */}
        <div className="rounded-2xl overflow-hidden border border-zinc-800" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          {isLoading && (
            <div className="px-6 py-5 text-gray-500 text-sm">Loading builds...</div>
          )}

          {!isLoading && builds.length === 0 && (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500 text-lg mb-2">No builds yet</p>
              <p className="text-gray-600 text-sm mb-6">Create your first build to get started</p>
              <button
                onClick={() => setDialogOpen(true)}
                className="bg-white text-black font-semibold px-5 py-2.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Create Build
              </button>
            </div>
          )}

          {builds.map((build, index) => (
            <motion.div
              key={build.id}
              onClick={() => navigate(`/BuildDetail?id=${build.id}&name=${encodeURIComponent(build.name)}`)}
              className={`flex items-center justify-between px-6 py-5 hover:bg-zinc-800 transition-colors cursor-pointer ${index !== builds.length - 1 ? 'border-b border-zinc-800' : ''}`}
              whileTap={{ scale: 0.97, opacity: 0.5 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="flex-1">
                <p className="text-white text-lg font-medium">{build.name}</p>
                {build.van_model && (
                  <span className="inline-block text-xs text-gray-400 bg-zinc-800 border border-zinc-700 px-2 py-0.5 rounded-full mt-1">{build.van_model}</span>
                )}
                {build.status && (
                  <p className="text-gray-500 text-sm mt-0.5">{build.status}</p>
                )}
                {build.sop_ids && build.sop_ids.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1">
                      <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden border border-zinc-700">
                        <div
                          className="bg-green-500 h-full transition-all duration-300"
                          style={{ width: `${getBuildProgress(build)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-gray-400 whitespace-nowrap">{getBuildProgress(build)}%</span>
                  </div>
                )}
              </div>
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </motion.div>
          ))}
        </div>
      </div>

      {/* New Build Dialog */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">New Build</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="Build name (e.g. Sprinter #12 — John)"
              className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
              autoFocus
            />
            <select
              value={newVanModel}
              onChange={(e) => setNewVanModel(e.target.value)}
              className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500 text-white"
            >
              <option value="">Van model (optional)</option>
              <option value="Sprinter 144">Sprinter 144</option>
              <option value="Sprinter 148">Sprinter 148</option>
              <option value="Sprinter 170">Sprinter 170</option>
              <option value="Transit 148">Transit 148</option>
              <option value="Transit 148 HR">Transit 148 HR</option>
              <option value="Promaster 136">Promaster 136</option>
              <option value="Promaster 159">Promaster 159</option>
              <option value="Other">Other</option>
            </select>
            <input
              type="text"
              value={newSheetUrl}
              onChange={(e) => setNewSheetUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="Build sheet — Google Sheet URL (required)"
              className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setNewName(''); setNewSheetUrl(''); }} className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCreate}
              disabled={createMutation.isPending || !newName.trim() || !newSheetUrl.trim()}
              className="bg-white text-black hover:bg-gray-200"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}