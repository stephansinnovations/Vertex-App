import React from 'react';
import { useLocation } from 'react-router-dom';
import { useVertexChat } from '@/lib/VertexChatContext';
import vertexLogo from '@/assets/vertex-logo.png';

export default function FloatingVertexButton() {
  const { open } = useVertexChat();
  const { pathname } = useLocation();

  // Home has its own Vertex button in the nav bar
  if (pathname === '/' || pathname === '/Home') return null;

  return (
    <button
      onClick={open}
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 w-13 h-13 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
      style={{
        width: 52,
        height: 52,
        background: '#000',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 0 24px rgba(255,255,255,0.08), 0 4px 20px rgba(0,0,0,0.6)',
      }}
    >
      <img src={vertexLogo} alt="Vertex AI" className="w-7 h-7 object-contain" />
    </button>
  );
}
