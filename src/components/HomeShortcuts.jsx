import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShortcut } from '@/lib/ShortcutContext';
import { Folder, FileText, Package, Users, Layers, Bus, Minus } from 'lucide-react';

const ICON_MAP = { Folder, FileText, Package, Users, Layers, Bus };
const ICON_SIZE = 72;
const LABEL_H = 28;
const TILE_W = 88;
const TILE_H = ICON_SIZE + LABEL_H;
const COLS = 2;
const GAP = 16;

const JIGGLE_KEYFRAMES = `
@keyframes jiggle {
  0%   { transform: rotate(-2deg); }
  25%  { transform: rotate(2deg); }
  50%  { transform: rotate(-1.5deg); }
  75%  { transform: rotate(1.5deg); }
  100% { transform: rotate(-2deg); }
}
`;

// Total grid width
const GRID_W = COLS * TILE_W + (COLS - 1) * GAP;

function getNextSlot(shortcuts) {
  const occupied = new Set(shortcuts.map(s => `${s.grid_x},${s.grid_y}`));
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  return { x: 0, y: shortcuts.length };
}

// Convert grid coords to pixel offset within the grid container
function gridToOffset(grid_x, grid_y) {
  return {
    x: grid_x * (TILE_W + GAP),
    y: grid_y * (TILE_H + GAP),
  };
}

// Snap pixel offset (within grid container) to nearest grid cell
function snapToGrid(x, y) {
  const col = Math.round(x / (TILE_W + GAP));
  const row = Math.round(y / (TILE_H + GAP));
  const clampedCol = Math.max(0, Math.min(COLS - 1, col));
  const clampedRow = Math.max(0, row);
  return {
    x: clampedCol * (TILE_W + GAP),
    y: clampedRow * (TILE_H + GAP),
    grid_x: clampedCol,
    grid_y: clampedRow,
  };
}

function loadShortcuts() {
  try { return JSON.parse(localStorage.getItem('homeShortcuts') || '[]'); } catch { return []; }
}
function saveShortcuts(s) { localStorage.setItem('homeShortcuts', JSON.stringify(s)); }

export default function HomeShortcuts() {
  const navigate = useNavigate();
  const { pending, setPending } = useShortcut();
  const containerRef = useRef(null);

  const [editMode, setEditMode] = useState(false);
  const [offsets, setOffsets] = useState({});
  const [shortcuts, setShortcuts] = useState(() => loadShortcuts());

  const dragging = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const addMutation = { mutate: (data) => {
    const newShortcut = { ...data, id: Date.now().toString() };
    const updated = [...shortcuts, newShortcut];
    saveShortcuts(updated);
    setShortcuts(updated);
  }};

  const removeMutation = { mutate: (id) => {
    const updated = shortcuts.filter(s => s.id !== id);
    saveShortcuts(updated);
    setShortcuts(updated);
    setOffsets(prev => { const n = { ...prev }; delete n[id]; return n; });
  }};

  const updateMutation = { mutate: ({ id, data }) => {
    const updated = shortcuts.map(s => s.id === id ? { ...s, ...data } : s);
    saveShortcuts(updated);
    setShortcuts(updated);
  }};

  // Recompute offsets when shortcuts load
  useEffect(() => {
    if (!shortcuts.length) return;
    setOffsets(() => {
      const next = {};
      shortcuts.forEach(s => {
        next[s.id] = gridToOffset(s.grid_x || 0, s.grid_y || 0);
      });
      return next;
    });
  }, [shortcuts]);

  // Auto-place pending shortcut
  useEffect(() => {
    if (pending) {
      const { x, y } = getNextSlot(shortcuts);
      addMutation.mutate({
        user_email: 'local',
        label: pending.label,
        icon: pending.icon,
        path: pending.path,
        grid_x: x,
        grid_y: y,
      });
      setPending(null);
    }
  }, [pending]);

  const longPressTimers = useRef({});

  const handlePointerDown = useCallback((e, id) => {
    e.preventDefault();
    const off = offsets[id] || { x: 0, y: 0 };

    longPressTimers.current[id] = setTimeout(() => {
      setEditMode(true);
    }, 500);

    // Store the pointer position relative to the container origin
    const container = containerRef.current;
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };

    dragging.current = {
      id,
      offsetX: (e.clientX - rect.left) - off.x,
      offsetY: (e.clientY - rect.top) - off.y,
      moved: false,
    };
    setDragId(id);
    setDragOffset({ x: off.x, y: off.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [offsets]);

  const handlePointerMove = useCallback((e, id) => {
    if (!dragging.current || dragging.current.id !== id) return;
    clearTimeout(longPressTimers.current[id]);
    dragging.current.moved = true;

    const container = containerRef.current;
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };

    const newX = (e.clientX - rect.left) - dragging.current.offsetX;
    const newY = (e.clientY - rect.top) - dragging.current.offsetY;
    setDragOffset({ x: newX, y: newY });
  }, []);

  const handlePointerUp = useCallback((e, id, shortcut) => {
    clearTimeout(longPressTimers.current[id]);
    if (!dragging.current || dragging.current.id !== id) return;

    const moved = dragging.current.moved;
    const container = containerRef.current;
    const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };

    const finalX = (e.clientX - rect.left) - dragging.current.offsetX;
    const finalY = (e.clientY - rect.top) - dragging.current.offsetY;

    dragging.current = null;
    setDragId(null);

    if (moved) {
      const snapped = snapToGrid(finalX, finalY);
      const occupied = shortcuts.find(s => s.id !== id && s.grid_x === snapped.grid_x && s.grid_y === snapped.grid_y);
      if (occupied) {
        const original = shortcuts.find(s => s.id === id);
        if (original) {
          setOffsets(prev => ({ ...prev, [id]: gridToOffset(original.grid_x || 0, original.grid_y || 0) }));
        }
        return;
      }
      setOffsets(prev => ({ ...prev, [id]: { x: snapped.x, y: snapped.y } }));
      updateMutation.mutate({ id, data: { grid_x: snapped.grid_x, grid_y: snapped.grid_y } });
    } else if (!editMode) {
      navigate(shortcut.path);
    }
  }, [editMode, navigate, shortcuts]);

  const handleRemove = useCallback((id) => {
    removeMutation.mutate(id);
  }, [removeMutation]);

  // Tap outside to exit edit mode
  useEffect(() => {
    if (!editMode) return;
    const handler = () => setEditMode(false);
    window.addEventListener('pointerdown', handler, { capture: true, once: true });
    return () => window.removeEventListener('pointerdown', handler, { capture: true });
  }, [editMode]);

  // Compute grid height for container sizing
  const maxRow = shortcuts.reduce((m, s) => Math.max(m, s.grid_y || 0), 0);
  const gridH = (maxRow + 1) * (TILE_H + GAP) - GAP;

  if (!shortcuts.length) return null;

  return (
    <>
      <style>{JIGGLE_KEYFRAMES}</style>
      {/* Centered grid container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: GRID_W,
          height: gridH,
          margin: '0 auto',
        }}
      >
        {shortcuts.map(s => {
          const Icon = ICON_MAP[s.icon] || Folder;
          const off = offsets[s.id] || { x: 0, y: 0 };
          const isDragging = dragId === s.id;
          const displayOff = isDragging ? dragOffset : off;

          return (
            <div
              key={s.id}
              onPointerDown={e => handlePointerDown(e, s.id)}
              onPointerMove={e => handlePointerMove(e, s.id)}
              onPointerUp={e => handlePointerUp(e, s.id, s)}
              style={{
                position: 'absolute',
                left: displayOff.x,
                top: displayOff.y,
                width: TILE_W,
                zIndex: isDragging ? 9999 : 1,
                touchAction: 'none',
                userSelect: 'none',
                cursor: isDragging ? 'grabbing' : 'grab',
                transform: isDragging ? 'scale(1.12)' : 'scale(1)',
                transition: isDragging ? 'none' : 'transform 0.15s ease',
                animation: editMode && !isDragging ? 'jiggle 0.25s ease-in-out infinite' : 'none',
                transformOrigin: 'center center',
              }}
            >
              <div className="flex flex-col items-center">
                <div className="relative" style={{ width: ICON_SIZE, height: ICON_SIZE }}>
                  <div
                    className="w-full h-full relative flex items-center justify-center overflow-hidden"
                    style={{
                      borderRadius: 18,
                      background: 'rgba(255,255,255,0.13)',
                      backdropFilter: 'saturate(180%) blur(24px)',
                      WebkitBackdropFilter: 'saturate(180%) blur(24px)',
                      boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.15)',
                      border: '0.5px solid rgba(255,255,255,0.25)',
                    }}
                  >
                    {/* Specular highlight */}
                    <div className="absolute top-1.5 left-2 w-8 h-4 rounded-full opacity-30 pointer-events-none"
                      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.9), transparent)' }} />
                    <Icon className="w-8 h-8 relative z-10" style={{ color: 'rgba(255,255,255,0.9)', strokeWidth: 1.6 }} />
                  </div>
                  {editMode && (
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); handleRemove(s.id); }}
                      className="absolute -top-2 -left-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md border border-white/20"
                      style={{ zIndex: 10 }}
                    >
                      <Minus className="w-3 h-3 text-white" strokeWidth={3} />
                    </button>
                  )}
                </div>
                <span
                  className="mt-1.5 text-center"
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: 0.1,
                    color: 'rgba(255,255,255,0.88)',
                    width: TILE_W,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                  }}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}