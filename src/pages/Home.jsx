import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Package, Users, Bus, UserCircle } from 'lucide-react';
import vertexLogo from '@/assets/Vertex-logo.webp';
import { createPageUrl } from '../utils';
import { motion } from 'framer-motion';
import HomeShortcuts from '@/components/HomeShortcuts';
import { useVertexChat } from '@/lib/VertexChatContext';

const DEFAULT_LOGO = 'https://media.base44.com/images/public/6993c32ea9b395384e8b7f61/0e0de3cfb_VertexBannerLogoPrint.png';

// Apple-style glass nav icon
function NavIcon({ icon: Icon, label, onClick, accent }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 select-none active:scale-90 transition-transform duration-100">
      <Icon
        className="w-6 h-6"
        style={{ color: accent ? 'var(--ios-blue)' : 'rgba(255,255,255,0.55)' }}
        strokeWidth={1.8}
      />
      <span style={{
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: 0.2,
        color: accent ? 'var(--ios-blue)' : 'rgba(255,255,255,0.45)',
      }}>
        {label}
      </span>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { open: openChat } = useVertexChat();

  return (
    <motion.div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ backgroundColor: 'transparent' }}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Shortcuts grid */}
      <HomeShortcuts />

      {/* Vertex banner logo */}
      <img
        src={DEFAULT_LOGO}
        alt="Vertex Vans Logo"
        className="w-72 object-contain mb-4"
        style={{ filter: 'invert(1) brightness(0.92)', opacity: 0.9 }}
      />

      {/* Bottom area */}
      <div className="fixed bottom-0 left-0 right-0 z-40">

        {/* Vertex AI bubble — floating above dock */}
        <div className="flex justify-center pb-3">
          <motion.button
            onClick={() => navigate('/AIRoom')}
            whileTap={{ scale: 0.88 }}
            className="relative select-none"
            style={{ filter: 'drop-shadow(0 8px 24px rgba(139,92,246,0.5))' }}
          >
            {/* Glass sphere */}
            <div className="w-16 h-16 rounded-full relative overflow-hidden flex items-center justify-center"
              style={{
                background: 'radial-gradient(circle at 35% 28%, rgba(139,92,246,0.7), rgba(80,40,160,0.85))',
                boxShadow: '0 8px 32px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.2)',
                border: '0.5px solid rgba(255,255,255,0.3)',
              }}>
              {/* Specular highlight */}
              <div className="absolute top-1.5 left-3 w-7 h-3.5 rounded-full opacity-40"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.9), transparent)' }} />
              {/* Bottom shadow */}
              <div className="absolute bottom-0 inset-x-0 h-6 rounded-b-full opacity-20"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)' }} />
              <img src={vertexLogo} alt="Vertex" className="w-9 h-9 object-contain relative z-10" />
            </div>
          </motion.button>
        </div>

        {/* iOS-style tab bar */}
        <div className="ios-tab-bar flex items-center justify-around px-6 pt-3"
          style={{ paddingBottom: `calc(1.5rem + env(safe-area-inset-bottom))` }}>
          <NavIcon icon={FileText} label="SOPs" onClick={() => navigate(createPageUrl('SOPList'))} />
          <NavIcon icon={Package} label="Inventory" onClick={() => navigate('/Inventory')} />
          <NavIcon icon={Bus} label="Builds" onClick={() => navigate('/Builds')} />
          <NavIcon icon={Users} label="Contacts" onClick={() => navigate('/Contacts')} />
          <NavIcon icon={UserCircle} label="Profile" onClick={() => navigate('/Profile')} />
        </div>
      </div>
    </motion.div>
  );
}
