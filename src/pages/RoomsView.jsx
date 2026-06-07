import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Check, ArrowLeft } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import vertexLogo from '@/assets/Vertex-logo.webp';

const ROOM_COLORS = [
  '#6366f1', '#a78bfa', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
];

function MembraneBlob({ room, agents, onPress }) {
  const emojis = agents.slice(0, 6);

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className="flex flex-col items-center gap-3 cursor-pointer select-none"
      onTouchEnd={onPress}
      onClick={onPress}
      whileTap={{ scale: 0.93 }}
    >
      {/* Membrane */}
      <div className="relative" style={{ width: 130, height: 130 }}>
        {/* Outer glow */}
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.08, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: `radial-gradient(circle, ${room.color}66, transparent)`,
            filter: 'blur(16px)',
            margin: -16,
          }}
        />

        {/* Membrane surface */}
        <div
          className="w-full h-full rounded-full relative overflow-hidden"
          style={{
            background: `radial-gradient(circle at 35% 30%, ${room.color}44, ${room.color}11)`,
            border: `1px solid ${room.color}55`,
            boxShadow: `0 0 30px ${room.color}33, inset 0 1px 0 rgba(255,255,255,0.15)`,
            backdropFilter: 'blur(4px)',
          }}
        >
          {/* Shine */}
          <div className="absolute top-3 left-4 w-10 h-5 rounded-full opacity-20"
            style={{ background: 'linear-gradient(135deg, white, transparent)' }} />

          {/* Agent emojis floating inside */}
          {emojis.length > 0 ? (
            <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-1 p-4">
              {emojis.map((agent, i) => (
                <motion.span
                  key={agent.id}
                  className="text-xl"
                  animate={{ y: [0, -3, 0] }}
                  transition={{ duration: 2 + i * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }}
                >
                  {agent.emoji}
                </motion.span>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <img src={vertexLogo} alt="Vertex" className="w-12 h-12 object-contain opacity-60" />
            </div>
          )}
        </div>
      </div>

      {/* Name */}
      <span className="text-white/70 text-sm font-semibold tracking-wide">{room.name}</span>

      {/* Presence dot */}
      <motion.div
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: room.color }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </motion.div>
  );
}

export default function RoomsView() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [agentsByRoom, setAgentsByRoom] = useState({});
  const [loading, setLoading] = useState(true);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomColor, setNewRoomColor] = useState('#6366f1');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [{ data: roomsData }, { data: agentsData }] = await Promise.all([
      supabase.from('ai_rooms').select('*').order('created_at'),
      supabase.from('ai_agents').select('id, emoji, room_id'),
    ]);
    setRooms(roomsData || []);
    const byRoom = {};
    (agentsData || []).forEach(a => {
      if (!byRoom[a.room_id]) byRoom[a.room_id] = [];
      byRoom[a.room_id].push(a);
    });
    setAgentsByRoom(byRoom);
    setLoading(false);
  };

  const createRoom = async () => {
    if (!newRoomName.trim()) return;
    const { data } = await supabase.from('ai_rooms').insert({
      name: newRoomName.trim(),
      color: newRoomColor,
    }).select().single();
    if (data) {
      setRooms(prev => [...prev, data]);
      setShowNewRoom(false);
      setNewRoomName('');
    }
  };

  const enterRoom = (room) => {
    navigate(`/AIRoom?room=${room.id}`);
  };

  return (
    <div className="min-h-screen flex flex-col"
      style={{ background: 'radial-gradient(ellipse at 50% 20%, #0d0820 0%, #000 70%)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-12 pb-4 flex-shrink-0">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white tracking-widest uppercase opacity-60">Vertex Rooms</h1>
        <button
          onClick={() => setShowNewRoom(true)}
          className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent)', filter: 'blur(80px)' }} />
        <div className="absolute bottom-1/3 right-1/4 w-60 h-60 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #a78bfa, transparent)', filter: 'blur(60px)' }} />
      </div>

      {/* Room membranes */}
      <div className="flex-1 flex flex-wrap items-center justify-center gap-10 px-8 py-8 relative z-10">
        {loading ? (
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
        ) : (
          <AnimatePresence>
            {rooms.map(room => (
              <MembraneBlob
                key={room.id}
                room={room}
                agents={agentsByRoom[room.id] || []}
                onPress={() => enterRoom(room)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* New Room Sheet */}
      <AnimatePresence>
        {showNewRoom && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowNewRoom(false)} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl z-50 p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-white">New Room</h2>
                <button onClick={() => setShowNewRoom(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1.5 block">Room Name</label>
                <input
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createRoom(); }}
                  placeholder="e.g. SOP Agents, Design Team..."
                  autoFocus
                  className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="mb-6">
                <label className="text-xs text-gray-400 mb-2 block">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {ROOM_COLORS.map(c => (
                    <button key={c} onClick={() => setNewRoomColor(c)}
                      className="w-8 h-8 rounded-full transition-transform hover:scale-110 flex items-center justify-center"
                      style={{ background: c }}>
                      {newRoomColor === c && <Check className="w-4 h-4 text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={createRoom} disabled={!newRoomName.trim()}
                className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40">
                Create Room
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
