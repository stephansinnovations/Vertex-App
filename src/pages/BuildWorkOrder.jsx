import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate, Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Plus, Trash2, Search, X, Settings, Check, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export default function BuildWorkOrder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const buildId = urlParams.get('id');
  const buildName = urlParams.get('name') || 'Build';

  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [progress, setProgress] = useState({});

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

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const { data: build } = useQuery({
    queryKey: ['build', buildId],
    queryFn: async () => {
      const results = await base44.entities.Build.filter({ id: buildId });
      return results[0];
    },
    enabled: !!buildId
  });

  // All SOPs in the company library
  const { data: allSops = [] } = useQuery({
    queryKey: ['all-sops', user?.company_id],
    queryFn: () => base44.entities.SOP.filter({ company_id: user.company_id }),
    enabled: !!user?.company_id
  });

  // SOPs linked to this build (stored as sop_ids array on the build)
  const linkedSopIds = build?.sop_ids || [];
  const linkedSops = allSops.filter(s => linkedSopIds.includes(s.id));
  // Only show original SOPs from the library (not copied ones)
  const availableSops = allSops.filter(s => !linkedSopIds.includes(s.id) && !s.original_sop_id);

  const filteredAvailable = availableSops.filter(s =>
    s.title?.toLowerCase().includes(search.toLowerCase()) ||
    s.group?.toLowerCase().includes(search.toLowerCase())
  );

  const addSopMutation = useMutation({
    mutationFn: async (sopToAdd) => {
      // Create a copy of the SOP without assigning it to a department folder
      const copiedSop = await base44.entities.SOP.create({
        title: sopToAdd.title,
        description: sopToAdd.description,
        group: buildName,
        type: sopToAdd.type,
        department: sopToAdd.department,
        company_id: sopToAdd.company_id,
        original_sop_id: sopToAdd.id,
        materials: sopToAdd.materials,
        steps: sopToAdd.steps
      });
      // Link the copied SOP to the build
      return base44.entities.Build.update(buildId, { sop_ids: [...linkedSopIds, copiedSop.id] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['build', buildId] });
      queryClient.invalidateQueries({ queryKey: ['all-sops'] });
      toast.success('SOP copied and added to work order');
    }
  });

  const removeSopMutation = useMutation({
    mutationFn: (sopId) =>
      base44.entities.Build.update(buildId, { sop_ids: linkedSopIds.filter(id => id !== sopId) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['build', buildId] });
      toast.success('SOP removed');
    }
  });

  const reorderMutation = useMutation({
    mutationFn: (newOrder) =>
      base44.entities.Build.update(buildId, { sop_ids: newOrder }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['build', buildId] });
      toast.success('Order updated');
    }
  });

  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    if (!destination || (source.index === destination.index)) return;

    const newOrder = [...linkedSopIds];
    newOrder.splice(source.index, 1);
    newOrder.splice(destination.index, 0, draggableId);
    reorderMutation.mutate(newOrder);
  };

  return (
    <div className="min-h-screen bg-black p-6 relative">
      {/* Settings button — bottom left */}
      <button
        onClick={() => setEditMode(!editMode)}
        className={`fixed bottom-5 left-5 z-50 p-2.5 rounded-full backdrop-blur-sm transition-all duration-200 ${editMode ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800/80 text-gray-400 hover:text-white hover:bg-zinc-700/80'}`}
      >
        {editMode ? <Check className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
      </button>

      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => navigate(`/BuildDetail?id=${buildId}&name=${encodeURIComponent(buildName)}`)}
            className="text-gray-400 hover:text-white transition-colors mb-4 flex items-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-white tracking-tight">Work Order</h1>
              <p className="text-gray-400 mt-1">{buildName} · {linkedSops.length} SOP{linkedSops.length !== 1 ? 's' : ''}</p>
            </div>
            <Button
              onClick={() => setShowPicker(true)}
              className="bg-white text-black hover:bg-gray-200 font-semibold w-fit max-w-xs"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add SOP
            </Button>
          </div>
        </div>

        {/* Linked SOPs */}
         {linkedSops.length === 0 ? (
           <Card className="bg-zinc-900 border-zinc-800">
             <CardContent className="py-16 text-center">
               <p className="text-gray-400 mb-4">No SOPs added to this work order yet</p>
               <Button onClick={() => setShowPicker(true)} className="bg-white text-black hover:bg-gray-200 font-semibold">
                 <Plus className="w-4 h-4 mr-2" />
                 Add SOP
               </Button>
             </CardContent>
           </Card>
         ) : (
           <DragDropContext onDragEnd={handleDragEnd}>
             <Droppable droppableId="sops">
               {(provided) => (
                 <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                   {linkedSops.map((sop, index) => (
                     <Draggable key={sop.id} draggableId={sop.id} index={index} isDragDisabled={!editMode}>
                       {(provided, snapshot) => (
                         <div
                           ref={provided.innerRef}
                           {...provided.draggableProps}
                           className={`relative group ${snapshot.isDragging ? 'opacity-50' : ''}`}
                         >
                           <div className="flex items-stretch gap-2">
                             {editMode && (
                               <div {...provided.dragHandleProps} className="flex items-center">
                                 <GripVertical className="w-5 h-5 text-gray-500" />
                               </div>
                             )}
                             <Link to={createPageUrl('SOPView') + '?id=' + sop.id + '&returnTo=' + encodeURIComponent(`/BuildWorkOrder?id=${buildId}&name=${buildName}`)} className="flex-1">
                               <Card className="bg-zinc-900 border-zinc-800 hover:border-white transition-all duration-300 cursor-pointer h-full">
                                 <CardContent className="p-4">
                                   <div className="flex items-center gap-2 mb-1">
                                     <h3 className="text-base font-semibold text-white">{sop.title}</h3>
                                     {sop.group && (
                                       <span className="text-xs bg-zinc-700 text-gray-300 px-2 py-0.5 rounded">{sop.group}</span>
                                     )}
                                   </div>
                                   <p className="text-sm text-gray-400 line-clamp-2">{sop.description || 'No description'}</p>
                                   {sop.steps && sop.steps.length > 0 && (
                                     <div className="mt-3 flex items-center gap-2">
                                       <div className="flex-1">
                                         <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden border border-zinc-700">
                                           <div
                                             className="bg-green-500 h-full transition-all duration-300"
                                             style={{ width: `${getSOPProgress(sop)}%` }}
                                           />
                                         </div>
                                       </div>
                                       <span className="text-xs font-semibold text-gray-400 whitespace-nowrap">{getSOPProgress(sop)}%</span>
                                     </div>
                                   )}
                                 </CardContent>
                               </Card>
                             </Link>
                             {editMode && (
                               <Button
                                 variant="ghost"
                                 size="icon"
                                 className="h-8 w-8 text-red-500 hover:bg-red-500/10 flex-shrink-0"
                                 onClick={() => removeSopMutation.mutate(sop.id)}
                                 disabled={removeSopMutation.isPending}
                               >
                                 <Trash2 className="w-4 h-4" />
                               </Button>
                             )}
                           </div>
                         </div>
                       )}
                     </Draggable>
                   ))}
                   {provided.placeholder}
                 </div>
               )}
             </Droppable>
           </DragDropContext>
         )}
      </div>

      {/* SOP Picker Overlay */}
      {showPicker && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold text-white">Add SOP from Library</h2>
              <button onClick={() => { setShowPicker(false); setSearch(''); }} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-zinc-800">
              <div className="flex items-center gap-2 bg-black border border-zinc-700 rounded-lg px-3 py-2">
                <Search className="w-4 h-4 text-gray-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search SOPs..."
                  className="flex-1 bg-transparent text-white placeholder:text-gray-600 text-sm focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredAvailable.length === 0 ? (
                <p className="text-gray-500 text-center py-8 text-sm">
                  {search ? 'No matching SOPs found' : 'All SOPs are already added'}
                </p>
              ) : (
                filteredAvailable.map(sop => (
                  <button
                    key={sop.id}
                    onClick={() => {
                      addSopMutation.mutate(sop);
                      setShowPicker(false);
                      setSearch('');
                    }}
                    className="w-full text-left p-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-white">{sop.title}</span>
                      {sop.group && (
                        <span className="text-xs bg-zinc-600 text-gray-300 px-2 py-0.5 rounded">{sop.group}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-1">{sop.description || 'No description'}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}