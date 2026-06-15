import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCircle } from 'lucide-react';
import sopIcon from '@/assets/sop-icon.png';
import partsIcon from '@/assets/parts-icon.png';
import buildsIcon from '@/assets/builds-icon.png';
import contactsIcon from '@/assets/contacts-icon.png';
import { createPageUrl } from '../utils';
import { motion } from 'framer-motion';
import HomeShortcuts from '@/components/HomeShortcuts';
import { useVertexChat } from '@/lib/VertexChatContext';
import { useAuth } from '@/lib/AuthContext';

const DEFAULT_LOGO = 'https://media.base44.com/images/public/6993c32ea9b395384e8b7f61/0e0de3cfb_VertexBannerLogoPrint.png';

// The "apps" that live in the iOS-style dock. SOPs, Builds and Contacts are
// admin-only (hidden for members; their routes are gated by AdminRoute too).
const DOCK_APPS = [
  { image: sopIcon,   label: 'SOPs',      path: createPageUrl('SOPList'), adminOnly: true },
  { image: partsIcon, label: 'Inventory', path: '/PartsLibrary' },
  { image: buildsIcon, label: 'Builds',   path: '/Builds', adminOnly: true },
  { image: contactsIcon, label: 'Contacts', path: '/Contacts', adminOnly: true },
  { icon: UserCircle, label: 'Profile',   path: '/Profile',               gradient: 'linear-gradient(160deg, #c084fc 0%, #7c3aed 100%)' },
];

const ICON = 58; // iOS dock app-icon size

// A single iOS-style app icon — either a gradient squircle with a lucide glyph,
// or a full-bleed custom image that already carries its own squircle artwork.
function AppIcon({ icon: Icon, image, label, gradient, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex flex-col items-center select-none active:scale-90 transition-transform duration-100"
      style={{ width: ICON }}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          width: ICON,
          height: ICON,
          borderRadius: ICON * 0.2237, // iOS squircle ratio
          background: image ? 'transparent' : gradient,
          boxShadow: '0 6px 16px rgba(0,0,0,0.35)' + (image ? '' : ', inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.18)'),
          border: image ? 'none' : '0.5px solid rgba(255,255,255,0.18)',
        }}
      >
        {image ? (
          <img src={image} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <>
            {/* Glossy highlight across the top half */}
            <div
              className="absolute inset-x-0 top-0 pointer-events-none"
              style={{ height: '52%', background: 'linear-gradient(to bottom, rgba(255,255,255,0.32), transparent)' }}
            />
            <Icon className="relative z-10" style={{ width: 28, height: 28, color: '#fff', strokeWidth: 2 }} />
          </>
        )}
      </div>
      <span
        className="mt-1.5 text-center"
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 0.1,
          color: 'rgba(255,255,255,0.9)',
          textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { open: openChat } = useVertexChat();
  const { isAdmin } = useAuth();
  const dockApps = DOCK_APPS.filter(app => isAdmin || !app.adminOnly);

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
      <div className="fixed bottom-0 left-0 right-0 z-40 flex flex-col items-center"
        style={{ paddingBottom: `calc(1rem + env(safe-area-inset-bottom))` }}>

        {/* Vertex Room — low-profile purple glow pill, right above the dock */}
        <motion.button
          onClick={() => navigate('/AIRoom')}
          whileTap={{ scale: 0.9 }}
          aria-label="Vertex Room"
          className="select-none mb-4"
          style={{
            width: 52,
            height: 12,
            borderRadius: 6,
            background: '#a855f7',
            boxShadow: '0 0 14px 2px rgba(168,85,247,0.85), 0 0 28px rgba(168,85,247,0.5)',
          }}
        />

        {/* iOS-style frosted dock */}
        <div
          className="flex items-center justify-center gap-3 md:gap-7"
          style={{
            padding: '12px 14px',
            borderRadius: 34,
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'saturate(180%) blur(28px)',
            WebkitBackdropFilter: 'saturate(180%) blur(28px)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
          }}
        >
          {dockApps.map(app => (
            <AppIcon
              key={app.label}
              icon={app.icon}
              image={app.image}
              label={app.label}
              gradient={app.gradient}
              onClick={() => navigate(app.path)}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
