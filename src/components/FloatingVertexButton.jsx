import React, { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useVertexChat } from '@/lib/VertexChatContext';
import { useJarvisAmbient } from '@/lib/JarvisAmbient';
import { motion } from 'framer-motion';
import { Camera } from 'lucide-react';

const LONG_PRESS_MS = 500;

// The floating orb IS Jarvis: tap toggles ambient voice (cyan + pulsing while
// she's live), long-press opens the chat sheet. On the Parts Library the tap
// stays the scan-a-part trigger (long-press = chat there too; enable Jarvis
// from any other page).
export default function FloatingVertexButton() {
  const { open } = useVertexChat();
  const { enabled, status, toggle } = useJarvisAmbient();
  const { pathname } = useLocation();

  const timerRef = useRef(null);
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  if (pathname === '/' || pathname === '/Home' || pathname === '/Login') return null;

  const isPartsLibrary = pathname === '/PartsLibrary';

  const startPress = () => {
    firedRef.current = false;
    setPressing(true);
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setPressing(false);
      open();
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    clearTimeout(timerRef.current);
    setPressing(false);
    if (!firedRef.current) {
      // Dispatch synchronously so the file/camera input opens within this user
      // gesture (browsers require that for programmatic input.click()).
      if (isPartsLibrary) window.dispatchEvent(new CustomEvent('vertex:scan-part'));
      else toggle();
    }
    firedRef.current = false;
  };

  const cancelPress = () => {
    clearTimeout(timerRef.current);
    setPressing(false);
    firedRef.current = false;
  };

  // Purple when idle; cyan while Jarvis is live. Pulse speed follows her state.
  const live = enabled;
  const glowColor = live ? 'rgba(56,189,248,' : 'rgba(139,92,246,';
  const pulseDur = status === 'speaking' ? 0.7 : status === 'listening' ? 1.6 : 3;

  return (
    <button
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={cancelPress}
      onContextMenu={e => e.preventDefault()}
      className="fixed bottom-6 left-1/2 z-30 select-none"
      style={{ transform: `translateX(-50%) scale(${pressing ? 0.88 : 1})`, transition: 'transform 0.15s ease' }}
    >
      <div className="relative flex items-center justify-center">
        {/* Outer pulsing glow */}
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          animate={{ opacity: [0.2, 0.6, 0.2], scale: [1, 1.5, 1] }}
          transition={{ duration: pulseDur * 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ background: `radial-gradient(circle, ${glowColor}0.7), transparent)`, margin: -20, filter: 'blur(16px)' }}
        />
        {/* Inner tight glow */}
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: pulseDur, repeat: Infinity, ease: 'easeInOut' }}
          style={{ background: `radial-gradient(circle, ${live ? 'rgba(125,211,252,0.85)' : 'rgba(168,85,247,0.8)'}, transparent)`, margin: -6, filter: 'blur(6px)' }}
        />
        {/* The orb */}
        <div className="w-14 h-14 rounded-full"
          style={{
            background: live
              ? 'radial-gradient(circle at 35% 28%, rgba(186,230,253,0.95), rgba(2,132,199,0.95))'
              : 'radial-gradient(circle at 35% 28%, rgba(210,160,255,0.95), rgba(109,40,217,0.9))',
            boxShadow: live
              ? '0 0 32px rgba(56,189,248,0.9), 0 0 64px rgba(56,189,248,0.4), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -2px 4px rgba(3,70,120,0.5)'
              : '0 0 32px rgba(139,92,246,0.9), 0 0 64px rgba(139,92,246,0.4), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -2px 4px rgba(80,0,180,0.5)',
            border: live ? '0.5px solid rgba(186,230,253,0.5)' : '0.5px solid rgba(210,160,255,0.5)',
            transition: 'background 0.3s ease, box-shadow 0.3s ease',
          }}
        />
        {/* On the Parts Library, a faint camera marks the orb as the scan button */}
        {isPartsLibrary && (
          <Camera
            className="absolute inset-0 m-auto w-6 h-6 pointer-events-none"
            style={{ color: 'rgba(255,255,255,0.65)', filter: 'drop-shadow(0 1px 2px rgba(60,0,140,0.45))' }}
          />
        )}
      </div>
    </button>
  );
}
