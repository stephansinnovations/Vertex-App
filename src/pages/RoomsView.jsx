import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Check, ArrowLeft, Sparkles, Code2 } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import vertexLogo from '@/assets/Vertex-logo.webp';

const ROOM_COLORS = [
  '#6366f1', '#a78bfa', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#8b5cf6',
];

// Position small bubbles around the center in a tight cluster
function getClusterPos(index, total) {
  if (total === 0) return { x: 0, y: 0 };
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  const r = total <= 3 ? 52 : total <= 6 ? 58 : 64;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

const BUBBLE_COLORS = ['#6366f1','#a78bfa','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#8b5cf6'];

function AgentBubble({ agent, index, total }) {
  const pos = getClusterPos(index, total);
  const size = 40;
  const glow = BUBBLE_COLORS[index % BUBBLE_COLORS.length];

  return (
    <motion.div
      className="absolute flex items-center justify-center rounded-full"
      style={{
        width: size, height: size,
        left: `calc(50% + ${pos.x}px)`,
        top: `calc(50% + ${pos.y}px)`,
        transform: 'translate(-50%, -50%)',
        zIndex: 2,
      }}
      animate={{ y: [0, -2, 0] }}
      transition={{ duration: 2.5 + index * 0.3, repeat: Infinity, ease: 'easeInOut', delay: index * 0.15 }}
    >
      {/* Outer glow pulse */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.25, 1] }}
        transition={{ duration: 2.5 + index * 0.3, repeat: Infinity, ease: 'easeInOut', delay: index * 0.2 }}
        style={{
          background: `radial-gradient(circle, ${glow}88, transparent)`,
          filter: 'blur(6px)',
          margin: -6,
        }}
      />
      {/* Glass bubble */}
      <div className="w-full h-full rounded-full flex items-center justify-center relative"
        style={{
          background: 'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.1), rgba(255,255,255,0.02))',
          boxShadow: `0 4px 12px rgba(0,0,0,0.25), 0 0 8px ${glow}55, inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.1)`,
          border: '0.3px solid rgba(255,255,255,0.2)',
        }}>
        {/* Curved reflection */}
        <div className="absolute pointer-events-none" style={{
          top: '12%', left: '18%', width: '38%', height: '15%',
          borderRadius: '50%', background: 'rgba(255,255,255,0.18)',
          filter: 'blur(3px)', transform: 'rotate(-35deg)',
        }} />
        <span style={{ fontSize: 18, position: 'relative', zIndex: 1 }}>{agent.emoji}</span>
      </div>
    </motion.div>
  );
}

// Which app is attached to a room. `app` column is authoritative ('vertex' | <id> |
// null); pre-migration fall back to name so the Vertex Room still shows the Vertex app.
function getRoomApp(room) {
  if (!room) return null;
  if (room.app === undefined) {
    return room.name?.trim().toLowerCase().includes('vertex') ? 'vertex' : null;
  }
  return room.app;
}

function MembraneBlob({ room, agents, onPress, index }) {
  const SIZE = 160;
  const appId = getRoomApp(room);
  const isVertexApp = appId === 'vertex';

  return (
    <motion.div
      initial={{ scale: 0.2, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 2, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18, delay: index * 0.08 }}
      className="flex flex-col items-center gap-3 cursor-pointer select-none"
      style={{ width: SIZE, minWidth: SIZE, maxWidth: SIZE }}
      onTouchEnd={onPress}
      onClick={onPress}
      whileTap={{ scale: 0.9 }}
    >
      {/* Cluster bubble */}
      <div className="relative" style={{ width: SIZE, height: SIZE }}>

        {/* Outer ambient glow */}
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          animate={{ opacity: [0.2, 0.5, 0.2], scale: [1, 1.1, 1] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background: `radial-gradient(circle, ${room.color}55, transparent)`,
            filter: 'blur(20px)',
            margin: -20,
          }}
        />

        {/* Center app bubble — only when an app is attached. Vertex symbol for the
            Vertex app; a plain glass sphere with the room initial otherwise. */}
        {appId && (
          <motion.div
            className="absolute flex items-center justify-center rounded-full"
            style={{
              width: 76, height: 76,
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              background: `radial-gradient(circle at 35% 28%, rgba(255,255,255,0.12), rgba(255,255,255,0.03))`,
              boxShadow: `0 8px 32px ${room.color}55, 0 2px 8px rgba(0,0,0,0.4), inset 0 2px 0 rgba(255,255,255,0.65), inset 0 -2px 0 rgba(0,0,0,0.15)`,
              border: '0.3px solid rgba(255,255,255,0.3)',
              zIndex: 3,
            }}
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* Curved reflection */}
            <div className="absolute pointer-events-none" style={{
              top: '11%', left: '18%', width: '40%', height: '16%',
              borderRadius: '50%', background: 'rgba(255,255,255,0.18)',
              filter: 'blur(3.5px)', transform: 'rotate(-35deg)',
            }} />
            {isVertexApp ? (
              <img src={vertexLogo} alt="Vertex" className="w-10 h-10 object-contain relative z-10" />
            ) : (
              <span className="relative z-10" style={{
                fontSize: 30, fontWeight: 700, letterSpacing: -1,
                color: 'rgba(255,255,255,0.88)', textShadow: `0 1px 6px ${room.color}aa`,
              }}>
                {(appId?.trim()?.[0] || '◆').toUpperCase()}
              </span>
            )}
          </motion.div>
        )}

        {/* Small agent bubbles clustered around center */}
        {agents.slice(0, 8).map((agent, i) => (
          <AgentBubble key={agent.id} agent={agent} index={i} total={Math.min(agents.length, 8)} />
        ))}
      </div>

      {/* Room name */}
      <div style={{ width: SIZE, textAlign: 'center' }}>
        <span className="text-white/70 text-sm font-semibold tracking-wide">{room.name}</span>
      </div>

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
  // App attached at room-creation time (optional). Code is stored now; running it
  // is a later phase. Code comes from pasting, or from Claude generating it.
  const [addApp, setAddApp] = useState(false);
  const [appName, setAppName] = useState('');
  const [appMethod, setAppMethod] = useState('paste'); // 'paste' | 'claude'
  const [appCode, setAppCode] = useState('');
  const [appPrompt, setAppPrompt] = useState('');
  const [generatingApp, setGeneratingApp] = useState(false);
  const [creating, setCreating] = useState(false);

  const resetNewRoom = () => {
    setShowNewRoom(false);
    setNewRoomName('');
    setAddApp(false);
    setAppName('');
    setAppMethod('paste');
    setAppCode('');
    setAppPrompt('');
  };

  // Have Claude generate the app's code from a description. Stores the result in
  // appCode (a single self-contained HTML file).
  const generateAppCode = async () => {
    if (!appPrompt.trim()) return;
    setGeneratingApp(true);
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
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8096,
          messages: [{
            role: 'user',
            content: `Build a single self-contained HTML file for this app: "${appPrompt.trim()}"${appName.trim() ? ` (app name: ${appName.trim()})` : ''}.
Include all CSS and JavaScript inline in the one file. No external build step, no imports from a bundler — only CDN <script>/<link> tags if truly needed.
Return ONLY the raw HTML, starting with <!doctype html>. No explanation, no markdown fences.`
          }]
        })
      });
      const data = await res.json();
      let code = data.content?.[0]?.text?.trim() || '';
      // Strip accidental markdown fences if the model added them.
      code = code.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
      if (code) setAppCode(code);
    } catch {
      alert('Could not generate the app. Check your connection / Anthropic key in Settings.');
    } finally {
      setGeneratingApp(false);
    }
  };

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
    if (!newRoomName.trim() || creating) return;
    setCreating(true);
    const row = { name: newRoomName.trim(), color: newRoomColor };
    if (addApp && appName.trim()) {
      row.app = appName.trim();
      row.app_code = appCode || null;
    }
    const { data, error } = await supabase.from('ai_rooms').insert(row).select().single();
    setCreating(false);
    if (error) {
      alert("Couldn't create the room. If you attached an app, make sure ai_rooms has an \"app_code\" column in Supabase.");
      return;
    }
    if (data) {
      setRooms(prev => [...prev, data]);
      resetNewRoom();
    }
  };

  const [exiting, setExiting] = useState(false);
  const enterRoom = (room) => {
    setExiting(true);
    setTimeout(() => navigate(`/AIRoom?room=${room.id}`), 350);
  };

  return (
    <motion.div
      className="min-h-screen flex flex-col"
      style={{ background: 'radial-gradient(ellipse at 50% 20%, #0d0820 0%, #000 70%)' }}
      initial={{ scale: 2.5, opacity: 0 }}
      animate={exiting ? { scale: 0.3, opacity: 0 } : { scale: 1, opacity: 1 }}
      transition={exiting
        ? { duration: 0.35, ease: [0.4, 0, 1, 1] }
        : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
    >

      {/* Header — iOS nav bar style */}
      <div className="ios-nav-bar flex items-center justify-between px-5 pt-14 pb-4 flex-shrink-0">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 active:opacity-50 transition-opacity">
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--ios-blue)', strokeWidth: 2 }} />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.92)', letterSpacing: -0.3 }}>AI Rooms</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNewRoom(true)}
            className="active:opacity-50 transition-opacity"
          >
            <Plus className="w-6 h-6" style={{ color: 'var(--ios-blue)', strokeWidth: 2 }} />
          </button>
        </div>
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
            {rooms.map((room, i) => (
              <MembraneBlob
                key={room.id}
                room={room}
                agents={agentsByRoom[room.id] || []}
                onPress={() => enterRoom(room)}
                index={i}
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
              className="fixed inset-0 bg-black/70 z-40" onClick={resetNewRoom} />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 rounded-t-2xl z-50 p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-white">New Room</h2>
                <button onClick={resetNewRoom} className="text-gray-400 hover:text-white">
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

              {/* App (optional) */}
              <div className="mb-6 border-t border-zinc-800 pt-5">
                <button
                  onClick={() => setAddApp(v => !v)}
                  className="w-full flex items-center justify-between mb-1"
                >
                  <span className="text-sm font-semibold text-white">Add an app</span>
                  <span className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${addApp ? 'bg-indigo-500 justify-end' : 'bg-zinc-700 justify-start'}`}>
                    <span className="w-5 h-5 rounded-full bg-white" />
                  </span>
                </button>
                <p className="text-xs text-gray-500">Attach an app to this room. Its agents become the app's functions.</p>

                {addApp && (
                  <div className="mt-4 space-y-4">
                    <input
                      value={appName}
                      onChange={e => setAppName(e.target.value)}
                      placeholder="App name — e.g. Inventory, Hardware…"
                      className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500"
                    />

                    {/* Method toggle */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAppMethod('paste')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${appMethod === 'paste' ? 'bg-white/10 border-white/30 text-white' : 'bg-black border-zinc-700 text-gray-400'}`}
                      >
                        <Code2 className="w-4 h-4" /> Paste code
                      </button>
                      <button
                        onClick={() => setAppMethod('claude')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${appMethod === 'claude' ? 'bg-white/10 border-white/30 text-white' : 'bg-black border-zinc-700 text-gray-400'}`}
                      >
                        <Sparkles className="w-4 h-4" /> Claude codes it
                      </button>
                    </div>

                    {appMethod === 'paste' ? (
                      <textarea
                        value={appCode}
                        onChange={e => setAppCode(e.target.value)}
                        placeholder="Paste your app code here…"
                        rows={6}
                        className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-xs font-mono focus:outline-none focus:border-zinc-500 resize-none"
                      />
                    ) : (
                      <>
                        <textarea
                          value={appPrompt}
                          onChange={e => setAppPrompt(e.target.value)}
                          placeholder="Describe the app you want Claude to build…"
                          rows={3}
                          className="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 text-sm focus:outline-none focus:border-zinc-500 resize-none"
                        />
                        <button
                          onClick={generateAppCode}
                          disabled={!appPrompt.trim() || generatingApp}
                          className="w-full flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-xl transition-all disabled:opacity-40"
                          style={{ background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
                        >
                          <Sparkles className="w-4 h-4" />
                          {generatingApp ? 'Generating…' : appCode ? 'Regenerate with Claude' : 'Generate with Claude'}
                        </button>
                        {appCode && (
                          <div className="text-xs text-gray-400">
                            <span className="text-green-400">✓ Generated</span> — {appCode.length.toLocaleString()} chars. Editable below.
                            <textarea
                              value={appCode}
                              onChange={e => setAppCode(e.target.value)}
                              rows={6}
                              className="mt-2 w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 text-white text-xs font-mono focus:outline-none focus:border-zinc-500 resize-none"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <button onClick={createRoom} disabled={!newRoomName.trim() || creating || (addApp && !appName.trim())}
                className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40">
                {creating ? 'Creating…' : 'Create Room'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
