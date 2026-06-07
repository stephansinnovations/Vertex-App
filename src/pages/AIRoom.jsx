import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Edit2, ArrowLeft, Sparkles } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useVertexChat } from '@/lib/VertexChatContext';
import { motion, AnimatePresence } from 'framer-motion';
import vertexLogo from '@/assets/Vertex-logo.webp';

const EMOJI_OPTIONS = ['🤖','🧠','💡','🔧','⚡','🚐','📐','📊','🦁','🎯','🔥','🌊','🏔️','🧬','🎸','🚀','👔','🦅','💼','🎓','🧑‍🔬','🧑‍💻','🎤','📚'];

const DEFAULT_AGENT = {
  id: 'default',
  name: 'Vertex AI',
  emoji: null,
  description: 'Your van build assistant',
  prompt: null,
  is_default: true,
};

// Subtle breathing animation for bubbles
const breathe = {
  animate: {
    scale: [1, 1.04, 1],
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
  },
};

export default function AIRoom() {
  const navigate = useNavigate();
  const { open: openChat } = useVertexChat();
  const roomId = new URLSearchParams(window.location.search).get('room');
  const [roomInfo, setRoomInfo] = useState(null);
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [longPressAgent, setLongPressAgent] = useState(null);
  const [form, setForm] = useState({ name: '', emoji: '🤖', description: '', prompt: '' });
  const [pinchZooming, setPinchZooming] = useState(false);
  const pinchStartDist = useRef(null);
  const containerRef = useRef(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [prevPrompt, setPrevPrompt] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleGeneratePrompt = async () => {
    if (!form.name.trim()) return;
    setGeneratingPrompt(true);
    try {
      const isLocalhost = window.location.hostname === 'localhost';
      const url = isLocalhost ? '/api/claude/v1/messages' : 'https://api.anthropic.com/v1/messages';
      const headers = { 'content-type': 'application/json' };
      if (!isLocalhost) {
        const { getSetting } = await import('@/api/appSettings');
        const key = (await getSetting('anthropicApiKey')) || localStorage.getItem('anthropicApiKey');
        if (key) {
          headers['x-api-key'] = key;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
        }
      }
      const context = [form.name, form.description, form.prompt].filter(Boolean).join(' — ');
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `Write a detailed system prompt for an AI agent with this description: "${context}".
The prompt should define the AI's personality, expertise, tone, and how it responds.
Keep it under 200 words. Be specific and vivid. Write in second person ("You are...").
Return ONLY the prompt text, nothing else.`
          }]
        })
      });
      const data = await res.json();
      const generated = data.content?.[0]?.text;
      if (generated) {
        setPrevPrompt(form.prompt);
        setForm(f => ({ ...f, prompt: generated.trim() }));
      }
    } catch {}
    finally { setGeneratingPrompt(false); }
  };
  const [tappedId, setTappedId] = useState(null);

  useEffect(() => { loadAgents(); }, [roomId]);

  const loadAgents = async () => {
    try {
      // Load room info
      if (roomId) {
        const { data: room } = await supabase.from('ai_rooms').select('*').eq('id', roomId).single();
        setRoomInfo(room);
      }
      // Load agents for this room
      let query = supabase.from('ai_agents').select('*').order('created_at');
      if (roomId) query = query.eq('room_id', roomId);
      const { data } = await query;
      setAgents(data || []);
    } catch { setAgents([]); }
  };

  // Pinch to zoom out → go to RoomsView
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist.current = Math.hypot(dx, dy);
    }
  };
  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && pinchStartDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStartDist.current - dist > 60) {
        pinchStartDist.current = null;
        setPinchZooming(true);
        setTimeout(() => navigate('/Rooms'), 400);
      }
    }
  };
  const handleTouchEnd = () => { pinchStartDist.current = null; };

  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    try {
      if (editingAgent) {
        await supabase.from('ai_agents').update({
          name: form.name.trim(), emoji: form.emoji,
          description: form.description.trim(), prompt: form.prompt.trim(),
        }).eq('id', editingAgent.id);
      } else {
        await supabase.from('ai_agents').insert({
          name: form.name.trim(), emoji: form.emoji,
          description: form.description.trim(), prompt: form.prompt.trim(),
          room_id: roomId || null,
        });
      }
      await loadAgents();
      setShowForm(false);
      setEditingAgent(null);
      setForm({ name: '', emoji: '🤖', description: '', prompt: '' });
    } catch { alert('Failed to save. Make sure the ai_agents table exists in Supabase.'); }
  };

  const handleDelete = async (id) => {
    await supabase.from('ai_agents').delete().eq('id', id);
    setLongPressAgent(null);
    await loadAgents();
  };

  // Single tap → open chat or go home
  const handleTap = (agent) => {
    if (agent.is_default) {
      navigate('/');
      return;
    }
    setTappedId(agent.id);
    setTimeout(() => {
      setTappedId(null);
      openChat(agent.prompt, agent.name, agent.emoji, true);
    }, 180);
  };

  // Long press → open edit form directly
  let pressTimer = null;
  const handlePressStart = (agent) => {
    if (agent.is_default) return;
    pressTimer = setTimeout(() => {
      setEditingAgent(agent);
      setForm({ name: agent.name, emoji: agent.emoji, description: agent.description || '', prompt: agent.prompt });
      setShowForm(true);
    }, 500);
  };
  const handlePressEnd = () => {
    if (pressTimer) clearTimeout(pressTimer);
  };

  const orbitAgents = agents; // custom agents only — Vertex is center

  const ORBIT_R = 140;
  const getOrbitPos = (index, total) => {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    return {
      x: Math.cos(angle) * ORBIT_R,
      y: Math.sin(angle) * ORBIT_R,
    };
  };

  return (
    <motion.div
      ref={containerRef}
      className="min-h-screen flex flex-col"
      style={{ background: 'radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #000 70%)' }}
      animate={pinchZooming ? { scale: 0.3, opacity: 0 } : { scale: 1, opacity: 1 }}
      transition={{ duration: 0.35, ease: 'easeInOut' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <button onClick={() => navigate('/Rooms')} className="text-gray-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white tracking-widest uppercase opacity-60">
          {roomInfo?.name || 'Vertex Room'}
        </h1>
        <button
          onClick={() => { setEditingAgent(null); setForm({ name: '', emoji: '🤖', description: '', prompt: '' }); setShowForm(true); }}
          className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Ambient fog */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-64 h-64 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)', filter: 'blur(60px)' }} />
        <div className="absolute top-1/2 right-1/4 w-48 h-48 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #a78bfa, transparent)', filter: 'blur(50px)' }} />
      </div>

      {/* Orbital Layout — centered in remaining space */}
      <div className="flex-1 flex items-center justify-center z-10">
        <div className="relative flex items-center justify-center"
          style={{ width: '100%', height: ORBIT_R * 2 + 120 }}>

          {/* Orbit ring */}
          {orbitAgents.length > 0 && (
            <div className="absolute rounded-full border border-white/5 pointer-events-none"
              style={{ width: ORBIT_R * 2, height: ORBIT_R * 2, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          )}

          {/* Orbit agents */}
          {orbitAgents.map((agent, i) => {
            const pos = getOrbitPos(i, orbitAgents.length);
            return (
              <motion.div
                key={agent.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 + i * 0.1, type: 'spring', stiffness: 260, damping: 18 }}
                className="absolute flex flex-col items-center gap-1.5"
                style={{ left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)`, transform: 'translate(-50%, -50%)' }}
              >
                <motion.div
                  animate={tappedId === agent.id ? { scale: 0.88 } : { scale: [1, 1.04, 1] }}
                  transition={tappedId === agent.id ? {} : { duration: 3 + i * 0.5, repeat: Infinity, ease: 'easeInOut' }}
                  onPointerDown={() => handlePressStart(agent)}
                  onPointerUp={handlePressEnd}
                  onPointerLeave={handlePressEnd}
                  onClick={() => handleTap(agent)}
                  className="relative cursor-pointer select-none"
                  style={{ touchAction: 'none' }}
                >
                  <motion.div className="absolute inset-0 rounded-full"
                    animate={{ opacity: [0.2, 0.5, 0.2] }}
                    transition={{ duration: 2.5 + i * 0.3, repeat: Infinity }}
                    style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.15), transparent)', margin: -10, filter: 'blur(6px)' }}
                  />
                  <div className="w-24 h-24 rounded-full flex items-center justify-center relative"
                    style={{
                      background: 'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.25), rgba(255,255,255,0.08))',
                      boxShadow: '0 6px 24px rgba(0,0,0,0.3), inset 0 1.5px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.15)',
                      border: '0.5px solid rgba(255,255,255,0.4)',
                    }}>
                    <span className="text-4xl">{agent.emoji}</span>
                  </div>
                </motion.div>
                <span className="text-[11px] font-medium text-center leading-tight max-w-[80px]"
                  style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', letterSpacing: 0.1 }}>
                  {agent.name}
                </span>
              </motion.div>
            );
          })}

          {/* Center — Vertex App (opens AI Rooms) */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="absolute flex flex-col items-center gap-2"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          >
            <motion.div
              animate={tappedId === 'default' ? { scale: 0.92 } : { scale: [1, 1.05, 1] }}
              transition={tappedId === 'default' ? {} : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              onClick={() => navigate('/')}
              className="relative cursor-pointer select-none"
              style={{ touchAction: 'none' }}
            >
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{ opacity: [0.3, 0.8, 0.3], scale: [1, 1.2, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.5), transparent)', margin: -20, filter: 'blur(16px)' }}
              />
              <div className="w-16 h-16 rounded-full flex items-center justify-center relative"
                style={{
                  background: 'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.3), rgba(139,92,246,0.2))',
                  boxShadow: '0 8px 32px rgba(139,92,246,0.45), inset 0 2px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(0,0,0,0.15)',
                  border: '0.5px solid rgba(255,255,255,0.5)',
                }}>
                <img src={vertexLogo} alt="Vertex" className="w-10 h-10 object-contain" />
              </div>
            </motion.div>
            <span className="text-white/80 text-xs font-semibold tracking-widest uppercase">Vertex App</span>
            <motion.div className="w-1.5 h-1.5 rounded-full bg-green-400"
              animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }} />
          </motion.div>


        </div>
      </div>


      {/* Add/Edit Form */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowForm(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl z-50 p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-white">{editingAgent ? 'Edit Agent' : 'New Agent'}</h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-2 block">Avatar</label>
                <button onClick={() => setShowEmojiPicker(v => !v)}
                  className="w-16 h-16 rounded-full bg-zinc-800 border-2 border-zinc-700 flex items-center justify-center text-3xl hover:bg-zinc-700 transition-colors">
                  {form.emoji}
                </button>
                {showEmojiPicker && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} onClick={() => { setForm(f => ({ ...f, emoji: e })); setShowEmojiPicker(false); }}
                        className={`w-10 h-10 rounded-full text-xl flex items-center justify-center transition-colors ${form.emoji === e ? 'bg-white/20' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1.5 block">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Elon Musk, Formula Expert..."
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
              </div>

              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1.5 block">Short Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Gives Elon Musk-style opinions"
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500" />
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-400">System Prompt * <span className="text-gray-600">(how this AI behaves)</span></label>
                  <div className="flex items-center gap-2">
                    {prevPrompt !== null && (
                      <button
                        onClick={() => { setForm(f => ({ ...f, prompt: prevPrompt })); setPrevPrompt(null); }}
                        className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800"
                      >
                        Undo
                      </button>
                    )}
                    <button
                      onClick={handleGeneratePrompt}
                      disabled={!form.name.trim() || generatingPrompt}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-lg transition-all disabled:opacity-40"
                      style={{ background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
                    >
                      <Sparkles className="w-3 h-3" />
                      {generatingPrompt ? 'Generating...' : 'Generate Prompt'}
                    </button>
                  </div>
                </div>
                <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="Describe your AI or click Generate Prompt after filling in the name..."
                  rows={5}
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500 resize-none" />
              </div>

              <button onClick={handleSave} disabled={!form.name.trim() || !form.prompt.trim()}
                className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40 mb-3">
                {editingAgent ? 'Save Changes' : 'Create Agent'}
              </button>

              {editingAgent && (
                <button
                  onClick={() => { setConfirmDeleteId(editingAgent.id); setShowForm(false); }}
                  className="w-full flex items-center justify-center gap-2 bg-red-900/20 border border-red-900/40 text-red-400 font-medium py-3 rounded-xl hover:bg-red-900/40 transition-colors text-sm"
                >
                  <X className="w-4 h-4" /> Delete Agent
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {confirmDeleteId && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50"
              onClick={() => setConfirmDeleteId(null)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-x-8 z-50 bg-zinc-900 border border-zinc-800 rounded-2xl p-6"
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            >
              <h3 className="text-white font-bold text-lg mb-2">Delete Agent?</h3>
              <p className="text-gray-400 text-sm mb-6">This will permanently delete this AI agent and all its chat history. This can't be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 bg-zinc-800 text-white py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                  className="flex-1 bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
