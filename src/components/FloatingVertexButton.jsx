import React, { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVertexChat } from '@/lib/VertexChatContext';
import { motion } from 'framer-motion';
import { Camera } from 'lucide-react';

const LONG_PRESS_MS = 500;

export default function FloatingVertexButton() {
  const { open } = useVertexChat();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const timerRef = useRef(null);
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  if (pathname === '/' || pathname === '/Home') return null;

  // On the Parts Library the orb doubles as the "scan a part" button: a tap fires
  // the photo flow on that page (it listens for this event) instead of navigating.
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
      else navigate('/Rooms');
    }
    firedRef.current = false;
  };

  const cancelPress = () => {
    clearTimeout(timerRef.current);
    setPressing(false);
    firedRef.current = false;
  };

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
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.7), transparent)', margin: -20, filter: 'blur(16px)' }}
        />
        {/* Inner tight glow */}
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          animate={{ opacity: [0.4, 0.9, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.8), transparent)', margin: -6, filter: 'blur(6px)' }}
        />
        {/* The orb */}
        <div className="w-14 h-14 rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 28%, rgba(210,160,255,0.95), rgba(109,40,217,0.9))',
            boxShadow: '0 0 32px rgba(139,92,246,0.9), 0 0 64px rgba(139,92,246,0.4), inset 0 2px 0 rgba(255,255,255,0.55), inset 0 -2px 4px rgba(80,0,180,0.5)',
            border: '0.5px solid rgba(210,160,255,0.5)',
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
