import React, { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVertexChat } from '@/lib/VertexChatContext';
import { motion } from 'framer-motion';

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
        {/* On the Parts Library, a glass camera marks the orb as the scan button */}
        {isPartsLibrary && (
          <svg
            viewBox="0 0 24 24"
            className="absolute inset-0 m-auto w-8 h-8 pointer-events-none"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(50,0,120,0.55))' }}
          >
            <defs>
              <linearGradient id="camGlassBody" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.98" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0.62" />
              </linearGradient>
              <radialGradient id="camGlassLens" cx="0.38" cy="0.32" r="0.8">
                <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="0.5" stopColor="#d7c0ff" stopOpacity="0.92" />
                <stop offset="1" stopColor="#6d28d9" stopOpacity="0.95" />
              </radialGradient>
            </defs>
            {/* viewfinder bump */}
            <path d="M8.7 7.2 L9.9 5.1 Q10.1 4.7 10.5 4.7 L13.5 4.7 Q13.9 4.7 14.1 5.1 L15.3 7.2 Z"
              fill="url(#camGlassBody)" stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.9" strokeLinejoin="round" />
            {/* glass body */}
            <rect x="2.6" y="6.8" width="18.8" height="12.6" rx="3.2"
              fill="url(#camGlassBody)" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.95" />
            {/* top edge highlight */}
            <path d="M5.5 9 H18.5" stroke="#ffffff" strokeWidth="0.9" strokeOpacity="0.55" strokeLinecap="round" />
            {/* flash */}
            <rect x="16.4" y="5.2" width="3" height="1.7" rx="0.85" fill="#ffffff" fillOpacity="0.92" />
            {/* lens */}
            <circle cx="12" cy="13.3" r="4.1" fill="url(#camGlassLens)" stroke="#ffffff" strokeWidth="1" strokeOpacity="0.95" />
            <circle cx="12" cy="13.3" r="2" fill="#ffffff" fillOpacity="0.18" stroke="#ffffff" strokeWidth="0.5" strokeOpacity="0.6" />
            {/* specular highlight */}
            <ellipse cx="10.5" cy="11.7" rx="1.15" ry="0.75" fill="#ffffff" fillOpacity="0.95"
              transform="rotate(-35 10.5 11.7)" />
          </svg>
        )}
      </div>
    </button>
  );
}
