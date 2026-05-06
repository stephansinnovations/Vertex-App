import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, CheckCircle, Calendar, User, Clock, Image as ImageIcon, X, RotateCcw, Download } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function SOPPerform() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const sopId = urlParams.get('id');
  const performanceId = urlParams.get('performanceId');

  const [completedSteps, setCompletedSteps] = useState({});
  const [stepNotes, setStepNotes] = useState({});
  const [stepImages, setStepImages] = useState({});
  const [uploadingImages, setUploadingImages] = useState({});
  const [enlargedImage, setEnlargedImage] = useState(null);

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const { data: sop, isLoading: sopLoading } = useQuery({
    queryKey: ['sop', sopId],
    queryFn: async () => {
      const sops = await base44.entities.SOP.filter({ id: sopId });
      const foundSop = sops[0];
      if (foundSop && user?.company_id && foundSop.company_id !== user.company_id) {
        return null;
      }
      return foundSop;
    },
    enabled: !!sopId && !!user
  });

  const { data: performance, isLoading: performanceLoading } = useQuery({
    queryKey: ['performance', performanceId],
    queryFn: async () => {
      if (!performanceId) return null;
      const performances = await base44.entities.SOPPerformance.filter({ id: performanceId });
      return performances[0];
    },
    enabled: !!performanceId
  });

  const createPerformanceMutation = useMutation({
    mutationFn: async () => {
      return base44.entities.SOPPerformance.create({
        sop_id: sopId,
        sop_title: sop.title,
        started_at: new Date().toISOString(),
        completed_steps: []
      });
    },
    onSuccess: (data) => {
      const newUrl = `${window.location.pathname}?id=${sopId}&performanceId=${data.id}`;
      window.history.replaceState(null, '', newUrl);
      queryClient.invalidateQueries({ queryKey: ['performance', data.id] });
    }
  });

  const updatePerformanceMutation = useMutation({
    mutationFn: async ({ completedSteps, notes, images }) => {
      const allStepsComplete = sop.steps.every(step => {
        const stepComplete = completedSteps[`${step.step_number}`];
        if (!step.substeps || step.substeps.length === 0) return stepComplete;
        return step.substeps.every(sub => completedSteps[`${step.step_number}-${sub.substep_number}`]);
      });

      // Collect all keys from completed steps, notes, and images
      const allKeys = new Set([
        ...Object.keys(completedSteps),
        ...Object.keys(notes),
        ...Object.keys(images)
      ]);

      return base44.entities.SOPPerformance.update(performanceId, {
        completed_steps: Array.from(allKeys).map(key => {
          const [stepNum, substepNum] = key.split('-');
          return {
            step_number: parseInt(stepNum),
            substep_number: substepNum ? parseInt(substepNum) : null,
            completed_at: completedSteps[key] || null,
            notes: notes[key] || '',
            image_urls: images[key] || []
          };
        }),
        finished_at: allStepsComplete ? new Date().toISOString() : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance', performanceId] });
    }
  });

  useEffect(() => {
    if (sop && !performanceId && !createPerformanceMutation.isPending) {
      createPerformanceMutation.mutate();
    }
  }, [sop, performanceId]);

  useEffect(() => {
    if (performance && performance.completed_steps) {
      const steps = {};
      const notes = {};
      const images = {};
      performance.completed_steps.forEach(step => {
        const key = step.substep_number 
          ? `${step.step_number}-${step.substep_number}` 
          : `${step.step_number}`;
        if (step.completed_at) {
          steps[key] = step.completed_at;
        }
        if (step.notes) {
          notes[key] = step.notes;
        }
        if (step.image_urls && step.image_urls.length > 0) {
          images[key] = step.image_urls;
        }
      });
      setCompletedSteps(steps);
      setStepNotes(notes);
      setStepImages(images);
    }
  }, [performance]);

  const handleCompleteStep = (stepNumber, substepNumber = null) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    const newCompletedSteps = {
      ...completedSteps,
      [key]: new Date().toISOString()
    };
    setCompletedSteps(newCompletedSteps);
    
    if (performanceId) {
      updatePerformanceMutation.mutate({ 
        completedSteps: newCompletedSteps,
        notes: stepNotes,
        images: stepImages
      });
    }
    toast.success('Step signed off');
  };

  const handleReopenStep = (stepNumber, substepNumber = null, step = null) => {
    const newCompletedSteps = { ...completedSteps };
    
    if (substepNumber) {
      // Reopening a single substep
      const key = `${stepNumber}-${substepNumber}`;
      delete newCompletedSteps[key];
    } else {
      // Reopening a step - also reopen all its substeps if any
      const stepKey = `${stepNumber}`;
      delete newCompletedSteps[stepKey];
      
      // If step has substeps, reopen them all
      if (step && step.substeps && step.substeps.length > 0) {
        step.substeps.forEach(substep => {
          const substepKey = `${stepNumber}-${substep.substep_number}`;
          delete newCompletedSteps[substepKey];
        });
      }
    }
    
    setCompletedSteps(newCompletedSteps);
    
    if (performanceId) {
      updatePerformanceMutation.mutate({ 
        completedSteps: newCompletedSteps,
        notes: stepNotes,
        images: stepImages
      });
    }
    toast.success('Step reopened for editing');
  };

  const isStepCompleted = (stepNumber, substepNumber = null) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    return !!completedSteps[key];
  };

  const getCompletionTime = (stepNumber, substepNumber = null) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    return completedSteps[key];
  };

  const getNotes = (stepNumber, substepNumber = null) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    return stepNotes[key] || '';
  };

  const updateNotes = (stepNumber, substepNumber = null, notes) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    setStepNotes(prev => ({ ...prev, [key]: notes }));
  };

  const getImages = (stepNumber, substepNumber = null) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    return stepImages[key] || [];
  };

  const handleImageUpload = async (stepNumber, substepNumber = null, e) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    const files = Array.from(e.target.files);
    const currentImages = getImages(stepNumber, substepNumber);

    if (currentImages.length + files.length > 3) {
      toast.error('Maximum 3 images allowed');
      return;
    }

    setUploadingImages(prev => ({ ...prev, [key]: true }));

    try {
      const uploadPromises = files.map(file => 
        base44.integrations.Core.UploadFile({ file })
      );
      const results = await Promise.all(uploadPromises);
      const newImageUrls = results.map(r => r.file_url);

      setStepImages(prev => ({
        ...prev,
        [key]: [...(prev[key] || []), ...newImageUrls]
      }));
      toast.success('Images uploaded');
    } catch (error) {
      toast.error('Failed to upload images');
    } finally {
      setUploadingImages(prev => ({ ...prev, [key]: false }));
    }
  };

  const removeImage = (stepNumber, substepNumber = null, imageIndex) => {
    const key = substepNumber ? `${stepNumber}-${substepNumber}` : `${stepNumber}`;
    setStepImages(prev => ({
      ...prev,
      [key]: (prev[key] || []).filter((_, idx) => idx !== imageIndex)
    }));
  };

  const areAllSubstepsCompleted = (step) => {
    if (!step.substeps || step.substeps.length === 0) return false;
    return step.substeps.every(substep => 
      isStepCompleted(step.step_number, substep.substep_number)
    );
  };

  if (sopLoading || performanceLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!sop) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Card className="max-w-md bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2 text-white">SOP Not Found</h2>
            <p className="text-gray-400 mb-4">The SOP you're looking for doesn't exist.</p>
            <Link to={createPageUrl('SOPList')}>
              <Button className="bg-white text-black hover:bg-gray-200 font-semibold">Back to SOPs</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to={createPageUrl('SOPView') + '?id=' + sopId}>
                <Button variant="ghost" size="icon" className="text-white hover:bg-zinc-800">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-white">Performing: {sop.title}</h1>
                {performance && (
                  <p className="text-xs text-gray-400">
                    Started: {format(new Date(performance.started_at), 'MMM d, yyyy h:mm a')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Title Section */}
        <div className="mb-6">
          {sop.description && (
            <p className="text-lg text-gray-400">{sop.description}</p>
          )}
          <div className="flex flex-col gap-2 mt-4 text-sm text-gray-500">
            <div className="flex gap-6">
              <div className="flex items-center gap-1">
                <span>Last updated: {format(new Date(sop.updated_date), 'MMM d, yyyy')}</span>
              </div>
              <div className="flex items-center gap-1">
                <span>Created by: {sop.created_by}</span>
              </div>
            </div>
            {sop.group && (
              <div className="text-xs bg-zinc-800 text-white px-3 py-1.5 rounded-sm w-fit">
                Work Order: {sop.group}
              </div>
            )}
          </div>
        </div>

        {/* Materials List */}
        {sop.materials && sop.materials.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white mb-3">Materials Required</h2>
            <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3">
              <div className="space-y-3">
                {sop.materials.map((material, index) => (
                  <div key={index} className="flex items-center gap-3 pb-3 border-b border-zinc-700 last:border-b-0 last:pb-0">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                      <div>
                        <span className="text-sm font-semibold text-white">{material.name}</span>
                      </div>
                      {material.location && (
                        <div>
                          <span className="text-xs text-gray-400">
                            <span className="font-semibold">Location:</span> {material.location}
                          </span>
                        </div>
                      )}
                    </div>
                    {material.image && (
                      <div 
                        className="flex-shrink-0 cursor-pointer group"
                        onClick={() => setEnlargedImage(material.image)}
                      >
                        <img
                          src={`${material.image}?w=80`}
                          alt={material.name || 'Material'}
                          className="rounded border border-zinc-700 w-12 h-12 object-cover group-hover:opacity-80 transition-opacity"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Close Button */}
        <div className="flex justify-end mb-6">
          <Link to={createPageUrl('SOPView') + '?id=' + sopId}>
            <Button
              variant="outline"
              className="flex items-center justify-center gap-2 bg-black border-zinc-700 text-white hover:bg-zinc-800"
            >
              Close
            </Button>
          </Link>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {sop.steps && sop.steps.length > 0 ? (
            sop.steps.map((step, index) => {
              const hasSubsteps = step.substeps && step.substeps.length > 0;
              const allSubstepsCompleted = areAllSubstepsCompleted(step);
              const stepCompleted = hasSubsteps ? allSubstepsCompleted : isStepCompleted(step.step_number);
              const completionTime = getCompletionTime(step.step_number);

              return (
                <div 
                  key={index} 
                  className={`bg-zinc-900 rounded-lg border p-4 transition-all relative ${
                    stepCompleted ? 'border-green-600' : 'border-zinc-800'
                  }`}
                >
                  {stepCompleted && (
                    <button
                      onClick={() => handleReopenStep(step.step_number, null, step)}
                      className="absolute top-2 right-2 text-gray-400 hover:text-white transition-colors"
                      title="Reopen for editing"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        stepCompleted ? 'bg-green-600 text-white' : 'bg-white text-black'
                      }`}>
                        {stepCompleted ? '✓' : step.step_number}
                      </div>
                    </div>
                    <div className="flex-1">
                      {step.title && (
                        <h3 className="text-base font-semibold text-white mb-2">
                          {step.title}
                        </h3>
                      )}
                      {step.caution && (
                        <div className="mb-2 p-3 bg-zinc-800 border border-zinc-700 rounded-lg">
                          <p className="text-sm text-gray-300 font-medium whitespace-pre-wrap">
                            ⚠️ Caution: {step.caution}
                          </p>
                        </div>
                      )}
                      {step.description && (
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed mb-3">
                          {step.description}
                        </p>
                      )}
                      {step.image_urls && step.image_urls.length > 0 && (
                        <div className="mt-2 mb-3 flex flex-nowrap gap-2 overflow-x-auto">
                          {step.image_urls.map((url, imgIndex) => (
                            <img
                              key={imgIndex}
                              src={`${url}?w=400`}
                              alt={`Step ${step.step_number} - Image ${imgIndex + 1}`}
                              className="rounded-lg border border-zinc-700 max-h-56 h-auto flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => setEnlargedImage(url)}
                            />
                          ))}
                        </div>
                      )}

                      {/* Substeps */}
                      {hasSubsteps && (
                        <div className="mt-3 mb-3 pl-6 space-y-2 border-l-2 border-zinc-700">
                          {step.substeps.map((substep, subIndex) => {
                            const substepCompleted = isStepCompleted(step.step_number, substep.substep_number);
                            const substepCompletionTime = getCompletionTime(step.step_number, substep.substep_number);

                            return (
                              <div 
                                key={subIndex} 
                                className={`bg-black rounded-lg border p-3 relative ${
                                  substepCompleted ? 'border-green-600' : 'border-zinc-700'
                                }`}
                              >
                                {substepCompleted && (
                                  <button
                                    onClick={() => handleReopenStep(step.step_number, substep.substep_number)}
                                    className="absolute top-2 right-2 text-gray-400 hover:text-white transition-colors"
                                    title="Reopen for editing"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                                <div className="flex items-start gap-2">
                                  <div className="flex-shrink-0">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                      substepCompleted ? 'bg-green-600 text-white' : 'bg-zinc-700 text-white'
                                    }`}>
                                      {substepCompleted ? '✓' : `${step.step_number}.${substep.substep_number}`}
                                    </div>
                                  </div>
                                  <div className="flex-1">
                                    {substep.title && (
                                      <h4 className="text-sm font-semibold text-white mb-1">
                                        {substep.title}
                                      </h4>
                                    )}
                                    {substep.caution && (
                                      <div className="mb-1 p-2 bg-zinc-800 border border-zinc-700 rounded">
                                        <p className="text-xs text-gray-300 font-medium whitespace-pre-wrap">
                                          ⚠️ {substep.caution}
                                        </p>
                                      </div>
                                    )}
                                    {substep.description && (
                                      <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed mb-2">
                                        {substep.description}
                                      </p>
                                    )}
                                    {substep.image_urls && substep.image_urls.length > 0 && (
                                      <div className="mt-1 mb-2 flex flex-nowrap gap-2 overflow-x-auto">
                                        {substep.image_urls.map((url, imgIndex) => (
                                          <img
                                            key={imgIndex}
                                            src={`${url}?w=400`}
                                            alt={`Substep ${substep.substep_number} - Image ${imgIndex + 1}`}
                                            className="rounded-lg border border-zinc-700 max-h-40 h-auto flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                                            onClick={() => setEnlargedImage(url)}
                                          />
                                        ))}
                                      </div>
                                    )}
                                    <div className="space-y-2">
                                      {!substepCompleted ? (
                                        <>
                                          <div>
                                            <label className="text-xs text-gray-400 mb-1 block">Notes:</label>
                                            <Textarea
                                              placeholder="Add notes before signing off..."
                                              value={getNotes(step.step_number, substep.substep_number)}
                                              onChange={(e) => updateNotes(step.step_number, substep.substep_number, e.target.value)}
                                              className="bg-zinc-900 border-zinc-700 text-white resize-none text-xs"
                                              rows={2}
                                            />
                                          </div>
                                          <div>
                                            <label className="text-xs text-gray-400 mb-1 block">Pictures ({getImages(step.step_number, substep.substep_number).length}/3):</label>
                                            <div className="flex flex-wrap gap-2 mb-2">
                                              {getImages(step.step_number, substep.substep_number).map((url, idx) => (
                                                <div key={idx} className="relative">
                                                  <img src={`${url}?w=200`} alt={`Substep ${substep.substep_number} - ${idx + 1}`} className="w-16 h-16 object-cover rounded border border-zinc-700" />
                                                  <button
                                                    onClick={() => removeImage(step.step_number, substep.substep_number, idx)}
                                                    className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 hover:bg-red-700"
                                                  >
                                                    <X className="w-2 h-2" />
                                                  </button>
                                                </div>
                                              ))}
                                            </div>
                                            {getImages(step.step_number, substep.substep_number).length < 3 && (
                                              <div>
                                                <input
                                                  type="file"
                                                  accept="image/*"
                                                  multiple
                                                  onChange={(e) => handleImageUpload(step.step_number, substep.substep_number, e)}
                                                  className="hidden"
                                                  id={`upload-substep-${step.step_number}-${substep.substep_number}`}
                                                />
                                                <label htmlFor={`upload-substep-${step.step_number}-${substep.substep_number}`}>
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800 text-xs h-7"
                                                    disabled={uploadingImages[`${step.step_number}-${substep.substep_number}`]}
                                                    asChild
                                                  >
                                                    <span>
                                                      <ImageIcon className="w-3 h-3 mr-1" />
                                                      {uploadingImages[`${step.step_number}-${substep.substep_number}`] ? 'Uploading...' : 'Add Pictures'}
                                                    </span>
                                                  </Button>
                                                </label>
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex justify-end">
                                            <Button
                                              size="sm"
                                              onClick={() => handleCompleteStep(step.step_number, substep.substep_number)}
                                              className="bg-green-600 hover:bg-green-700 text-white"
                                            >
                                              Sign Off
                                            </Button>
                                          </div>
                                        </>
                                      ) : (
                                        <div className="space-y-2">
                                          {getNotes(step.step_number, substep.substep_number) && (
                                            <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-700">
                                              <p className="text-xs text-gray-400 mb-1">Notes:</p>
                                              <p className="text-xs text-white whitespace-pre-wrap">{getNotes(step.step_number, substep.substep_number)}</p>
                                            </div>
                                          )}
                                          {getImages(step.step_number, substep.substep_number).length > 0 && (
                                            <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-700">
                                              <p className="text-xs text-gray-400 mb-1">Pictures:</p>
                                              <div className="flex flex-wrap gap-1">
                                                {getImages(step.step_number, substep.substep_number).map((url, idx) => (
                                                  <img 
                                                    key={idx} 
                                                    src={`${url}?w=200`}
                                                    alt={`Substep ${substep.substep_number} - ${idx + 1}`} 
                                                    className="w-20 h-20 object-cover rounded border border-zinc-700 cursor-pointer hover:opacity-80 transition-opacity" 
                                                    onClick={() => setEnlargedImage(url)}
                                                  />
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                          <div className="flex items-center justify-end gap-1 text-xs text-green-400">
                                            Completed: {format(new Date(substepCompletionTime), 'h:mm:ss a')}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Step Complete Button (only show if no substeps) */}
                      {!hasSubsteps && (
                        <div className="space-y-3">
                          {!stepCompleted ? (
                            <>
                              <div>
                                <label className="text-sm text-gray-400 mb-2 block">Notes:</label>
                                <Textarea
                                  placeholder="Add notes before signing off..."
                                  value={getNotes(step.step_number)}
                                  onChange={(e) => updateNotes(step.step_number, null, e.target.value)}
                                  className="bg-black border-zinc-700 text-white resize-none"
                                  rows={3}
                                />
                              </div>
                              <div>
                                <label className="text-sm text-gray-400 mb-2 block">Pictures ({getImages(step.step_number).length}/3):</label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                  {getImages(step.step_number).map((url, idx) => (
                                  <div key={idx} className="relative">
                                  <img src={`${url}?w=200`} alt={`Step ${step.step_number} - ${idx + 1}`} className="w-20 h-20 object-cover rounded border border-zinc-700" />
                                  <button
                                  onClick={() => removeImage(step.step_number, null, idx)}
                                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-1 hover:bg-red-700"
                                  >
                                  <X className="w-3 h-3" />
                                  </button>
                                  </div>
                                  ))}
                                </div>
                                {getImages(step.step_number).length < 3 && (
                                  <div>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      onChange={(e) => handleImageUpload(step.step_number, null, e)}
                                      className="hidden"
                                      id={`upload-step-${step.step_number}`}
                                    />
                                    <label htmlFor={`upload-step-${step.step_number}`}>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="bg-black border-zinc-700 text-white hover:bg-zinc-800"
                                        disabled={uploadingImages[`${step.step_number}`]}
                                        asChild
                                      >
                                        <span>
                                          <ImageIcon className="w-4 h-4 mr-2" />
                                          {uploadingImages[`${step.step_number}`] ? 'Uploading...' : 'Add Pictures'}
                                        </span>
                                      </Button>
                                    </label>
                                  </div>
                                )}
                              </div>
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => handleCompleteStep(step.step_number)}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  Sign Off
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div className="space-y-2">
                              {getNotes(step.step_number) && (
                                <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
                                  <p className="text-xs text-gray-400 mb-1">Notes:</p>
                                  <p className="text-sm text-white whitespace-pre-wrap">{getNotes(step.step_number)}</p>
                                </div>
                              )}
                              {getImages(step.step_number).length > 0 && (
                                <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
                                  <p className="text-xs text-gray-400 mb-2">Pictures:</p>
                                  <div className="flex flex-wrap gap-2">
                                    {getImages(step.step_number).map((url, idx) => (
                                      <img 
                                        key={idx} 
                                        src={`${url}?w=200`}
                                        alt={`Step ${step.step_number} - ${idx + 1}`} 
                                        className="w-24 h-24 object-cover rounded border border-zinc-700 cursor-pointer hover:opacity-80 transition-opacity" 
                                        onClick={() => setEnlargedImage(url)}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center justify-end gap-1 text-sm text-green-400">
                                Completed: {format(new Date(completionTime), 'h:mm:ss a')}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="py-12 text-center">
                <p className="text-gray-400">No steps available</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Image Enlargement Modal */}
      {enlargedImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setEnlargedImage(null)}
        >
          <div className="absolute top-4 right-4 flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const response = await fetch(enlargedImage);
                  const blob = await response.blob();
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `sop-performance-image-${Date.now()}.jpg`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(url);
                  toast.success('Image downloaded');
                } catch (error) {
                  toast.error('Failed to download image');
                }
              }}
            >
              <Download className="w-6 h-6" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => setEnlargedImage(null)}
            >
              <X className="w-6 h-6" />
            </Button>
          </div>
          <img
            src={enlargedImage}
            alt="Enlarged view"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}