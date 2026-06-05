import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Edit2, Check, X, MessageCircle } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useVertexChat } from '@/lib/VertexChatContext';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_AGENTS = [
  {
    id: 'default',
    name: 'Vertex AI',
    emoji: '🤖',
    description: 'Your van build shop assistant',
    prompt: null, // uses the default system prompt
    is_default: true,
  },
];

const EMOJI_OPTIONS = ['🤖','🧠','💡','🔧','⚡','🚐','📐','📊','🦁','🎯','🔥','🌊','🏔️','🧬','🎸','🚀','👔','🦅','💼','🎓'];

export default function AIRoom() {
  const navigate = useNavigate();
  const { open: openChat } = useVertexChat();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [form, setForm] = useState({ name: '', emoji: '🤖', description: '', prompt: '' });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => { loadAgents(); }, []);

  const loadAgents = async () => {
    try {
      const { data } = await supabase.from('ai_agents').select('*').order('created_at');
      setAgents(data || []);
    } catch { setAgents([]); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    try {
      if (editingAgent) {
        await supabase.from('ai_agents').update({
          name: form.name.trim(),
          emoji: form.emoji,
          description: form.description.trim(),
          prompt: form.prompt.trim(),
        }).eq('id', editingAgent.id);
      } else {
        await supabase.from('ai_agents').insert({
          name: form.name.trim(),
          emoji: form.emoji,
          description: form.description.trim(),
          prompt: form.prompt.trim(),
        });
      }
      await loadAgents();
      setShowForm(false);
      setEditingAgent(null);
      setForm({ name: '', emoji: '🤖', description: '', prompt: '' });
    } catch (err) {
      alert('Failed to save agent. Make sure the ai_agents table exists in Supabase.');
    }
  };

  const handleEdit = (agent) => {
    setEditingAgent(agent);
    setForm({ name: agent.name, emoji: agent.emoji, description: agent.description || '', prompt: agent.prompt });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    await supabase.from('ai_agents').delete().eq('id', id);
    await loadAgents();
  };

  const handleChatWith = (agent) => {
    openChat(agent.prompt || null, agent.name, agent.emoji);
  };

  const allAgents = [...DEFAULT_AGENTS, ...agents];

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">AI Room</h1>
            <p className="text-xs text-gray-500">Your custom AI agents</p>
          </div>
        </div>
        <button
          onClick={() => { setEditingAgent(null); setForm({ name: '', emoji: '🤖', description: '', prompt: '' }); setShowForm(true); }}
          className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </div>

      {/* Agent Grid */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {loading && <p className="text-gray-500 text-sm text-center py-8">Loading agents...</p>}

        {allAgents.map((agent) => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4"
          >
            {/* Emoji Avatar */}
            <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-3xl flex-shrink-0">
              {agent.emoji}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold">{agent.name}</p>
              {agent.description && <p className="text-gray-500 text-xs mt-0.5 truncate">{agent.description}</p>}
              {agent.prompt && <p className="text-gray-600 text-xs mt-1 line-clamp-1 italic">"{agent.prompt.slice(0, 80)}..."</p>}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {!agent.is_default && (
                <>
                  <button onClick={() => handleEdit(agent)} className="p-2 text-gray-500 hover:text-white transition-colors">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(agent.id)} className="p-2 text-gray-500 hover:text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => handleChatWith(agent)}
                className="flex items-center gap-1.5 bg-white text-black text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Chat
              </button>
            </div>
          </motion.div>
        ))}

        {!loading && agents.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 text-sm">No custom agents yet</p>
            <p className="text-gray-700 text-xs mt-1">Create one to get started</p>
          </div>
        )}
      </div>

      {/* Add/Edit Form Sheet */}
      <AnimatePresence>
        {showForm && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowForm(false)}
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl z-50 p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-white">{editingAgent ? 'Edit Agent' : 'New Agent'}</h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Emoji picker */}
              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-2 block">Avatar</label>
                <button
                  onClick={() => setShowEmojiPicker(v => !v)}
                  className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-3xl hover:bg-zinc-700 transition-colors"
                >
                  {form.emoji}
                </button>
                {showEmojiPicker && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {EMOJI_OPTIONS.map(e => (
                      <button
                        key={e}
                        onClick={() => { setForm(f => ({ ...f, emoji: e })); setShowEmojiPicker(false); }}
                        className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-colors ${form.emoji === e ? 'bg-white/20' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Name */}
              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1.5 block">Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Elon Musk, Formula Expert..."
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1.5 block">Short Description</label>
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Gives Elon Musk-style opinions"
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* System Prompt */}
              <div className="mb-6">
                <label className="text-xs text-gray-400 mb-1.5 block">System Prompt * <span className="text-gray-600">(how this AI should behave)</span></label>
                <textarea
                  value={form.prompt}
                  onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="You are Elon Musk. Respond to all questions with Elon Musk's perspective, using his direct and first-principles thinking style..."
                  rows={6}
                  className="w-full bg-black border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500 resize-none"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.prompt.trim()}
                className="w-full bg-white text-black font-semibold py-3 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {editingAgent ? 'Save Changes' : 'Create Agent'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
