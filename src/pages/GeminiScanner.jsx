import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, Check, X, Volume2, VolumeX } from 'lucide-react';
import { getSetting } from '@/api/appSettings';

const STOCK_KEY = 'partsLibraryStock';
const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const SYSTEM_PROMPT = `You are a parts identification assistant for a van conversion shop.
You watch a live camera feed and identify mechanical, electrical, and plumbing parts.
Each time you see a frame, respond ONLY with a single JSON object — no extra text:
{"name": "M6 Hex Bolt", "qty": 4, "spec": "stainless steel 20mm"}
- "name": specific part name with size/spec if visible (e.g. "M8 Hex Bolt" not just "bolt")
- "qty": how many you can count or estimate visible in the frame
- "spec": any additional detail (material, length, color, etc.) — empty string if unknown
If you cannot identify any recognizable part, respond with: {"name": null}
Keep responses to only that JSON — nothing else.`;

function loadStock() {
  try { return JSON.parse(localStorage.getItem(STOCK_KEY)) || {}; } catch { return {}; }
}
function saveStock(s) { localStorage.setItem(STOCK_KEY, JSON.stringify(s)); }

export default function GeminiScanner() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState(localStorage.getItem('geminiApiKey') || '');

  useEffect(() => {
    getSetting('geminiApiKey').then(key => {
      if (key) { localStorage.setItem('geminiApiKey', key); setApiKey(key); }
    });
  }, []);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const frameIntervalRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const mutedRef = useRef(false);

  const [status, setStatus] = useState('Connecting...');
  const [connected, setConnected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [identification, setIdentification] = useState(null); // { name, qty, spec }
  const [confirming, setConfirming] = useState(false);
  const [qty, setQty] = useState(1);
  const [savedParts, setSavedParts] = useState([]);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lastSpeech, setLastSpeech] = useState('');

  // ── Speech output ────────────────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (mutedRef.current || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
    setLastSpeech(text);
  }, []);

  const toggleMute = () => {
    setMuted(v => {
      mutedRef.current = !v;
      if (!v) window.speechSynthesis.cancel();
      return !v;
    });
  };

  // ── Camera ───────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setStatus('Camera access denied');
    }
  }, []);

  // ── Frame capture ────────────────────────────────────────────────────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady || video.readyState < 2) return null;
    canvas.width = 320;
    canvas.height = 240;
    canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  }, [cameraReady]);

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (!apiKey) { setStatus('No API key — add it in Master Sheet settings'); return; }

    const ws = new WebSocket(`${WS_URL}?key=${apiKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generationConfig: { responseModalities: ['TEXT'] },
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.setupComplete) {
          setConnected(true);
          setStatus('Scanning...');
          startCamera();
          return;
        }

        const text = data.serverContent?.modelTurn?.parts?.[0]?.text;
        if (!text) return;

        try {
          const parsed = JSON.parse(text.trim());
          if (parsed.name) {
            setIdentification(prev => {
              // Only update + speak if it's a new/different part
              if (prev?.name !== parsed.name) {
                const detail = parsed.spec ? ` — ${parsed.spec}` : '';
                const countText = parsed.qty > 1 ? `. About ${parsed.qty} visible.` : '';
                speak(`I see ${parsed.name}${detail}${countText} Is that right?`);
              }
              return parsed;
            });
            setQty(parsed.qty || 1);
          } else {
            setIdentification(null);
          }
        } catch {
          // Response wasn't valid JSON — ignore
        }
      } catch {}
    };

    ws.onerror = () => setStatus('Connection error — check API key');
    ws.onclose = () => {
      setConnected(false);
      setStatus('Disconnected');
      clearInterval(frameIntervalRef.current);
    };
  }, [apiKey, startCamera, speak]);

  // ── Start sending frames once camera is ready ────────────────────────────────
  useEffect(() => {
    if (!cameraReady || !connected) return;
    clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = setInterval(() => {
      const frame = captureFrame();
      if (frame && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: 'image/jpeg', data: frame }] },
        }));
      }
    }, 1800);
    return () => clearInterval(frameIntervalRef.current);
  }, [cameraReady, connected, captureFrame]);

  // ── Mount / unmount ──────────────────────────────────────────────────────────
  useEffect(() => {
    connectWS();
    return () => {
      wsRef.current?.close();
      clearInterval(frameIntervalRef.current);
      window.speechSynthesis.cancel();
      streamRef.current?.getTracks().forEach(t => t.stop());
      recognitionRef.current?.stop();
    };
  }, []);

  // ── Voice recognition ────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    recognitionRef.current?.stop();
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onstart = () => setListening(true);
    r.onend = () => setListening(false);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript.toLowerCase().trim();
      // Quantity detection
      const numWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      const numMatch = t.match(/\b(\d+)\b/);
      const wordMatch = Object.keys(numWords).find(w => t.includes(w));
      if (numMatch) { setQty(parseInt(numMatch[1])); return; }
      if (wordMatch) { setQty(numWords[wordMatch]); return; }
      // Yes / No for confirmation
      if (t.includes('yes') || t.includes('correct') || t.includes('yeah') || t.includes('yep')) {
        setConfirming(true);
        speak('How many do you have?');
      } else if (t.includes('no') || t.includes('wrong') || t.includes('nope')) {
        setIdentification(null);
        speak('OK, keep scanning');
      }
    };
    r.start();
    recognitionRef.current = r;
  }, [speak]);

  // ── Save to stock ────────────────────────────────────────────────────────────
  const confirmSave = useCallback(() => {
    if (!identification?.name) return;
    const stock = loadStock();
    const current = parseInt(stock[identification.name] || 0);
    stock[identification.name] = current + qty;
    saveStock(stock);
    setSavedParts(prev => [...prev, { name: identification.name, qty }]);
    speak(`Saved. ${qty} ${identification.name} added to stock.`);
    setIdentification(null);
    setConfirming(false);
  }, [identification, qty, speak]);

  const dismiss = useCallback(() => {
    setIdentification(null);
    setConfirming(false);
    speak('OK, continuing to scan');
  }, [speak]);

  // ── No API key screen ────────────────────────────────────────────────────────
  if (!apiKey) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 text-center max-w-sm w-full">
          <p className="text-white font-semibold text-lg mb-2">Gemini API Key Required</p>
          <p className="text-gray-400 text-sm mb-1">Get a free key at <span className="text-blue-400">aistudio.google.com</span></p>
          <p className="text-gray-400 text-sm mb-5">Then add it in Settings</p>
          <button onClick={() => navigate('/Settings')} className="w-full bg-white text-black font-semibold py-3 rounded-xl text-sm hover:bg-gray-200 transition-colors">
            Go to Settings
          </button>
          <button onClick={() => navigate('/Inventory')} className="w-full mt-2 text-gray-500 text-sm py-2">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col" style={{ maxHeight: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <button onClick={() => navigate('/Inventory')} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-white flex-1">Part Scanner</h1>
        <button onClick={toggleMute} className="text-gray-400 hover:text-white transition-colors p-1">
          {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
          <span className="text-xs text-gray-500">{status}</span>
        </div>
      </div>

      {/* Camera feed */}
      <div className="relative flex-1 bg-zinc-950 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Scan frame overlay */}
        {connected && !identification && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-56 h-56 relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-white/60 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-white/60 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-white/60 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white/60 rounded-br-lg" />
            </div>
          </div>
        )}

        {/* Last speech caption */}
        {lastSpeech && !confirming && (
          <div className="absolute top-3 left-3 right-3 pointer-events-none">
            <p className="text-center text-white/80 text-xs bg-black/50 rounded-xl px-3 py-1.5">{lastSpeech}</p>
          </div>
        )}

        {/* Identification card */}
        {identification && !confirming && (
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="bg-zinc-900/97 border border-zinc-600 rounded-2xl p-4 shadow-2xl">
              <p className="text-gray-400 text-xs mb-0.5">Identified</p>
              <p className="text-white font-bold text-xl leading-tight">{identification.name}</p>
              {identification.spec && <p className="text-gray-400 text-sm mt-0.5">{identification.spec}</p>}
              {identification.qty > 1 && <p className="text-blue-400 text-sm mt-0.5">~{identification.qty} visible</p>}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setConfirming(true); speak('How many do you have?'); }}
                  className="flex-1 bg-white text-black font-semibold py-3 rounded-xl text-sm active:scale-95 transition-all"
                >
                  <Check className="w-4 h-4 inline mr-1.5" />Yes, that's it
                </button>
                <button
                  onClick={startListening}
                  className={`w-12 h-12 rounded-xl border flex items-center justify-center transition-all ${listening ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-zinc-700 text-gray-400'}`}
                >
                  {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <button onClick={dismiss} className="w-12 h-12 rounded-xl border border-zinc-700 text-gray-400 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quantity confirmation */}
        {confirming && identification && (
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <div className="bg-zinc-900/97 border border-zinc-600 rounded-2xl p-4 shadow-2xl">
              <p className="text-gray-400 text-xs mb-0.5">How many?</p>
              <p className="text-white font-bold text-lg leading-tight mb-3">{identification.name}</p>
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setQty(q => Math.max(0, q - 1))} className="w-11 h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white text-xl flex items-center justify-center transition-colors">−</button>
                <input
                  type="number"
                  value={qty}
                  onChange={e => setQty(Math.max(0, parseInt(e.target.value) || 0))}
                  className="flex-1 text-center text-white text-3xl font-bold bg-zinc-800 rounded-xl py-2.5 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
                <button onClick={() => setQty(q => q + 1)} className="w-11 h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white text-xl flex items-center justify-center transition-colors">+</button>
                <button
                  onClick={startListening}
                  className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all ${listening ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-zinc-700 text-gray-400'}`}
                >
                  {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={dismiss} className="flex-1 py-3 rounded-xl border border-zinc-700 text-gray-400 text-sm font-medium transition-colors hover:text-white">Cancel</button>
                <button onClick={confirmSave} className="flex-1 py-3 rounded-xl bg-white text-black font-semibold text-sm active:scale-95 transition-all">
                  Save to Stock
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Saved parts this session */}
      {savedParts.length > 0 && (
        <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
          <p className="text-xs text-gray-500 mb-2">Saved this session</p>
          <div className="flex flex-wrap gap-2">
            {savedParts.map((p, i) => (
              <span key={i} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 text-green-400 text-xs px-2.5 py-1 rounded-full">
                <Check className="w-3 h-3" />
                {p.name} ×{p.qty}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
