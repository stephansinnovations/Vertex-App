import React, { useState, useEffect } from 'react';
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
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [longPressAgent, setLongPressAgent] = useState(null);
  const [form, setForm] = useState({ name: '', emoji: '🤖', description: '', prompt: '' });
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

  useEffect(() => { loadAgents(); }, []);

  const loadAgents = async () => {
    try {
      const { data } = await supabase.from('ai_agents').select('*').order('created_at');
      setAgents(data || []);
    } catch { setAgents([]); }
  };

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

  // Single tap → open chat directly
  const handleTap = (agent) => {
    setTappedId(agent.id);
    setTimeout(() => {
      setTappedId(null);
      openChat(agent.is_default ? null : agent.prompt, agent.is_default ? null : agent.name, agent.is_default ? null : agent.emoji, true);
    }, 180);
  };

  // Long press → show edit/delete
  let pressTimer = null;
  const handlePressStart = (agent) => {
    pressTimer = setTimeout(() => setLongPressAgent(agent), 500);
  };
  const handlePressEnd = () => {
    if (pressTimer) clearTimeout(pressTimer);
  };

  const allAgents = [DEFAULT_AGENT, ...agents];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #000 70%)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white tracking-widest uppercase opacity-60">AI Room</h1>
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

      {/* Bubble Grid */}
      <div className="flex-1 flex flex-wrap justify-center gap-10 px-8 pt-10 pb-32 relative z-10">
        {allAgents.map((agent, i) => (
          <motion.div
            key={agent.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 260, damping: 18 }}
            className="flex flex-col items-center gap-3"
          >
            <motion.div
              animate={tappedId === agent.id ? { scale: 0.88 } : breathe.animate}
              onPointerDown={() => handlePressStart(agent)}
              onPointerUp={() => { handlePressEnd(); }}
              onPointerLeave={handlePressEnd}
              onClick={() => handleTap(agent)}
              className="relative cursor-pointer select-none"
              style={{ touchAction: 'none' }}
            >
              {/* Outer glow ring */}
              <motion.div
                className="absolute inset-0 rounded-full"
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 2.5 + i * 0.3, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  background: agent.is_default
                    ? 'radial-gradient(circle, rgba(139,92,246,0.4), transparent)'
                    : 'radial-gradient(circle, rgba(255,255,255,0.15), transparent)',
                  margin: -12,
                  borderRadius: '50%',
                  filter: 'blur(8px)',
                }}
              />

              {/* Main bubble */}
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center relative overflow-hidden"
                style={{
                  background: agent.is_default
                    ? 'radial-gradient(circle at 35% 35%, #3b1f8c, #1a0a4a)'
                    : 'radial-gradient(circle at 35% 35%, #2a2a2a, #111)',
                  boxShadow: agent.is_default
                    ? '0 0 30px rgba(139,92,246,0.4), inset 0 1px 0 rgba(255,255,255,0.1)'
                    : '0 0 20px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                {/* Shine */}
                <div className="absolute top-2 left-3 w-6 h-3 rounded-full opacity-20"
                  style={{ background: 'linear-gradient(135deg, white, transparent)' }} />

                {agent.is_default ? (
                  <img src={vertexLogo} alt="Vertex" className="w-14 h-14 object-contain" />
                ) : (
                  <span className="text-4xl">{agent.emoji}</span>
                )}
              </div>
            </motion.div>

            {/* Name */}
            <span className="text-white/70 text-xs font-medium text-center tracking-wide max-w-[90px] leading-tight">
              {agent.name}
            </span>

            {/* Presence dot */}
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-green-400"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Long press context menu */}
      <AnimatePresence>
        {longPressAgent && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40" onClick={() => setLongPressAgent(null)} />
            <motion.div
              initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl p-6 z-50"
            >
              <div className="flex items-center gap-4 mb-5">
                <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">
                  {longPressAgent.emoji}
                </div>
                <div>
                  <p className="text-white font-bold">{longPressAgent.name}</p>
                  <p className="text-gray-500 text-sm">{longPressAgent.description}</p>
                </div>
                <button onClick={() => setLongPressAgent(null)} className="ml-auto text-gray-500"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setEditingAgent(longPressAgent); setForm({ name: longPressAgent.name, emoji: longPressAgent.emoji, description: longPressAgent.description || '', prompt: longPressAgent.prompt }); setLongPressAgent(null); setShowForm(true); }}
                  className="flex-1 bg-zinc-800 text-white py-3 rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-zinc-700"
                >
                  <Edit2 className="w-4 h-4" /> Edit
                </button>
                <button
                  onClick={() => setConfirmDeleteId(longPressAgent.id)}
                  className="flex-1 bg-red-900/40 text-red-400 py-3 rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-red-900/60"
                >
                  <X className="w-4 h-4" /> Delete
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
                className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40">
                {editingAgent ? 'Save Changes' : 'Create Agent'}
              </button>
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
    </div>
  );
}
