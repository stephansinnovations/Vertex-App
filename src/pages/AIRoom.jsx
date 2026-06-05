import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Edit2, Check, MessageCircle, ArrowLeft } from 'lucide-react';
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

export default function AIRoom() {
  const navigate = useNavigate();
  const { open: openChat } = useVertexChat();
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [form, setForm] = useState({ name: '', emoji: '🤖', description: '', prompt: '' });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

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
    setSelectedAgent(null);
    await loadAgents();
  };

  const handleChat = (agent) => {
    if (agent.is_default) {
      openChat(null, null, null);
    } else {
      openChat(agent.prompt, agent.name, agent.emoji);
    }
    setSelectedAgent(null);
  };

  const allAgents = [DEFAULT_AGENT, ...agents];

  // Arrange bubbles in a centered grid
  const COLS = 3;
  const COL_W = 110;
  const ROW_H = 130;
  const totalW = COLS * COL_W;
  const bubblePositions = allAgents.map((_, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const offset = row % 2 === 1 ? COL_W / 2 : 0;
    return { x: col * COL_W + offset, y: row * ROW_H };
  });
  const totalH = Math.ceil(allAgents.length / COLS) * ROW_H + 120;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white">AI Room</h1>
        <button
          onClick={() => { setEditingAgent(null); setForm({ name: '', emoji: '🤖', description: '', prompt: '' }); setShowForm(true); }}
          className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Bubble Room */}
      <div className="flex-1 relative overflow-auto" style={{ minHeight: totalH + 80 }}>
        <div className="relative mx-auto" style={{ width: totalW, height: totalH }}>
          {allAgents.map((agent, i) => {
            const pos = bubblePositions[i];
            return (
              <motion.div
                key={agent.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 20 }}
                style={{ position: 'absolute', left: pos.x, top: pos.y }}
                className="flex flex-col items-center gap-2"
              >
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                  className="relative"
                >
                  {/* Glow ring when selected */}
                  {selectedAgent?.id === agent.id && (
                    <motion.div
                      layoutId="glow"
                      className="absolute inset-0 rounded-full"
                      style={{ boxShadow: '0 0 0 3px rgba(255,255,255,0.5)', borderRadius: '50%', margin: -3 }}
                    />
                  )}
                  {/* Bubble */}
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center
                    ${agent.is_default
                      ? 'bg-zinc-900 border-2 border-zinc-700'
                      : 'bg-zinc-800 border-2 border-zinc-700'}
                    shadow-lg transition-all duration-200
                    ${selectedAgent?.id === agent.id ? 'border-white/50' : ''}
                  `}>
                    {agent.is_default ? (
                      <img src={vertexLogo} alt="Vertex" className="w-12 h-12 object-contain rounded-xl" />
                    ) : (
                      <span className="text-3xl">{agent.emoji}</span>
                    )}
                  </div>
                </motion.button>
                <span className="text-white text-xs font-medium text-center max-w-[90px] leading-tight">
                  {agent.name}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Agent Action Panel */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl p-6 z-50"
          >
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
                {selectedAgent.is_default
                  ? <img src={vertexLogo} className="w-9 h-9 object-contain rounded-xl" />
                  : <span className="text-3xl">{selectedAgent.emoji}</span>
                }
              </div>
              <div className="flex-1">
                <p className="text-white font-bold text-lg">{selectedAgent.name}</p>
                {selectedAgent.description && <p className="text-gray-500 text-sm">{selectedAgent.description}</p>}
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={() => handleChat(selectedAgent)}
              className="w-full bg-white text-black font-bold py-3.5 rounded-xl text-base flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors mb-3"
            >
              <MessageCircle className="w-5 h-5" />
              Chat with {selectedAgent.name}
            </button>

            {!selectedAgent.is_default && (
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setEditingAgent(selectedAgent);
                    setForm({ name: selectedAgent.name, emoji: selectedAgent.emoji, description: selectedAgent.description || '', prompt: selectedAgent.prompt });
                    setSelectedAgent(null);
                    setShowForm(true);
                  }}
                  className="flex-1 bg-zinc-800 text-white py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-zinc-700 transition-colors"
                >
                  <Edit2 className="w-4 h-4" /> Edit
                </button>
                <button
                  onClick={() => handleDelete(selectedAgent.id)}
                  className="flex-1 bg-red-900/40 text-red-400 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-red-900/60 transition-colors"
                >
                  <X className="w-4 h-4" /> Delete
                </button>
              </div>
            )}
          </motion.div>
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

              {/* Emoji */}
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
                <label className="text-xs text-gray-400 mb-1.5 block">System Prompt * <span className="text-gray-600">(how this AI behaves)</span></label>
                <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="You are Elon Musk. Respond with his direct, first-principles thinking style..."
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
    </div>
  );
}
