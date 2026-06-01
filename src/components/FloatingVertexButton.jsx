import React, { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVertexChat } from '@/lib/VertexChatContext';
import vertexLogo from '@/assets/vertex-logo.png';

const LONG_PRESS_MS = 500;

export default function FloatingVertexButton() {
  const { open } = useVertexChat();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const timerRef = useRef(null);
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  if (pathname === '/' || pathname === '/Home') return null;

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
      navigate('/');
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
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 select-none"
      style={{
        filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.5))',
        transform: `translateX(-50%) scale(${pressing ? 0.9 : 1})`,
        transition: 'transform 0.15s ease',
      }}
    >
      <img src={vertexLogo} alt="Vertex AI" className="w-14 h-14 object-contain rounded-2xl" />
    </button>
  );
}
