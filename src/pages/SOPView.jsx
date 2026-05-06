import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Edit, Download, Calendar, User, X, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function SOPView() {
  const navigate = useNavigate();
  const printRef = useRef();
  const urlParams = new URLSearchParams(window.location.search);
  const sopId = urlParams.get('id');
  const returnTo = urlParams.get('returnTo');
  const [enlargedImage, setEnlargedImage] = useState(null);
  const [completedSteps, setCompletedSteps] = useState(() => {
    try {
      const saved = localStorage.getItem(`sopProgress_${sopId}`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleStepCompletion = (stepNumber) => {
    const key = `step_${stepNumber}`;
    const updated = { ...completedSteps, [key]: !completedSteps[key] };
    setCompletedSteps(updated);
    localStorage.setItem(`sopProgress_${sopId}`, JSON.stringify(updated));
  };

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const { data: sop, isLoading } = useQuery({
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

  const { data: workOrder } = useQuery({
    queryKey: ['workOrder-for-sop', sop?.group, user?.company_id],
    queryFn: async () => {
      const results = await base44.entities.WorkOrder.filter({ name: sop.group, company_id: user.company_id });
      return results[0] || null;
    },
    enabled: !!sop?.group && !!user?.company_id
  });

  const handleDownloadPDF = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading SOP...</p>
        </div>
      </div>
    );
  }

  if (!sop) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
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
    <>
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-content, #printable-content * {
            visibility: visible;
          }
          #printable-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print {
            display: none !important;
          }
          .print-break {
            page-break-after: always;
          }
        }
      `}</style>

      <div className="min-h-screen bg-black print:bg-white">
        {/* Header - Hidden on Print */}
         <div className="bg-zinc-900 border-b border-zinc-800 no-print fixed top-0 left-0 right-0 z-50">
           <div className="max-w-5xl mx-auto px-6 py-4">
             <button onClick={() => navigate(returnTo ? decodeURIComponent(returnTo) : (workOrder ? `/WorkOrderPage?id=${workOrder.id}` : createPageUrl('SOPList')))}>
               <Button variant="ghost" size="icon" className="text-white hover:bg-zinc-800">
                 <ArrowLeft className="w-5 h-5" />
               </Button>
             </button>
           </div>
         </div>

        {/* Content - Printable */}
        <div id="printable-content" className="max-w-5xl mx-auto px-6 py-8 print:px-12 print:py-8 pt-24">
          {/* Title Section */}
          <div className="mb-8 print:mb-12">
            <h1 className="text-4xl font-bold text-white mb-3 print:text-5xl print:text-black">{sop.title}</h1>
            {sop.description && (
              <div
                className="text-lg text-gray-400 print:text-xl print:text-gray-700 prose prose-invert max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-3 [&_blockquote]:italic"
                dangerouslySetInnerHTML={{ __html: sop.description }}
              />
            )}
            <div className="flex flex-col gap-3 mt-4 text-sm text-gray-500 print:text-base">
              <div className="flex gap-6">
                <div className="flex items-center gap-1">
                  <span>Last updated: {format(new Date(sop.updated_date), 'MMM d, yyyy')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span>Created by: {sop.created_by}</span>
                </div>
              </div>
              {sop.group && (
                <div className="text-xs bg-zinc-800 text-white px-3 py-1.5 rounded-sm w-fit print:bg-gray-200 print:text-gray-900">
                  Department: {sop.group}
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar - Only for work order copies */}
          {sop.original_sop_id && sop.steps && sop.steps.length > 0 && (
            <div className="mb-6 no-print">
              {(() => {
                const totalSteps = sop.steps.length;
                const completedCount = Object.values(completedSteps).filter(Boolean).length;
                const percentage = Math.round((completedCount / totalSteps) * 100);
                return (
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden border border-zinc-700">
                        <div
                          className="bg-green-500 h-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-white whitespace-nowrap">{completedCount}/{totalSteps}</span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Action Buttons - Hidden on Print */}
          <div className="flex flex-row gap-3 mb-6 no-print">
            <Button
              variant="outline"
              onClick={handleDownloadPDF}
              className="flex items-center justify-center gap-2 bg-black border-zinc-700 text-white hover:bg-zinc-800"
            >
              <Download className="w-4 h-4" />
              PDF
            </Button>
            <Link to={createPageUrl('SOPEditor') + '?id=' + sopId}>
              <Button className="bg-white text-black hover:bg-gray-200 font-semibold">
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            </Link>
            <Link to={createPageUrl('SOPPerform') + '?id=' + sopId} className="ml-auto">
              <Button
                variant="outline"
                className="flex items-center justify-center gap-2 bg-black border-zinc-700 text-white hover:bg-zinc-800"
              >
                Perform
              </Button>
            </Link>
          </div>

          {/* Materials List */}
          {sop.materials && sop.materials.length > 0 && (
            <div className="mb-8 print:mb-6">
              <h2 className="text-xl font-semibold text-white mb-3 print:text-black">Materials Required</h2>
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 print:bg-white print:border-gray-200">
                <div className="space-y-3">
                  {sop.materials.map((material, index) => (
                    <div key={index} className="flex items-center gap-3 pb-3 border-b border-zinc-700 last:border-b-0 last:pb-0 print:border-gray-200">
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                        <div>
                          <span className="text-sm font-semibold text-white print:text-black">{material.name}</span>
                        </div>
                        {material.location && (
                          <div>
                            <span className="text-xs text-gray-400 print:text-gray-600">
                              <span className="font-semibold">Location:</span> {material.location}
                            </span>
                          </div>
                        )}
                      </div>
                      {material.image && (
                        <div 
                          className="flex-shrink-0 cursor-pointer group no-print"
                          onClick={() => setEnlargedImage(material.image)}
                        >
                          <img
                            src={`${material.image}?w=80`}
                            alt={material.name || 'Material'}
                            className="rounded border border-zinc-700 w-12 h-12 object-cover group-hover:opacity-80 transition-opacity"
                          />
                        </div>
                      )}
                      {material.image && (
                        <img
                          src={material.image}
                          alt={material.name || 'Material'}
                          className="hidden print:block rounded border border-gray-300 max-h-16 flex-shrink-0"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Steps */}
          <div className="space-y-4 print:space-y-2">
            {sop.steps && sop.steps.length > 0 ? (
              sop.steps.map((step, index) => (
                <div key={index} className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 print:bg-white print:border print:p-3 print:border-gray-200">
                  <div className="flex items-start gap-3">
                     <div className="flex-shrink-0">
                       <button
                         onClick={() => sop.original_sop_id && toggleStepCompletion(step.step_number)}
                         className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all no-print ${
                           sop.original_sop_id ? 'cursor-pointer' : 'cursor-not-allowed'
                         } ${
                           completedSteps[`step_${step.step_number}`]
                             ? 'bg-green-500 text-white'
                             : sop.original_sop_id ? 'bg-white text-black hover:bg-gray-200' : 'bg-zinc-700 text-gray-400'
                         }`}
                       >
                         {step.step_number}
                       </button>
                       <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold print:bg-black print:text-white print:w-8 print:h-8 print:text-sm print:block hidden">
                         {step.step_number}
                       </div>
                     </div>
                    <div className="flex-1">
                      {step.title && (
                        <h3 className="text-base font-semibold text-white mb-2 print:text-sm print:mb-1 print:text-gray-900">
                          {step.title}
                        </h3>
                      )}
                      {step.caution && (
                        <div className="mb-2 p-3 bg-zinc-800 border border-zinc-700 rounded-lg print:p-1.5 print:mb-1 print:bg-red-50 print:border-red-200">
                          <p className="text-sm text-gray-300 font-medium whitespace-pre-wrap print:text-xs print:text-red-700">
                            ⚠️ Caution: {step.caution}
                          </p>
                        </div>
                      )}
                      {step.description && (
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed print:text-xs print:leading-tight print:text-gray-700">
                          {step.description}
                        </p>
                      )}
                      {(step.input_type === 'measurements' || step.input_type === 'time') && step.measurements && step.measurements.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{step.input_type === 'time' ? 'Time' : 'Measurements'}</p>
                          <table className="text-sm text-gray-300 border border-zinc-700 rounded overflow-hidden print:text-xs print:text-gray-700">
                            <thead>
                              <tr className="bg-zinc-800 print:bg-gray-100">
                                <th className="px-3 py-1 text-left font-semibold text-xs text-gray-400 print:text-gray-600">Label</th>
                                <th className="px-3 py-1 text-left font-semibold text-xs text-gray-400 print:text-gray-600">{step.input_type === 'time' ? 'Time' : 'Amount'}</th>
                                {step.input_type !== 'time' && <th className="px-3 py-1 text-left font-semibold text-xs text-gray-400 print:text-gray-600">Unit</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {step.measurements.map((m, mi) => (
                                <tr key={mi} className="border-t border-zinc-700 print:border-gray-200">
                                  <td className="px-3 py-1">{m.material}</td>
                                  <td className="px-3 py-1 font-mono">{m.amount}</td>
                                  {step.input_type !== 'time' && <td className="px-3 py-1">{m.unit}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {step.image_urls && step.image_urls.length > 0 && (
                        <div className="mt-2 print:mt-1 flex flex-nowrap gap-2 overflow-x-auto">
                          {step.image_urls.map((url, imgIndex) => (
                            <img
                              key={imgIndex}
                              src={`${url}?w=400`}
                              alt={`Step ${step.step_number} - Image ${imgIndex + 1}`}
                              className="rounded-lg border border-zinc-700 max-h-56 h-auto flex-shrink-0 print:max-h-32 print:border-gray-300 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => setEnlargedImage(url)}
                            />
                          ))}
                        </div>
                      )}

                      {/* Substeps */}
                      {step.substeps && step.substeps.length > 0 && (
                        <div className="mt-3 pl-6 space-y-2 border-l-2 border-zinc-700 print:pl-4 print:border-gray-300">
                          {step.substeps.map((substep, subIndex) => (
                            <div key={subIndex} className="bg-black rounded-lg border border-zinc-700 p-3 print:bg-gray-50 print:border-gray-200 print:p-2">
                              <div className="flex items-start gap-2">
                                <div className="flex-shrink-0">
                                  <div className="w-6 h-6 rounded-full bg-zinc-700 text-white flex items-center justify-center text-xs font-bold print:bg-gray-300 print:text-black print:w-6 print:h-6">
                                    {step.step_number}.{substep.substep_number}
                                  </div>
                                </div>
                                <div className="flex-1">
                                  {substep.title && (
                                    <h4 className="text-sm font-semibold text-white mb-1 print:text-xs print:text-gray-900">
                                      {substep.title}
                                    </h4>
                                  )}
                                  {substep.caution && (
                                    <div className="mb-1 p-2 bg-zinc-800 border border-zinc-700 rounded print:p-1 print:bg-red-50 print:border-red-200">
                                      <p className="text-xs text-gray-300 font-medium whitespace-pre-wrap print:text-xs print:text-red-700">
                                        ⚠️ {substep.caution}
                                      </p>
                                    </div>
                                  )}
                                  {substep.description && (
                                    <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed print:text-xs print:text-gray-700">
                                      {substep.description}
                                    </p>
                                  )}
                                  {(substep.input_type === 'measurements' || substep.input_type === 'time') && substep.measurements && substep.measurements.length > 0 && (
                                   <div className="mt-1">
                                     <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{substep.input_type === 'time' ? 'Time' : 'Measurements'}</p>
                                     <table className="text-xs text-gray-300 border border-zinc-700 rounded overflow-hidden print:text-gray-700">
                                       <thead>
                                         <tr className="bg-zinc-800 print:bg-gray-100">
                                           <th className="px-2 py-1 text-left font-semibold text-gray-400 print:text-gray-600">Label</th>
                                           <th className="px-2 py-1 text-left font-semibold text-gray-400 print:text-gray-600">{substep.input_type === 'time' ? 'Time' : 'Amount'}</th>
                                           {substep.input_type !== 'time' && <th className="px-2 py-1 text-left font-semibold text-gray-400 print:text-gray-600">Unit</th>}
                                         </tr>
                                       </thead>
                                       <tbody>
                                         {substep.measurements.map((m, mi) => (
                                           <tr key={mi} className="border-t border-zinc-700 print:border-gray-200">
                                             <td className="px-2 py-1">{m.material}</td>
                                             <td className="px-2 py-1 font-mono">{m.amount}</td>
                                             {substep.input_type !== 'time' && <td className="px-2 py-1">{m.unit}</td>}
                                           </tr>
                                         ))}
                                       </tbody>
                                     </table>
                                   </div>
                                  )}
                                  {substep.image_urls && substep.image_urls.length > 0 && (
                                    <div className="mt-1 print:mt-1 flex flex-nowrap gap-2 overflow-x-auto">
                                      {substep.image_urls.map((url, imgIndex) => (
                                        <img
                                          key={imgIndex}
                                          src={`${url}?w=400`}
                                          alt={`Substep ${substep.substep_number} - Image ${imgIndex + 1}`}
                                          className="rounded-lg border border-zinc-700 max-h-40 h-auto flex-shrink-0 print:max-h-24 print:border-gray-300 cursor-pointer hover:opacity-80 transition-opacity"
                                          onClick={() => setEnlargedImage(url)}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <Card className="bg-zinc-900 border-zinc-800 print:bg-white">
                <CardContent className="py-12 text-center">
                  <p className="text-gray-400 print:text-gray-500">No steps added yet</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Image Enlargement Modal */}
      {enlargedImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 no-print"
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
                  link.download = `sop-image-${Date.now()}.jpg`;
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
    </>
  );
}