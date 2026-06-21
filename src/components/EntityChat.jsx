import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, ImagePlus, Mic, MicOff, Clock, Trash2 } from 'lucide-react';
import { useVertexChat } from '@/lib/VertexChatContext';
import { supabase } from '@/api/supabaseClient';
import vertexLogo from '@/assets/Vertex-logo.webp';

async function loadHistoryFromDB(agentName) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // fallback to localStorage
    try { return JSON.parse(localStorage.getItem(`entity_chat_history_${agentName || 'vertex'}`)) || []; }
    catch { return []; }
  }
  const { data } = await supabase
    .from('chat_history')
    .select('role, text, created_at')
    .eq('user_id', user.id)
    .eq('agent_name', agentName || 'vertex')
    .order('created_at', { ascending: true })
    .limit(200);
  return (data || []).map(r => ({ role: r.role, text: r.text, ts: new Date(r.created_at).getTime() }));
}

async function saveMessageToDB(agentName, role, text) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // fallback to localStorage
    const key = `entity_chat_history_${agentName || 'vertex'}`;
    try {
      const existing = JSON.parse(localStorage.getItem(key)) || [];
      existing.push({ role, text, ts: Date.now() });
      localStorage.setItem(key, JSON.stringify(existing.slice(-200)));
    } catch {}
    return;
  }
  await supabase.from('chat_history').insert({
    user_id: user.id,
    agent_name: agentName || 'vertex',
    role,
    text,
  });
}

async function clearHistoryFromDB(agentName) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    localStorage.removeItem(`entity_chat_history_${agentName || 'vertex'}`);
    return;
  }
  await supabase.from('chat_history')
    .delete()
    .eq('user_id', user.id)
    .eq('agent_name', agentName || 'vertex');
}

async function callClaude(messages, systemPrompt, model = 'claude-haiku-4-5') {
  const isLocalhost = window.location.hostname === 'localhost';
  const url = isLocalhost
    ? '/api/claude/v1/messages'
    : 'https://api.anthropic.com/v1/messages';

  const headers = { 'content-type': 'application/json' };
  if (!isLocalhost) {
    const { getSetting } = await import('@/api/appSettings');
    const key = (await getSetting('anthropicApiKey')) || localStorage.getItem('anthropicApiKey');
    if (!key) throw new Error('No Anthropic API key — add it in Settings');
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, max_tokens: 1024, system: systemPrompt, messages }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export default function EntityChat({ isOpen, onClose }) {
  const { agentPrompt, agentName, agentEmoji, model } = useVertexChat();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [latestMsg, setLatestMsg] = useState(null);
  const [apiMsgs, setApiMsgs] = useState([]);
  const [displayHistory, setDisplayHistory] = useState([]); // all display messages
  const [pendingImages, setPendingImages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const historyEndRef = useRef(null);

  // Load history when agent opens
  useEffect(() => {
    if (isOpen) {
      setDisplayHistory([]);
      setLatestMsg(null);
      setApiMsgs([]);
      setInput('');
      setShowHistory(false);
      loadHistoryFromDB(agentName).then(saved => {
        setDisplayHistory(saved);
        if (saved.length > 0) setLatestMsg(saved[saved.length - 1]);
      });
    }
  }, [isOpen, agentName]);

  // Scroll to bottom of history when opened
  useEffect(() => {
    if (showHistory) {
      setTimeout(() => historyEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [showHistory, displayHistory]);

  const systemPrompt = agentPrompt ||
    `You are Jarvis, a helpful assistant for a van conversion shop. Be concise — one clear paragraph max per response.`;

  const send = async (text) => {
    const msg = (text || input).trim();
    if ((!msg && pendingImages.length === 0) || loading) return;
    setInput('');

    let userContent;
    if (pendingImages.length > 0) {
      userContent = [
        ...pendingImages.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        })),
        { type: 'text', text: msg || 'What do you see?' },
      ];
    } else {
      userContent = msg;
    }

    setPendingImages([]);
    const userDisplay = { role: 'user', text: msg || '📷 Image', ts: Date.now() };
    setLatestMsg(userDisplay);
    const newDisplay = [...displayHistory, userDisplay];
    setDisplayHistory(newDisplay);
    saveMessageToDB(agentName, 'user', msg || '📷 Image');

    const newApi = [...apiMsgs, { role: 'user', content: userContent }];
    setApiMsgs(newApi);
    setLoading(true);

    try {
      const resp = await callClaude(newApi, systemPrompt, model);
      const aiText = resp.content?.find(b => b.type === 'text')?.text || '';
      const aiDisplay = { role: 'ai', text: aiText, ts: Date.now() };
      setLatestMsg(aiDisplay);
      setDisplayHistory([...newDisplay, aiDisplay]);
      saveMessageToDB(agentName, 'ai', aiText);
      setApiMsgs([...newApi, { role: 'assistant', content: resp.content }]);
    } catch (err) {
      const errDisplay = { role: 'ai', text: `Error: ${err.message}`, isError: true, ts: Date.now() };
      setLatestMsg(errDisplay);
      setDisplayHistory([...newDisplay, errDisplay]);
    } finally {
      setLoading(false);
    }
  };

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result.split(',')[1];
      const mediaType = file.type;
      setPendingImages(prev => [...prev, { data, mediaType, name: file.name }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const toggleMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const r = new SR();
    r.continuous = false;
    r.onstart = () => setIsListening(true);
    r.onend = () => setIsListening(false);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setInput(t);
      setTimeout(() => send(t), 100);
    };
    r.start();
    recognitionRef.current = r;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
            onClick={onClose}
          />

          {/* The Void */}
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="fixed inset-x-4 z-50 flex flex-col"
            style={{
              top: '8vh',
              bottom: '8vh',
              background: 'radial-gradient(ellipse at 50% 20%, #0d0d1a, #050508)',
              borderRadius: 32,
              boxShadow: '0 0 80px rgba(100,80,200,0.15), 0 0 0 1px rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)' }}
            >
              <X className="w-4 h-4" />
            </button>

            {/* History button */}
            <button
              onClick={() => setShowHistory(v => !v)}
              className="absolute top-4 left-4 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{
                background: showHistory ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.07)',
                color: showHistory ? '#a78bfa' : 'rgba(255,255,255,0.4)'
              }}
            >
              <Clock className="w-4 h-4" />
            </button>

            {/* Agent identity at top */}
            <div className="flex flex-col items-center pt-10 pb-4 flex-shrink-0">
              <motion.div
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="relative mb-3"
              >
                {/* Glow */}
                <div className="absolute inset-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(139,92,246,0.5), transparent)',
                    filter: 'blur(16px)',
                    margin: -16,
                  }} />
                <div className="w-16 h-16 rounded-full flex items-center justify-center relative"
                  style={{
                    background: 'radial-gradient(circle at 35% 35%, #1e1040, #0a0520)',
                    boxShadow: '0 0 24px rgba(139,92,246,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}>
                  {agentEmoji
                    ? <span className="text-3xl">{agentEmoji}</span>
                    : <img src={vertexLogo} alt="Vertex" className="w-10 h-10 object-contain" />
                  }
                </div>
              </motion.div>
              <p className="text-white/80 text-sm font-semibold tracking-widest uppercase">
                {agentName || 'Jarvis'}
              </p>
              {/* Online dot */}
              <div className="flex items-center gap-1.5 mt-1">
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-green-400"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-green-400/60 text-[10px] tracking-wider">
                  {loading ? 'thinking...' : 'online'}
                </span>
              </div>
            </div>

            {/* History drawer */}
            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute inset-x-0 z-20 overflow-y-auto px-5 py-4"
                  style={{
                    top: 130,
                    bottom: 90,
                    background: 'rgba(0,0,0,0.7)',
                    backdropFilter: 'blur(8px)',
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-white/40 text-xs tracking-widest uppercase">Conversation</p>
                    <button
                      onClick={() => { clearHistoryFromDB(agentName); setDisplayHistory([]); setLatestMsg(null); setShowHistory(false); }}
                      className="flex items-center gap-1 text-red-400/60 hover:text-red-400 text-xs transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  </div>
                  {displayHistory.length === 0 ? (
                    <p className="text-white/20 text-sm text-center mt-8">No messages yet</p>
                  ) : (
                    <div className="space-y-3">
                      {displayHistory.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className="max-w-[80%] px-3 py-2 rounded-2xl text-sm"
                            style={{
                              background: msg.role === 'user'
                                ? 'rgba(139,92,246,0.25)'
                                : 'rgba(255,255,255,0.07)',
                              color: msg.isError ? '#f87171' : 'rgba(255,255,255,0.8)',
                            }}
                          >
                            {msg.text}
                          </div>
                        </div>
                      ))}
                      <div ref={historyEndRef} />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Message void — center */}
            <div className="flex-1 flex items-start justify-center px-6 relative overflow-y-auto py-4">
              <AnimatePresence mode="wait">
                {loading ? (
                  <motion.div
                    key="typing"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex gap-1.5"
                  >
                    {[0,1,2].map(i => (
                      <motion.div key={i}
                        className="w-2 h-2 rounded-full bg-white/30"
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                      />
                    ))}
                  </motion.div>
                ) : latestMsg ? (
                  <motion.div
                    key={latestMsg.text}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                    className="text-center max-w-xs"
                  >
                    {latestMsg.role === 'user' ? (
                      <p className="text-white/40 text-sm italic">"{latestMsg.text}"</p>
                    ) : (
                      <p className={`text-white/90 text-base leading-relaxed text-left ${latestMsg.isError ? 'text-red-400' : ''}`}>
                        {latestMsg.text}
                      </p>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center"
                  >
                    <p className="text-white/20 text-sm">Say something...</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Pending images */}
            {pendingImages.length > 0 && (
              <div className="flex gap-2 px-5 pb-2 flex-shrink-0">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={`data:${img.mediaType};base64,${img.data}`}
                      className="w-12 h-12 rounded-xl object-cover opacity-70" />
                    <button onClick={() => setPendingImages(p => p.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-white text-xs">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input bar */}
            <div className="px-4 pb-6 pt-3 flex-shrink-0"
              style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* Image upload */}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
                <button onClick={() => fileRef.current?.click()}
                  className="text-white/30 hover:text-white/70 transition-colors flex-shrink-0">
                  <ImagePlus className="w-5 h-5" />
                </button>

                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Message..."
                  disabled={loading}
                  className="flex-1 bg-transparent text-white/80 placeholder:text-white/20 text-sm focus:outline-none"
                />

                {/* Mic */}
                <button onClick={toggleMic}
                  className={`flex-shrink-0 transition-colors ${isListening ? 'text-purple-400' : 'text-white/30 hover:text-white/70'}`}>
                  {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>

                {/* Send */}
                <button
                  onClick={() => send()}
                  disabled={loading || (!input.trim() && pendingImages.length === 0)}
                  className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-20"
                  style={{ background: 'rgba(139,92,246,0.6)' }}>
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
