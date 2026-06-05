import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Package, Users, Bus, UserCircle, Settings } from 'lucide-react';
import vertexLogo from '@/assets/Vertex-logo.webp';
import { createPageUrl } from '../utils';
import { motion } from 'framer-motion';
import HomeShortcuts from '@/components/HomeShortcuts';
import { useShortcut } from '@/lib/ShortcutContext';
import { useVertexChat } from '@/lib/VertexChatContext';

const DEFAULT_LOGO = 'https://media.base44.com/images/public/6993c32ea9b395384e8b7f61/0e0de3cfb_VertexBannerLogoPrint.png';

export default function Home() {
  const navigate = useNavigate();
  const { open: openChat } = useVertexChat();

  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('settingsBtnPos')) || { x: 20, y: window.innerHeight - 80 }; }
    catch { return { x: 20, y: window.innerHeight - 80 }; }
  });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = (e) => {
    dragging.current = false;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (e) => {
    dragging.current = true;
    const newPos = {
      x: Math.max(0, Math.min(window.innerWidth - 48, e.clientX - offset.current.x)),
      y: Math.max(0, Math.min(window.innerHeight - 48, e.clientY - offset.current.y)),
    };
    setPos(newPos);
  };

  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    setPos(prev => { localStorage.setItem('settingsBtnPos', JSON.stringify(prev)); return prev; });
    if (!dragging.current) navigate('/Profile');
  };

  return (
    <motion.div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ backgroundColor: 'transparent' }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Draggable Settings Button */}
      <div
        onPointerDown={onPointerDown}
        style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 60, touchAction: 'none', cursor: 'grab' }}
        className="w-11 h-11 rounded-full bg-zinc-800/90 border border-zinc-700 backdrop-blur-sm flex items-center justify-center text-gray-400 hover:text-white shadow-lg select-none"
      >
        <Settings className="w-5 h-5" />
      </div>

      {/* Shortcuts grid */}
      <HomeShortcuts />

      {/* Logo */}
      <img
        src={DEFAULT_LOGO}
        alt="Vertex Vans Logo"
        className="w-80 object-contain"
        style={{ filter: 'invert(1) brightness(0.95)' }}
      />

      {/* Bottom Bar — two rows */}
      <div className="fixed bottom-0 left-0 right-0 z-40">
        {/* Row 1 — Vertex AI centered, transparent */}
        <div className="flex justify-center pt-3 pb-1">
          <button onClick={() => navigate('/AIRoom')} className="flex flex-col items-center gap-1">
            <img src={vertexLogo} alt="Vertex" className="w-14 h-14 object-contain rounded-2xl shadow-lg" />
          </button>
        </div>

        {/* Row 2 — nav icons with dark background */}
        <div className="flex items-center justify-around px-8 pb-6 pt-2 bg-black/95 backdrop-blur-md border-t border-zinc-800">
          <button onClick={() => navigate(createPageUrl('SOPList'))} className="flex flex-col items-center gap-1">
            <FileText className="w-5 h-5 text-white/70" />
            <span className="text-[9px] text-white/50 font-medium">SOPs</span>
          </button>
          <button onClick={() => navigate('/Inventory')} className="flex flex-col items-center gap-1">
            <Package className="w-5 h-5 text-white/70" />
            <span className="text-[9px] text-white/50 font-medium">Inventory</span>
          </button>
          <button onClick={() => navigate('/Builds')} className="flex flex-col items-center gap-1">
            <Bus className="w-5 h-5 text-white/70" />
            <span className="text-[9px] text-white/50 font-medium">Builds</span>
          </button>
          <button onClick={() => navigate('/Contacts')} className="flex flex-col items-center gap-1">
            <Users className="w-5 h-5 text-white/70" />
            <span className="text-[9px] text-white/50 font-medium">Contacts</span>
          </button>
          <button onClick={() => navigate('/Profile')} className="flex flex-col items-center gap-1">
            <UserCircle className="w-5 h-5 text-white/70" />
            <span className="text-[9px] text-white/50 font-medium">Profile</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}