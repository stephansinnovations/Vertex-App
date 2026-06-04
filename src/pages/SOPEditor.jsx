import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Plus, Trash2, Image as ImageIcon, Sparkles, Ruler, X, Video } from 'lucide-react';
import MeasurementsInput from '@/components/MeasurementsInput';
import PartsBrowserSheet from '@/components/PartsBrowserSheet';
import AddVariableMenu from '@/components/AddVariableMenu';
import { toast } from 'sonner';
import RichTextEditor from '@/components/RichTextEditor';
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

export default function SOPEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const sopId = urlParams.get('id');
  const isEditing = !!sopId;

  // Pre-fill params from WorkOrderPage
  const prefillGroup = urlParams.get('group') || '';

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const [formData, setFormData] = useState({
    title: '',
    type: 'SOP',
    description: '',
    group: prefillGroup,
    materials: [],
    steps: []
  });

  const [workOrders, setWorkOrders] = useState([]);

  const [uploadingStepIndex, setUploadingStepIndex] = useState(null);
  const [uploadingSubstepIndex, setUploadingSubstepIndex] = useState(null);
  const [uploadedPdfUrl, setUploadedPdfUrl] = useState(null);
  const [partsBrowserStep, setPartsBrowserStep] = useState(null);
  const [processingPdf, setProcessingPdf] = useState(false);
  const [processingVideo, setProcessingVideo] = useState(false);
  const [videoFileName, setVideoFileName] = useState(null);
  const [simplifyingStepIndex, setSimplifyingStepIndex] = useState(null);
  const [simplifyingSubstepIndex, setSimplifyingSubstepIndex] = useState(null);
  const [simplifyingAll, setSimplifyingAll] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [originalData, setOriginalData] = useState(null);
  const [showNewDeptDialog, setShowNewDeptDialog] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);


  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.SOP.delete(sopId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      toast.success('SOP deleted');
      navigate(createPageUrl('SOPList'));
    }
  });

  const createDeptMutation = useMutation({
    mutationFn: (name) => base44.entities.WorkOrder.create({ name, company_id: user?.company_id }),
    onSuccess: (newDept) => {
      setWorkOrders(prev => [...prev, newDept]);
      setFormData(prev => ({ ...prev, group: newDept.name }));
      setShowNewDeptDialog(false);
      setNewDeptName('');
      toast.success('Department created');
    }
  });

  const handleCreateDept = () => {
    if (!newDeptName.trim()) return;
    createDeptMutation.mutate(newDeptName.trim());
  };

  const { data: sop, isLoading } = useQuery({
    queryKey: ['sop', sopId],
    queryFn: async () => {
      const sops = await base44.entities.SOP.filter({ id: sopId });
      return sops[0];
    },
    enabled: isEditing
  });

  useEffect(() => {
    if (sop) {
      const data = {
        title: sop.title || '',
        type: sop.type || 'SOP',
        description: sop.description || '',
        group: sop.group || '',
        materials: sop.materials || [],
        steps: sop.steps || []
      };
      setFormData(data);
      setOriginalData(data);
    } else if (!isEditing) {
      // If no prefill params, try to restore draft
      if (!prefillGroup) {
        const draft = localStorage.getItem('sop-draft');
        if (draft) {
          try {
            const parsed = JSON.parse(draft);
            setFormData(parsed);
            toast.info('Draft restored');
          } catch (error) {
            // Invalid draft, ignore
          }
        }
      }
    }
  }, [sop, isEditing]);

  useEffect(() => {
    const fetchGroups = async () => {
      if (!user?.company_id) return;
      const orders = await base44.entities.WorkOrder.filter({ company_id: user.company_id });
      setWorkOrders(orders);
    };
    fetchGroups();
  }, [user, sop]);



  // Autosave to localStorage
  useEffect(() => {
    if (!isEditing && !prefillGroup && (formData.title || formData.description || formData.steps.length > 0 || formData.materials.length > 0)) {
      const timer = setTimeout(() => {
        localStorage.setItem('sop-draft', JSON.stringify(formData));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [formData, isEditing]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (isEditing) {
        return base44.entities.SOP.update(sopId, data);
      } else {
        return base44.entities.SOP.create({ ...data, company_id: user?.company_id });
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      queryClient.invalidateQueries({ queryKey: ['sop', sopId] });
      queryClient.invalidateQueries({ queryKey: ['sops-wo'] });
      localStorage.removeItem('sop-draft');
      toast.success(isEditing ? 'SOP updated successfully' : 'SOP created successfully');
      navigate(createPageUrl('SOPView') + '?id=' + (data.id || sopId));
    },
    onError: () => {
      toast.error('Failed to save SOP');
    }
  });

  const handleSave = async () => {
    if (!formData.title.trim()) {
      setFieldErrors({ title: true });
      toast.error('Please enter a title');
      setTimeout(() => setFieldErrors({}), 2000);
      return;
    }

    if (!formData.group) {
      setFieldErrors({ group: true });
      toast.error('Please select a department');
      setTimeout(() => setFieldErrors({}), 2000);
      return;
    }

    const normalizedData = {
      ...formData,
      group: formData.group || undefined,
      test_number: (formData.test_number !== '' && formData.test_number != null) ? Number(formData.test_number) : undefined,
      steps: formData.steps.map(step => ({
        ...step,
        image_urls: step.image_urls || [],
        substeps: (step.substeps || []).map(substep => ({
          ...substep,
          image_urls: substep.image_urls || []
        }))
      }))
    };

    saveMutation.mutate(normalizedData);
  };

  const hasUnsavedChanges = () => {
    if (!isEditing && (formData.title || formData.description || formData.steps.length > 0 || formData.materials.length > 0)) {
      return true;
    }
    if (isEditing && originalData) {
      return JSON.stringify(formData) !== JSON.stringify(originalData);
    }
    return false;
  };

  const handleBack = () => {
    if (hasUnsavedChanges()) {
      setShowExitDialog(true);
    } else {
      navigate(isEditing ? createPageUrl('SOPView') + '?id=' + sopId : createPageUrl('SOPList'));
    }
  };

  const handleExitWithoutSaving = () => {
    navigate(isEditing ? createPageUrl('SOPView') + '?id=' + sopId : createPageUrl('SOPList'));
  };

  const addStep = () => {
    const newStep = {
      step_number: formData.steps.length + 1,
      title: '',
      description: '',
      image_urls: [],
      substeps: []
    };
    setFormData({ ...formData, steps: [...formData.steps, newStep] });
  };

  const insertStepAt = (index) => {
    const newStep = { step_number: index + 1, title: '', description: '', image_urls: [], substeps: [] };
    const newSteps = [...formData.steps];
    newSteps.splice(index, 0, newStep);
    setFormData({ ...formData, steps: newSteps.map((step, i) => ({ ...step, step_number: i + 1 })) });
  };


  const removeStep = (index) => {
    const newSteps = formData.steps.filter((_, i) => i !== index);
    setFormData({ ...formData, steps: newSteps.map((step, i) => ({ ...step, step_number: i + 1 })) });
  };

  const updateStep = (index, field, value) => {
    const newSteps = [...formData.steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setFormData({ ...formData, steps: newSteps });
  };

  const moveStep = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === formData.steps.length - 1) return;
    const newSteps = [...formData.steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setFormData({ ...formData, steps: newSteps.map((step, i) => ({ ...step, step_number: i + 1 })) });
  };

  const addSubstep = (stepIndex) => {
    const newSteps = [...formData.steps];
    const substeps = newSteps[stepIndex].substeps || [];
    newSteps[stepIndex] = {
      ...newSteps[stepIndex],
      substeps: [...substeps, { substep_number: substeps.length + 1, title: '', description: '', image_urls: [] }]
    };
    setFormData({ ...formData, steps: newSteps });
  };

  const removeSubstep = (stepIndex, substepIndex) => {
    const newSteps = [...formData.steps];
    const substeps = newSteps[stepIndex].substeps.filter((_, i) => i !== substepIndex);
    newSteps[stepIndex] = { ...newSteps[stepIndex], substeps: substeps.map((s, i) => ({ ...s, substep_number: i + 1 })) };
    setFormData({ ...formData, steps: newSteps });
  };

  const updateSubstep = (stepIndex, substepIndex, field, value) => {
    const newSteps = [...formData.steps];
    const substeps = [...(newSteps[stepIndex].substeps || [])];
    substeps[substepIndex] = { ...substeps[substepIndex], [field]: value };
    newSteps[stepIndex] = { ...newSteps[stepIndex], substeps };
    setFormData({ ...formData, steps: newSteps });
  };

  const addStepMaterial = (stepIndex) => {
    const newSteps = [...formData.steps];
    const materials = newSteps[stepIndex].materials || [];
    newSteps[stepIndex] = { ...newSteps[stepIndex], materials: [...materials, { name: '', location: '' }] };
    setFormData({ ...formData, steps: newSteps });
  };

  const removeStepMaterial = (stepIndex, materialIndex) => {
    const newSteps = [...formData.steps];
    const materials = (newSteps[stepIndex].materials || []).filter((_, i) => i !== materialIndex);
    newSteps[stepIndex] = { ...newSteps[stepIndex], materials };
    setFormData({ ...formData, steps: newSteps });
  };

  const addLibraryPart = (stepIndex, partData) => {
    const newSteps = [...formData.steps];
    const materials = newSteps[stepIndex].materials || [];
    const existingIdx = materials.findIndex(m => m.from_library && m.name === partData.name);
    let updated;
    if (existingIdx >= 0) {
      updated = [...materials];
      updated[existingIdx] = { ...updated[existingIdx], qty: (updated[existingIdx].qty || 1) + 1 };
    } else {
      updated = [...materials, { ...partData, qty: 1 }];
    }
    newSteps[stepIndex] = { ...newSteps[stepIndex], materials: updated };
    setFormData({ ...formData, steps: newSteps });
  };

  const decrementLibraryPart = (stepIndex, partName) => {
    const newSteps = [...formData.steps];
    const materials = newSteps[stepIndex].materials || [];
    const existingIdx = materials.findIndex(m => m.from_library && m.name === partName);
    if (existingIdx < 0) return;
    const current = materials[existingIdx].qty || 1;
    let updated;
    if (current <= 1) {
      updated = materials.filter((_, i) => i !== existingIdx);
    } else {
      updated = [...materials];
      updated[existingIdx] = { ...updated[existingIdx], qty: current - 1 };
    }
    newSteps[stepIndex] = { ...newSteps[stepIndex], materials: updated };
    setFormData({ ...formData, steps: newSteps });
  };

  const updateStepMaterial = (stepIndex, materialIndex, field, value) => {
    const newSteps = [...formData.steps];
    const materials = [...(newSteps[stepIndex].materials || [])];
    materials[materialIndex] = { ...materials[materialIndex], [field]: value };
    newSteps[stepIndex] = { ...newSteps[stepIndex], materials };
    setFormData({ ...formData, steps: newSteps });
  };

  const moveSubstep = (stepIndex, substepIndex, direction) => {
    const substeps = formData.steps[stepIndex].substeps;
    if (direction === 'up' && substepIndex === 0) return;
    if (direction === 'down' && substepIndex === substeps.length - 1) return;
    const newSteps = [...formData.steps];
    const newSubsteps = [...substeps];
    const targetIndex = direction === 'up' ? substepIndex - 1 : substepIndex + 1;
    [newSubsteps[substepIndex], newSubsteps[targetIndex]] = [newSubsteps[targetIndex], newSubsteps[substepIndex]];
    newSteps[stepIndex] = { ...newSteps[stepIndex], substeps: newSubsteps.map((s, i) => ({ ...s, substep_number: i + 1 })) };
    setFormData({ ...formData, steps: newSteps });
  };

  const handleImageUpload = async (index, file) => {
    if (!file) return;
    const currentUrls = formData.steps[index].image_urls || [];
    if (currentUrls.length >= 3) { toast.error('Maximum 3 images per step'); return; }
    setUploadingStepIndex(index);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      updateStep(index, 'image_urls', [...currentUrls, file_url]);
      toast.success('Image uploaded');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingStepIndex(null);
    }
  };

  const handleSubstepImageUpload = async (stepIndex, substepIndex, file) => {
    if (!file) return;
    const currentUrls = formData.steps[stepIndex].substeps[substepIndex].image_urls || [];
    if (currentUrls.length >= 3) { toast.error('Maximum 3 images per substep'); return; }
    setUploadingSubstepIndex(`${stepIndex}-${substepIndex}`);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      updateSubstep(stepIndex, substepIndex, 'image_urls', [...currentUrls, file_url]);
      toast.success('Image uploaded');
    } catch (error) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingSubstepIndex(null);
    }
  };

  const handlePdfUpload = async (file) => {
    if (!file) return;
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedPdfUrl(file_url);
      toast.success('PDF uploaded');
    } catch (error) {
      toast.error('Failed to upload PDF');
    }
  };

  const handleVideoImport = async (file) => {
    if (!file) return;
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      toast.error('Gemini API key not set — add it in Master Sheet settings');
      return;
    }
    setVideoFileName(file.name);
    setProcessingVideo(true);
    try {
      // Upload video to Gemini File API
      const uploadRes = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/form-data; boundary=boundary` },
          body: (() => {
            const boundary = '----boundary';
            const metadata = JSON.stringify({ file: { display_name: file.name, mime_type: file.type } });
            const enc = new TextEncoder();
            const metaPart = enc.encode(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`);
            const filePart = enc.encode(`--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`);
            const end = enc.encode(`\r\n--${boundary}--`);
            return new Blob([metaPart, filePart, file, end]);
          })(),
        }
      );

      if (!uploadRes.ok) throw new Error('Video upload failed');
      const uploadData = await uploadRes.json();
      const fileUri = uploadData.file?.uri;
      if (!fileUri) throw new Error('No file URI returned');

      // Wait for file to be processed
      let fileReady = false;
      for (let i = 0; i < 20; i++) {
        const statusRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${uploadData.file.name}?key=${apiKey}`
        );
        const statusData = await statusRes.json();
        if (statusData.state === 'ACTIVE') { fileReady = true; break; }
        await new Promise(r => setTimeout(r, 3000));
      }
      if (!fileReady) throw new Error('Video processing timed out');

      // Generate SOP from video
      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { file_data: { mime_type: file.type, file_uri: fileUri } },
                { text: `Watch this video and generate a detailed SOP (Standard Operating Procedure) for the task being performed. Return ONLY valid JSON with this exact structure:
{
  "title": "short descriptive title",
  "description": "1-2 sentence overview of what this SOP covers",
  "department": "department name (e.g. Electrical, Interior, Fabrication)",
  "steps": [
    {
      "step_number": 1,
      "title": "step title",
      "description": "detailed description of this step",
      "caution": "any safety warning or empty string",
      "substeps": [
        { "substep_number": 1, "title": "substep title", "description": "detail", "caution": "" }
      ]
    }
  ]
}` }
              ]
            }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        }
      );

      if (!genRes.ok) throw new Error('Gemini generation failed');
      const genData = await genRes.json();
      const text = genData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No response from Gemini');
      const result = JSON.parse(text);

      if (result.steps?.length > 0) {
        setFormData(prev => ({
          ...prev,
          title: prev.title || result.title || '',
          description: prev.description || result.description || '',
          group: prev.group || result.department || '',
          steps: result.steps.map((step, index) => ({
            id: Date.now() + index,
            step_number: step.step_number || index + 1,
            title: step.title || '',
            description: step.description || '',
            caution: step.caution || '',
            image_url: null,
            substeps: (step.substeps || []).map((sub, si) => ({
              id: Date.now() + index * 100 + si,
              substep_number: sub.substep_number || si + 1,
              title: sub.title || '',
              description: sub.description || '',
              caution: sub.caution || '',
              image_url: null
            }))
          }))
        }));
        toast.success(`Generated ${result.steps.length} steps from video`);
      } else {
        toast.error('No steps found in video');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to process video');
    } finally {
      setProcessingVideo(false);
    }
  };

  const handleConvertPdfToSop = async () => {
    if (!uploadedPdfUrl) return;
    setProcessingPdf(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this PDF and extract a complete SOP structure. Return JSON with title, description, department, and steps array (each with step_number, title, description, caution, substeps array).`,
        file_urls: [uploadedPdfUrl],
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            department: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step_number: { type: "number" },
                  title: { type: "string" },
                  description: { type: "string" },
                  caution: { type: "string" },
                  substeps: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        substep_number: { type: "number" },
                        title: { type: "string" },
                        description: { type: "string" },
                        caution: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (result.steps && result.steps.length > 0) {
        setFormData(prev => ({
          ...prev,
          title: prev.title || result.title || '',
          description: prev.description || result.description || '',
          department: prev.department || result.department || '',
          steps: result.steps.map((step, index) => ({
            step_number: index + 1,
            title: step.title || '',
            description: step.description || '',
            caution: (step.caution && !['none','n/a'].includes(step.caution.toLowerCase())) ? step.caution : '',
            image_urls: [],
            substeps: (step.substeps || []).map((substep, subIndex) => ({
              substep_number: subIndex + 1,
              title: substep.title || '',
              description: substep.description || '',
              caution: (substep.caution && !['none','n/a'].includes(substep.caution.toLowerCase())) ? substep.caution : '',
              image_urls: []
            }))
          }))
        }));
        toast.success(`Converted ${result.steps.length} steps from PDF`);
        setUploadedPdfUrl(null);
      } else {
        toast.error('No steps found in PDF');
      }
    } catch (error) {
      toast.error('Failed to convert PDF to SOP');
    } finally {
      setProcessingPdf(false);
    }
  };

  const handleSimplifyText = async (index) => {
    const step = formData.steps[index];
    if (!step.title?.trim() && !step.caution?.trim() && !step.description?.trim()) { toast.error('No text to simplify'); return; }
    setSimplifyingStepIndex(index);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Simplify this step content to be clear and concise while keeping all vital info:\nTitle: ${step.title || 'N/A'}\nCaution: ${step.caution || 'N/A'}\nDescription: ${step.description || 'N/A'}`,
        response_json_schema: { type: "object", properties: { title: { type: "string" }, caution: { type: "string" }, description: { type: "string" } } }
      });
      if (result) {
        const newSteps = [...formData.steps];
        newSteps[index] = {
          ...newSteps[index],
          title: result.title && result.title !== 'N/A' ? result.title : step.title || '',
          caution: result.caution && result.caution !== 'N/A' ? result.caution : step.caution || '',
          description: result.description && result.description !== 'N/A' ? result.description : step.description || ''
        };
        setFormData({ ...formData, steps: newSteps });
        toast.success('Step simplified');
      }
    } catch (error) {
      toast.error('Failed to simplify text');
    } finally {
      setSimplifyingStepIndex(null);
    }
  };

  const handleSimplifySubstepText = async (stepIndex, substepIndex) => {
    const substep = formData.steps[stepIndex].substeps[substepIndex];
    if (!substep.title?.trim() && !substep.caution?.trim() && !substep.description?.trim()) { toast.error('No text to simplify'); return; }
    setSimplifyingSubstepIndex(`${stepIndex}-${substepIndex}`);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Simplify this substep content to be clear and concise while keeping all vital info:\nTitle: ${substep.title || 'N/A'}\nCaution: ${substep.caution || 'N/A'}\nDescription: ${substep.description || 'N/A'}`,
        response_json_schema: { type: "object", properties: { title: { type: "string" }, caution: { type: "string" }, description: { type: "string" } } }
      });
      if (result) {
        const newSteps = [...formData.steps];
        newSteps[stepIndex].substeps[substepIndex] = {
          ...substep,
          title: result.title && result.title !== 'N/A' ? result.title : substep.title || '',
          caution: result.caution && result.caution !== 'N/A' ? result.caution : substep.caution || '',
          description: result.description && result.description !== 'N/A' ? result.description : substep.description || ''
        };
        setFormData({ ...formData, steps: newSteps });
        toast.success('Substep simplified');
      }
    } catch (error) {
      toast.error('Failed to simplify text');
    } finally {
      setSimplifyingSubstepIndex(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="text-white hover:bg-zinc-800" onClick={handleBack}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h1 className="text-xl font-bold text-white">
                {isEditing ? 'Edit SOP' : 'Create New SOP'}
              </h1>
            </div>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="bg-white text-black hover:bg-gray-200 font-semibold"
            >
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? 'Saving...' : 'Save SOP'}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* PDF Import */}
        <Card className="mb-5 bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-white">Import from PDF (Optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-400">Upload a PDF to automatically generate SOP steps</p>
            <div className="flex gap-3">
              <input type="file" id="pdf-upload" accept="application/pdf" className="hidden"
                onChange={(e) => { const file = e.target.files[0]; if (file) handlePdfUpload(file); }} />
              <Button variant="outline" onClick={() => document.getElementById('pdf-upload').click()}
                disabled={processingPdf} className="bg-black border-zinc-700 text-white hover:bg-zinc-800">
                <ImageIcon className="w-4 h-4 mr-2" />
                {uploadedPdfUrl ? 'Change PDF' : 'Upload PDF'}
              </Button>
              {uploadedPdfUrl && (
                <Button onClick={handleConvertPdfToSop} disabled={processingPdf}
                  className="bg-white text-black hover:bg-gray-200 font-semibold">
                  {processingPdf ? 'Converting...' : 'Turn PDF into SOP'}
                </Button>
              )}
            </div>
            {uploadedPdfUrl && !processingPdf && <p className="text-sm text-gray-400">✓ PDF ready to convert</p>}
          </CardContent>
        </Card>

        {/* Video Import */}
        <Card className="mb-5 bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-purple-400" />
                Import from Video
              </div>
              <div className="flex items-center gap-2">
                {localStorage.getItem('geminiApiKey') ? (
                  <span className="flex items-center gap-1 text-xs font-normal text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    Gemini API Key Set
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-normal text-red-400 bg-red-400/10 px-2 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    No Gemini API Key
                  </span>
                )}
                <button onClick={() => navigate('/MasterSheet')} className="text-xs text-gray-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded-full transition-colors">
                  Add Key
                </button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-400">Upload a video and Vertex AI will watch it and generate all SOP steps automatically</p>
            <div className="flex gap-3 items-center">
              <input type="file" id="video-upload" accept="video/*" className="hidden"
                onChange={(e) => { const file = e.target.files[0]; if (file) handleVideoImport(file); e.target.value = ''; }} />
              <Button variant="outline" onClick={() => document.getElementById('video-upload').click()}
                disabled={processingVideo} className="bg-black border-zinc-700 text-white hover:bg-zinc-800">
                <Video className="w-4 h-4 mr-2" />
                {processingVideo ? 'Processing...' : videoFileName ? 'Change Video' : 'Upload Video'}
              </Button>
              {processingVideo && (
                <div className="flex items-center gap-2 text-sm text-purple-400">
                  <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  Analyzing video with Gemini AI...
                </div>
              )}
            </div>
            {videoFileName && !processingVideo && <p className="text-sm text-gray-400">✓ {videoFileName}</p>}
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card className="mb-5 bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-white">Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="title" className="text-xs font-medium text-gray-300">Title *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., How to Process Customer Returns"
                className={`mt-1 h-8 bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600 ${fieldErrors.title ? 'border-red-500 border-2 animate-pulse' : ''}`}
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-gray-300">
                Department <span className="text-red-400">*</span>
              </Label>
              <div className="flex gap-2 mt-1">
                <select
                  value={formData.group}
                  onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                  className={`flex-1 bg-black border rounded-md px-3 py-2 text-white focus:outline-none focus:border-zinc-500 ${fieldErrors.group ? 'border-red-500 border-2 animate-pulse' : 'border-zinc-700'}`}
                >
                  <option value="" disabled>Select a department...</option>
                  {workOrders.map((wo) => (
                    <option key={wo.id} value={wo.name}>{wo.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowNewDeptDialog(true)}
                  className="bg-black border-zinc-700 text-white hover:bg-zinc-800 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-gray-300">Description</Label>
              <RichTextEditor
                value={formData.description}
                onChange={(val) => setFormData({ ...formData, description: val })}
                placeholder="Brief description of what this SOP covers..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <div className="mb-6">
          <h2 className="text-base font-semibold text-white mb-3">Steps</h2>
          <div className="space-y-3">
            {formData.steps.map((step, index) => (
              <React.Fragment key={index}>
                {index === 0 && (
                  <Button variant="outline" size="sm" onClick={() => insertStepAt(0)}
                    className="w-full bg-black border-zinc-700 text-white hover:bg-zinc-800 border-dashed">
                    <Plus className="w-4 h-4 mr-2" />Insert Step Here
                  </Button>
                )}
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardContent className="pt-4">
                    {/* Mobile layout */}
                    <div className="flex md:hidden items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold">{step.step_number}</div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-zinc-800" onClick={() => moveStep(index, 'up')} disabled={index === 0}>▲</Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-zinc-800" onClick={() => moveStep(index, 'down')} disabled={index === formData.steps.length - 1}>▼</Button>
                        {(step.title?.trim() || step.caution?.trim() || step.description?.trim()) && (
                          <Button variant="ghost" size="sm" className="h-8 text-xs text-white hover:bg-zinc-800" onClick={() => handleSimplifyText(index)} disabled={simplifyingStepIndex === index}>
                            <Sparkles className="w-3 h-3 mr-1" />{simplifyingStepIndex === index ? 'Simplifying...' : 'Simplify'}
                          </Button>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeStep(index)} className="text-white hover:text-red-500 hover:bg-zinc-800"><Trash2 className="w-5 h-5" /></Button>
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden md:flex gap-4">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold">{step.step_number}</div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-zinc-800" onClick={() => moveStep(index, 'up')} disabled={index === 0}>▲</Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-zinc-800" onClick={() => moveStep(index, 'down')} disabled={index === formData.steps.length - 1}>▼</Button>
                      </div>
                      <div className="flex-1 space-y-3">
                        {(step.title?.trim() || step.caution?.trim() || step.description?.trim()) && (
                          <Button variant="outline" size="sm" className="bg-black border-zinc-700 text-white hover:bg-zinc-800" onClick={() => handleSimplifyText(index)} disabled={simplifyingStepIndex === index}>
                            <Sparkles className="w-4 h-4 mr-2" />{simplifyingStepIndex === index ? 'Simplifying...' : 'Simplify Step'}
                          </Button>
                        )}
                        <Input value={step.title} onChange={(e) => updateStep(index, 'title', e.target.value)} placeholder="Step title (optional)" className="h-8 bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600" />
                        <Textarea value={step.caution || ''} onChange={(e) => updateStep(index, 'caution', e.target.value)} placeholder="Caution statement (optional)" className="bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600" rows={2} />
                        <Textarea value={step.description} onChange={(e) => updateStep(index, 'description', e.target.value)} placeholder="Describe this step in detail..." className="bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600" rows={3} />
                        
                        {/* Per-step Materials */}
                        <div className="space-y-2">
                          {(step.materials || []).map((material, mIdx) => (
                            material.from_library ? (
                              <div key={mIdx} className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
                                <div className="flex-1 min-w-0">
                                  <span className="text-white text-xs font-medium">{material.name}</span>
                                  {material.partNum && <span className="text-gray-500 font-mono text-xs ml-2">{material.partNum}</span>}
                                  {material.supplier && <span className="text-gray-500 text-xs ml-2">{material.supplier}</span>}
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-500 hover:text-red-500 hover:bg-zinc-700 flex-shrink-0"
                                  onClick={() => removeStepMaterial(index, mIdx)}>
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <div key={mIdx} className="flex items-center gap-2">
                                <Input value={material.name || ''} onChange={(e) => updateStepMaterial(index, mIdx, 'name', e.target.value)}
                                  placeholder="Material name..." className="flex-1 h-7 bg-black border-zinc-700 text-xs text-white placeholder:text-gray-600" />
                                <Input value={material.location || ''} onChange={(e) => updateStepMaterial(index, mIdx, 'location', e.target.value)}
                                  placeholder="Location..." className="flex-1 h-7 bg-black border-zinc-700 text-xs text-white placeholder:text-gray-600" />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:text-red-500 hover:bg-zinc-800"
                                  onClick={() => removeStepMaterial(index, mIdx)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            )
                          ))}
                          <Button variant="outline" size="sm" onClick={() => setPartsBrowserStep(index)}
                            className="bg-black border-zinc-700 text-white hover:bg-zinc-800 h-7 text-xs">
                            <Plus className="w-3 h-3 mr-1" />Add Material
                          </Button>
                        </div>

                        {/* Images */}
                        <div>
                          {step.image_urls && step.image_urls.length > 0 ? (
                            <div className="flex gap-2 flex-wrap">
                              {step.image_urls.map((url, imgIndex) => (
                                <div key={imgIndex} className="relative inline-block">
                                  <img src={url} alt={`Step ${step.step_number} img ${imgIndex + 1}`} className="rounded-lg border max-h-20 object-cover" />
                                  <Button variant="destructive" size="sm" className="absolute top-1 right-1 h-6 text-xs"
                                    onClick={() => updateStep(index, 'image_urls', step.image_urls.filter((_, i) => i !== imgIndex))}>Remove</Button>
                                </div>
                              ))}
                              {step.image_urls.length < 3 && (
                                <>
                                  <input type="file" id={`img-d-${index}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleImageUpload(index, e.target.files[0]); }} />
                                  <Button variant="outline" size="sm" onClick={() => document.getElementById(`img-d-${index}`).click()} disabled={uploadingStepIndex === index}
                                    className="bg-black border-zinc-700 text-white hover:bg-zinc-800 h-20">
                                    <ImageIcon className="w-4 h-4 mr-1" />{uploadingStepIndex === index ? 'Uploading...' : `Add (${step.image_urls.length}/3)`}
                                  </Button>
                                </>
                              )}
                            </div>
                          ) : (
                            <>
                              <input type="file" id={`img-d-${index}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleImageUpload(index, e.target.files[0]); }} />
                              <Button variant="outline" onClick={() => document.getElementById(`img-d-${index}`).click()} disabled={uploadingStepIndex === index}
                                className="bg-black border-zinc-700 text-white hover:bg-zinc-800">
                                <ImageIcon className="w-4 h-4 mr-2" />{uploadingStepIndex === index ? 'Uploading...' : 'Choose Image'}
                              </Button>
                            </>
                          )}
                        </div>

                        {/* Step Variable */}
                        {(step.input_type === 'measurements' || step.input_type === 'time') && (
                          <MeasurementsInput
                            measurements={step.measurements || []}
                            onChange={(val) => updateStep(index, 'measurements', val)}
                            mode={step.input_type}
                          />
                        )}
                        {!step.input_type && (
                          <div className="flex justify-end">
                            <AddVariableMenu onSelect={(type) => updateStep(index, 'input_type', type)} />
                          </div>
                        )}

                        {/* Substeps */}
                        {step.substeps && step.substeps.length > 0 && (
                          <div className="mt-4 pl-8 space-y-3 border-l-2 border-zinc-700">
                            {step.substeps.map((substep, subIndex) => (
                              <div key={subIndex} className="bg-black rounded-lg border border-zinc-700 p-3">
                                <div className="flex items-start gap-3">
                                  <div className="flex-shrink-0 flex flex-col items-center gap-1">
                                    <div className="w-7 h-7 rounded-full bg-zinc-700 text-white flex items-center justify-center text-xs font-bold">{step.step_number}.{substep.substep_number}</div>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 text-white hover:bg-zinc-800 p-0" onClick={() => moveSubstep(index, subIndex, 'up')} disabled={subIndex === 0}>▲</Button>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 text-white hover:bg-zinc-800 p-0" onClick={() => moveSubstep(index, subIndex, 'down')} disabled={subIndex === step.substeps.length - 1}>▼</Button>
                                  </div>
                                  <div className="flex-1 space-y-2">
                                    {(substep.title?.trim() || substep.caution?.trim() || substep.description?.trim()) && (
                                      <Button variant="ghost" size="sm" className="h-6 text-xs text-white hover:bg-zinc-800" onClick={() => handleSimplifySubstepText(index, subIndex)} disabled={simplifyingSubstepIndex === `${index}-${subIndex}`}>
                                        <Sparkles className="w-3 h-3 mr-1" />{simplifyingSubstepIndex === `${index}-${subIndex}` ? 'Simplifying...' : 'Simplify'}
                                      </Button>
                                    )}
                                    <Input value={substep.title} onChange={(e) => updateSubstep(index, subIndex, 'title', e.target.value)} placeholder="Substep title (optional)" className="h-7 bg-zinc-900 border-zinc-600 text-xs text-white placeholder:text-gray-500" />
                                    <Textarea value={substep.caution || ''} onChange={(e) => updateSubstep(index, subIndex, 'caution', e.target.value)} placeholder="Caution statement (optional)" className="bg-zinc-900 border-zinc-600 text-xs text-white placeholder:text-gray-500" rows={1} />
                                    <Textarea value={substep.description} onChange={(e) => updateSubstep(index, subIndex, 'description', e.target.value)} placeholder="Describe this substep..." className="bg-zinc-900 border-zinc-600 text-xs text-white placeholder:text-gray-500" rows={2} />
                                    <div>
                                      {substep.image_urls && substep.image_urls.length > 0 ? (
                                        <div className="flex gap-1 flex-wrap mb-2">
                                          {substep.image_urls.map((url, imgIndex) => (
                                            <div key={imgIndex} className="relative inline-block">
                                              <img src={url} alt="" className="rounded-lg border max-h-16 object-cover" />
                                              <Button variant="destructive" size="sm" className="absolute top-0 right-0 h-5 text-xs"
                                                onClick={() => updateSubstep(index, subIndex, 'image_urls', substep.image_urls.filter((_, i) => i !== imgIndex))}>X</Button>
                                            </div>
                                          ))}
                                          {substep.image_urls.length < 3 && (
                                            <>
                                              <input type="file" id={`simg-d-${index}-${subIndex}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleSubstepImageUpload(index, subIndex, e.target.files[0]); }} />
                                              <Button variant="outline" size="sm" onClick={() => document.getElementById(`simg-d-${index}-${subIndex}`).click()} disabled={uploadingSubstepIndex === `${index}-${subIndex}`}
                                                className="bg-zinc-900 border-zinc-600 text-white hover:bg-zinc-800 h-7 text-xs"><ImageIcon className="w-3 h-3 mr-1" />+</Button>
                                            </>
                                          )}
                                        </div>
                                      ) : (
                                        <>
                                          <input type="file" id={`simg-d-${index}-${subIndex}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleSubstepImageUpload(index, subIndex, e.target.files[0]); }} />
                                          <Button variant="outline" size="sm" onClick={() => document.getElementById(`simg-d-${index}-${subIndex}`).click()} disabled={uploadingSubstepIndex === `${index}-${subIndex}`}
                                            className="bg-zinc-900 border-zinc-600 text-white hover:bg-zinc-800 h-7 text-xs"><ImageIcon className="w-3 h-3 mr-1" />{uploadingSubstepIndex === `${index}-${subIndex}` ? 'Uploading...' : 'Image'}</Button>
                                        </>
                                      )}
                                    </div>
                                    {/* Substep Variable */}
                                    {(substep.input_type === 'measurements' || substep.input_type === 'time') && (
                                      <MeasurementsInput
                                        measurements={substep.measurements || []}
                                        onChange={(val) => updateSubstep(index, subIndex, 'measurements', val)}
                                        mode={substep.input_type}
                                      />
                                    )}
                                    {!substep.input_type && (
                                      <div className="flex justify-end">
                                        <AddVariableMenu onSelect={(type) => updateSubstep(index, subIndex, 'input_type', type)} className="h-6" />
                                      </div>
                                    )}
                                  </div>
                                  <Button variant="ghost" size="icon" onClick={() => removeSubstep(index, subIndex)} className="h-7 w-7 text-white hover:text-red-500 hover:bg-zinc-800"><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <Button variant="outline" size="sm" onClick={() => addSubstep(index)} className="mt-3 bg-black border-zinc-700 text-white hover:bg-zinc-800">
                          <Plus className="w-3 h-3 mr-1" />Add Substep
                        </Button>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeStep(index)} className="text-white hover:text-red-500 hover:bg-zinc-800"><Trash2 className="w-5 h-5" /></Button>
                    </div>

                    {/* Mobile content */}
                    <div className="md:hidden space-y-3">
                      <Input value={step.title} onChange={(e) => updateStep(index, 'title', e.target.value)} placeholder="Step title (optional)" className="h-8 bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600" />
                      <Textarea value={step.caution || ''} onChange={(e) => updateStep(index, 'caution', e.target.value)} placeholder="Caution statement (optional)" className="bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600" rows={2} />
                      <Textarea value={step.description} onChange={(e) => updateStep(index, 'description', e.target.value)} placeholder="Describe this step in detail..." className="bg-black border-zinc-700 text-sm text-white placeholder:text-gray-600" rows={3} />

                      {/* Per-step Materials (mobile) */}
                      <div className="space-y-2">
                        {(step.materials || []).map((material, mIdx) => (
                          material.from_library ? (
                            <div key={mIdx} className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <span className="text-white text-xs font-medium">{material.name}</span>
                                {material.partNum && <span className="text-gray-500 font-mono text-xs ml-2">{material.partNum}</span>}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={() => decrementLibraryPart(index, material.name)}
                                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-xs flex items-center justify-center leading-none">−</button>
                                <span className="text-white text-xs font-medium w-5 text-center">{material.qty || 1}</span>
                                <button onClick={() => addLibraryPart(index, material)}
                                  className="w-5 h-5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-xs flex items-center justify-center leading-none">+</button>
                              </div>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-500 hover:text-red-500 hover:bg-zinc-700 flex-shrink-0"
                                onClick={() => removeStepMaterial(index, mIdx)}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <div key={mIdx} className="flex items-center gap-2">
                              <Input value={material.name || ''} onChange={(e) => updateStepMaterial(index, mIdx, 'name', e.target.value)}
                                placeholder="Material name..." className="flex-1 h-7 bg-black border-zinc-700 text-xs text-white placeholder:text-gray-600" />
                              <Input value={material.location || ''} onChange={(e) => updateStepMaterial(index, mIdx, 'location', e.target.value)}
                                placeholder="Location..." className="w-24 h-7 bg-black border-zinc-700 text-xs text-white placeholder:text-gray-600" />
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-white hover:text-red-500 hover:bg-zinc-800"
                                onClick={() => removeStepMaterial(index, mIdx)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )
                        ))}
                        <Button variant="outline" size="sm" onClick={() => setPartsBrowserStep(index)}
                          className="bg-black border-zinc-700 text-white hover:bg-zinc-800 h-7 text-xs">
                          <Plus className="w-3 h-3 mr-1" />Add Material
                        </Button>
                      </div>

                      <div>
                        {step.image_urls && step.image_urls.length > 0 ? (
                          <div className="flex gap-2 flex-wrap">
                            {step.image_urls.map((url, imgIndex) => (
                              <div key={imgIndex} className="relative inline-block">
                                <img src={url} alt="" className="rounded-lg border max-h-20 object-cover" />
                                <Button variant="destructive" size="sm" className="absolute top-1 right-1 h-6 text-xs"
                                  onClick={() => updateStep(index, 'image_urls', step.image_urls.filter((_, i) => i !== imgIndex))}>Remove</Button>
                              </div>
                            ))}
                            {step.image_urls.length < 3 && (
                              <>
                                <input type="file" id={`img-m-${index}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleImageUpload(index, e.target.files[0]); }} />
                                <Button variant="outline" size="sm" onClick={() => document.getElementById(`img-m-${index}`).click()} disabled={uploadingStepIndex === index}
                                  className="bg-black border-zinc-700 text-white hover:bg-zinc-800 h-20">
                                  <ImageIcon className="w-4 h-4 mr-1" />{uploadingStepIndex === index ? 'Uploading...' : `Add (${step.image_urls.length}/3)`}
                                </Button>
                              </>
                            )}
                          </div>
                        ) : (
                          <>
                            <input type="file" id={`img-m-${index}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleImageUpload(index, e.target.files[0]); }} />
                            <Button variant="outline" onClick={() => document.getElementById(`img-m-${index}`).click()} disabled={uploadingStepIndex === index}
                              className="w-full bg-black border-zinc-700 text-white hover:bg-zinc-800">
                              <ImageIcon className="w-4 h-4 mr-2" />{uploadingStepIndex === index ? 'Uploading...' : 'Choose Image'}
                            </Button>
                          </>
                        )}
                      </div>

                      {step.substeps && step.substeps.length > 0 && (
                        <div className="mt-4 pl-4 space-y-3 border-l-2 border-zinc-700">
                          {step.substeps.map((substep, subIndex) => (
                            <div key={subIndex} className="bg-black rounded-lg border border-zinc-700 p-3">
                              <div className="flex items-start justify-between mb-3 gap-2">
                                <div className="flex items-start gap-2">
                                  <div className="flex flex-col items-center gap-1">
                                    <div className="w-7 h-7 rounded-full bg-zinc-700 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">{step.step_number}.{substep.substep_number}</div>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 text-white hover:bg-zinc-800 p-0" onClick={() => moveSubstep(index, subIndex, 'up')} disabled={subIndex === 0}>▲</Button>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 text-white hover:bg-zinc-800 p-0" onClick={() => moveSubstep(index, subIndex, 'down')} disabled={subIndex === step.substeps.length - 1}>▼</Button>
                                  </div>
                                  {(substep.title?.trim() || substep.caution?.trim() || substep.description?.trim()) && (
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-white hover:bg-zinc-800 mt-1" onClick={() => handleSimplifySubstepText(index, subIndex)} disabled={simplifyingSubstepIndex === `${index}-${subIndex}`}>
                                      <Sparkles className="w-3 h-3 mr-1" />{simplifyingSubstepIndex === `${index}-${subIndex}` ? 'Simplifying...' : 'Simplify'}
                                    </Button>
                                  )}
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => removeSubstep(index, subIndex)} className="h-7 w-7 text-white hover:text-red-500 hover:bg-zinc-800 flex-shrink-0"><Trash2 className="w-4 h-4" /></Button>
                              </div>
                              <div className="space-y-2 pl-9">
                                <Input value={substep.title} onChange={(e) => updateSubstep(index, subIndex, 'title', e.target.value)} placeholder="Substep title (optional)" className="h-7 bg-zinc-900 border-zinc-600 text-xs text-white placeholder:text-gray-500" />
                                <Textarea value={substep.caution || ''} onChange={(e) => updateSubstep(index, subIndex, 'caution', e.target.value)} placeholder="Caution statement (optional)" className="bg-zinc-900 border-zinc-600 text-xs text-white placeholder:text-gray-500" rows={2} />
                                <Textarea value={substep.description} onChange={(e) => updateSubstep(index, subIndex, 'description', e.target.value)} placeholder="Describe this substep..." className="bg-zinc-900 border-zinc-600 text-xs text-white placeholder:text-gray-500" rows={2} />
                                <div>
                                  {substep.image_urls && substep.image_urls.length > 0 ? (
                                    <div className="flex gap-1 flex-wrap mb-2">
                                      {substep.image_urls.map((url, imgIndex) => (
                                        <div key={imgIndex} className="relative inline-block">
                                          <img src={url} alt="" className="rounded-lg border max-h-16 object-cover" />
                                          <Button variant="destructive" size="sm" className="absolute top-0 right-0 h-5 text-xs"
                                            onClick={() => updateSubstep(index, subIndex, 'image_urls', substep.image_urls.filter((_, i) => i !== imgIndex))}>X</Button>
                                        </div>
                                      ))}
                                      {substep.image_urls.length < 3 && (
                                        <>
                                          <input type="file" id={`simg-m-${index}-${subIndex}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleSubstepImageUpload(index, subIndex, e.target.files[0]); }} />
                                          <Button variant="outline" size="sm" onClick={() => document.getElementById(`simg-m-${index}-${subIndex}`).click()} disabled={uploadingSubstepIndex === `${index}-${subIndex}`}
                                            className="bg-zinc-900 border-zinc-600 text-white hover:bg-zinc-800 h-7 text-xs"><ImageIcon className="w-3 h-3 mr-1" />+</Button>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    <>
                                      <input type="file" id={`simg-m-${index}-${subIndex}`} accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleSubstepImageUpload(index, subIndex, e.target.files[0]); }} />
                                      <Button variant="outline" size="sm" onClick={() => document.getElementById(`simg-m-${index}-${subIndex}`).click()} disabled={uploadingSubstepIndex === `${index}-${subIndex}`}
                                        className="w-full bg-zinc-900 border-zinc-600 text-white hover:bg-zinc-800 h-8 text-xs"><ImageIcon className="w-3 h-3 mr-1" />{uploadingSubstepIndex === `${index}-${subIndex}` ? 'Uploading...' : 'Choose Image'}</Button>
                                    </>
                                  )}
                                </div>
                                {(substep.input_type === 'measurements' || substep.input_type === 'time') && (
                                  <MeasurementsInput
                                    measurements={substep.measurements || []}
                                    onChange={(val) => updateSubstep(index, subIndex, 'measurements', val)}
                                    mode={substep.input_type}
                                  />
                                )}
                                {!substep.input_type && (
                                  <div className="flex justify-end">
                                    <AddVariableMenu onSelect={(type) => updateSubstep(index, subIndex, 'input_type', type)} className="h-6" />
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Mobile step variable */}
                      {(step.input_type === 'measurements' || step.input_type === 'time') && (
                        <MeasurementsInput
                          measurements={step.measurements || []}
                          onChange={(val) => updateStep(index, 'measurements', val)}
                          mode={step.input_type}
                        />
                      )}
                      {!step.input_type && (
                        <div className="flex justify-end">
                          <AddVariableMenu onSelect={(type) => updateStep(index, 'input_type', type)} />
                        </div>
                      )}
                      <Button variant="outline" size="sm" onClick={() => addSubstep(index)} className="mt-3 bg-black border-zinc-700 text-white hover:bg-zinc-800 w-full">
                        <Plus className="w-3 h-3 mr-1" />Add Substep
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <Button variant="outline" size="sm" onClick={() => insertStepAt(index + 1)}
                  className="w-full bg-black border-zinc-700 text-white hover:bg-zinc-800 border-dashed">
                  <Plus className="w-4 h-4 mr-2" />Insert Step Here
                </Button>
              </React.Fragment>
            ))}

            {formData.steps.length === 0 && (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardContent className="py-12 text-center">
                  <p className="text-gray-400 mb-4">No steps added yet</p>
                  <Button onClick={addStep} className="bg-white text-black hover:bg-gray-200 font-semibold">
                    <Plus className="w-4 h-4 mr-2" />Add Your First Step
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Delete Button — only when editing */}
      {isEditing && (
        <div className="max-w-5xl mx-auto px-6 pb-12">
          <div className="border-t border-zinc-800 pt-8 flex justify-center">
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(true)}
              className="text-red-500 hover:text-red-400 hover:bg-red-500/10 border border-red-500/30"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete This SOP
            </Button>
          </div>
        </div>
      )}


      {/* New Department Dialog */}
      <AlertDialog open={showNewDeptDialog} onOpenChange={setShowNewDeptDialog}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">New Department</AlertDialogTitle>
            <AlertDialogDescription>Enter a name for the new department.</AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={newDeptName}
            onChange={e => setNewDeptName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateDept(); }}
            placeholder="Department name..."
            className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-white placeholder:text-gray-600 focus:outline-none focus:border-zinc-500"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNewDeptName('')} className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCreateDept}
              disabled={createDeptMutation.isPending}
              className="bg-white text-black hover:bg-gray-200"
            >
              {createDeptMutation.isPending ? 'Creating...' : 'Create'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete SOP?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete "{formData.title}". This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Parts Browser Sheet */}
      {partsBrowserStep !== null && (
        <PartsBrowserSheet
          materials={formData.steps[partsBrowserStep]?.materials || []}
          onAdd={(part) => addLibraryPart(partsBrowserStep, part)}
          onDecrement={(partName) => decrementLibraryPart(partsBrowserStep, partName)}
          onClose={() => setPartsBrowserStep(null)}
        />
      )}

      {/* Exit Dialog */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes before leaving?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved changes. Do you want to save before leaving?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleExitWithoutSaving}>Leave without saving</AlertDialogCancel>
            <AlertDialogAction onClick={handleSave} className="bg-white text-black hover:bg-gray-200">Save and exit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}