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
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 transition-transform hover:scale-105 active:scale-95"
      style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.5))' }}
    >
      <img src={vertexLogo} alt="Vertex AI" className="w-14 h-14 object-contain rounded-2xl" />
    </button>
  );
}
