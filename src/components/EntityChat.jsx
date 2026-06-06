import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, ImagePlus, Mic, MicOff } from 'lucide-react';
import { useVertexChat } from '@/lib/VertexChatContext';
import vertexLogo from '@/assets/Vertex-logo.webp';

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
  const [latestMsg, setLatestMsg] = useState(null); // { role, text }
  const [apiMsgs, setApiMsgs] = useState([]);
  const [pendingImages, setPendingImages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  // Reset when agent changes
  useEffect(() => {
    if (isOpen) {
      setLatestMsg(null);
      setApiMsgs([]);
      setInput('');
    }
  }, [isOpen, agentName]);

  const systemPrompt = agentPrompt ||
    `You are Vertex AI, a helpful assistant for a van conversion shop. Be concise — one clear paragraph max per response.`;

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
    setLatestMsg({ role: 'user', text: msg || '📷 Image' });
    const newApi = [...apiMsgs, { role: 'user', content: userContent }];
    setApiMsgs(newApi);
    setLoading(true);

    try {
      const resp = await callClaude(newApi, systemPrompt, model);
      const text = resp.content?.find(b => b.type === 'text')?.text || '';
      setLatestMsg({ role: 'ai', text });
      setApiMsgs([...newApi, { role: 'assistant', content: resp.content }]);
    } catch (err) {
      setLatestMsg({ role: 'ai', text: `Error: ${err.message}`, isError: true });
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
                {agentName || 'Vertex AI'}
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

            {/* Message void — center */}
            <div className="flex-1 flex items-center justify-center px-6 relative">
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
                      <p className={`text-white/90 text-base leading-relaxed ${latestMsg.isError ? 'text-red-400' : ''}`}>
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
