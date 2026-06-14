import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

// Admin-only floating gear you can drag anywhere on screen (position persists).
// A tap (not a drag) opens Settings, recording the page you came from so the
// Settings back button returns there instead of its default.
const SIZE = 48;
const STORAGE = 'floatingSettingsPos';
const MOVE_THRESHOLD = 4; // px before a press counts as a drag, not a tap

function clampToViewport(p) {
  const w = typeof window !== 'undefined' ? window.innerWidth : 400;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  return {
    x: Math.min(Math.max(8, p.x), w - SIZE - 8),
    y: Math.min(Math.max(8, p.y), h - SIZE - 8),
  };
}

function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE));
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return clampToViewport(p);
  } catch { /* ignore */ }
  const w = typeof window !== 'undefined' ? window.innerWidth : 400;
  return { x: w - SIZE - 16, y: 96 }; // default: top-right
}

export default function FloatingSettingsButton() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [pos, setPos] = useState(loadPos);
  const drag = useRef({ active: false, moved: false, startX: 0, startY: 0, dx: 0, dy: 0 });

  // Persist position, and keep it on-screen across resizes.
  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(pos)); } catch { /* quota */ } }, [pos]);
  useEffect(() => {
    const onResize = () => setPos(p => clampToViewport(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Hidden for non-admins, and on Settings/Login (redundant / no nav).
  if (!isAdmin || pathname === '/Settings' || pathname === '/Login') return null;

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY, dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d.active) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > MOVE_THRESHOLD) d.moved = true;
    if (d.moved) setPos(clampToViewport({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    d.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d.moved) {
      // A tap: go to Settings, remembering where we came from for the back button.
      navigate('/Settings', { state: { fromFloating: pathname } });
    }
  };

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={e => e.preventDefault()}
      title="Settings"
      className="fixed z-40 select-none flex items-center justify-center rounded-full text-white"
      style={{
        left: pos.x, top: pos.y, width: SIZE, height: SIZE, touchAction: 'none',
        background: 'rgba(24,24,27,0.92)',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        cursor: 'grab',
      }}
    >
      <SettingsIcon className="w-5 h-5" />
    </button>
  );
}
