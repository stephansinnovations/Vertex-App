import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

// Small bottom-right shortcut back to AI Rooms — replaces the floating orb's
// old tap-to-Rooms behavior (the orb is now the Jarvis toggle). Admin-only,
// like the /Rooms route itself.
export default function FloatingRoomsButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isAdmin } = useAuth();

  if (!isAdmin) return null;
  if (['/', '/Home', '/Login', '/Rooms'].includes(pathname)) return null;

  return (
    <button
      onClick={() => navigate('/Rooms')}
      aria-label="AI Rooms"
      className="fixed bottom-7 right-4 z-30 w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-transform"
      style={{
        background: 'radial-gradient(circle at 35% 28%, rgba(199,181,255,0.35), rgba(30,20,60,0.85))',
        border: '1px solid rgba(167,139,250,0.4)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.45), 0 0 12px rgba(139,92,246,0.35)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {/* Mini room-cluster glyph */}
      <span className="relative block" style={{ width: 18, height: 18 }}>
        <span className="absolute rounded-full" style={{ width: 9, height: 9, left: 4.5, top: 4.5, background: 'rgba(199,181,255,0.95)' }} />
        <span className="absolute rounded-full" style={{ width: 5, height: 5, left: 0, top: 2, background: 'rgba(129,140,248,0.9)' }} />
        <span className="absolute rounded-full" style={{ width: 5, height: 5, right: 0, top: 0, background: 'rgba(236,72,153,0.85)' }} />
        <span className="absolute rounded-full" style={{ width: 5, height: 5, right: 1, bottom: 0, background: 'rgba(16,185,129,0.85)' }} />
      </span>
    </button>
  );
}
