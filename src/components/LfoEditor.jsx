import React, { useRef, useState, useCallback, useEffect } from 'react';
import { sampleCurve } from '@/api/modEngine';

// A Vital-style LFO curve editor. Points are { x, y, curve } with x,y in 0..1.
// - Drag a point to move it (endpoints keep their x at 0/1).
// - Drag the small diamond between two points to bend that segment.
// - Double-click empty space to add a point; double-click a point to remove it.
// `playhead` (0..1) draws the live phase marker.

const W = 600;
const H = 240;
const PAD = { l: 10, r: 10, t: 12, b: 12 };
const TEAL = '#36d6c3';

const toPx = (xn, yn) => ({
  x: PAD.l + xn * (W - PAD.l - PAD.r),
  y: PAD.t + (1 - yn) * (H - PAD.t - PAD.b),
});

export default function LfoEditor({ points, onChange, playhead = null, gridX = 8 }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null); // { kind:'point'|'curve', index, startY, startCurve }
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const eventToNorm = useCallback((e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const vy = ((e.clientY - rect.top) / rect.height) * H;
    const xn = (vx - PAD.l) / (W - PAD.l - PAD.r);
    const yn = 1 - (vy - PAD.t) / (H - PAD.t - PAD.b);
    return { xn: Math.max(0, Math.min(1, xn)), yn: Math.max(0, Math.min(1, yn)) };
  }, []);

  const onMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { xn, yn } = eventToNorm(e);
    const pts = points.map((p) => ({ ...p }));
    if (drag.kind === 'point') {
      const i = drag.index;
      const isFirst = i === 0;
      const isLast = i === pts.length - 1;
      pts[i].y = yn;
      if (!isFirst && !isLast) {
        const lo = pts[i - 1].x + 0.005;
        const hi = pts[i + 1].x - 0.005;
        pts[i].x = Math.max(lo, Math.min(hi, xn));
      }
    } else if (drag.kind === 'curve') {
      const dy = yn - drag.startY;
      pts[drag.index].curve = Math.max(-1, Math.min(1, drag.startCurve + dy * 3));
    }
    onChange(pts);
  }, [points, onChange, eventToNorm]);

  const endDrag = useCallback(() => { dragRef.current = null; rerender(); }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
    };
  }, [onMove, endDrag]);

  const startPointDrag = (i) => (e) => { e.stopPropagation(); dragRef.current = { kind: 'point', index: i }; rerender(); };
  const startCurveDrag = (i) => (e) => {
    e.stopPropagation();
    const { yn } = eventToNorm(e);
    dragRef.current = { kind: 'curve', index: i, startY: yn, startCurve: points[i].curve || 0 };
    rerender();
  };

  const removePoint = (i) => (e) => {
    e.stopPropagation();
    if (i === 0 || i === points.length - 1) return; // keep endpoints
    onChange(points.filter((_, idx) => idx !== i));
  };

  const addPoint = (e) => {
    const { xn, yn } = eventToNorm(e);
    const pts = points.map((p) => ({ ...p }));
    let insert = pts.length - 1;
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (xn > pts[i].x && xn < pts[i + 1].x) { insert = i + 1; break; }
    }
    pts.splice(insert, 0, { x: xn, y: yn, curve: 0 });
    onChange(pts);
  };

  // Build the curve polyline by sampling (so bent segments match the engine).
  const N = 160;
  const linePts = [];
  for (let i = 0; i <= N; i += 1) {
    const xn = i / N;
    const { x, y } = toPx(xn, sampleCurve(points, xn));
    linePts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const baseY = toPx(0, 0).y;
  const areaPath = `M ${toPx(0, 0).x},${baseY} L ${linePts.join(' L ')} L ${toPx(1, 0).x},${baseY} Z`;
  const linePath = `M ${linePts.join(' L ')}`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full select-none touch-none"
      style={{ aspectRatio: `${W} / ${H}`, background: '#171a20', borderRadius: 8 }}
      onDoubleClick={addPoint}
    >
      <defs>
        <linearGradient id="lfoFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.45" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {Array.from({ length: Math.max(0, gridX - 1) }, (_, i) => (i + 1) / gridX).map((g) => (
        <line key={`v${g}`} x1={toPx(g, 0).x} y1={PAD.t} x2={toPx(g, 0).x} y2={H - PAD.b} stroke="#ffffff" strokeOpacity="0.05" />
      ))}
      {[0.5].map((g) => (
        <line key={`h${g}`} x1={PAD.l} y1={toPx(0, g).y} x2={W - PAD.r} y2={toPx(0, g).y} stroke="#ffffff" strokeOpacity="0.05" />
      ))}

      <path d={areaPath} fill="url(#lfoFill)" />
      <path d={linePath} fill="none" stroke={TEAL} strokeWidth="2.5" strokeLinejoin="round" />

      {/* Phase / start handle (bottom-left), decorative like Vital */}
      <rect x={PAD.l + 2} y={H - PAD.b - 6} width="16" height="7" rx="3.5" fill="#cfd6d8" opacity="0.85" />

      {/* Playhead */}
      {playhead != null && (
        <line x1={toPx(playhead, 0).x} y1={PAD.t} x2={toPx(playhead, 0).x} y2={H - PAD.b} stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" />
      )}

      {/* Curve (bend) handles at segment midpoints */}
      {points.slice(0, -1).map((p, i) => {
        const midXn = (p.x + points[i + 1].x) / 2;
        const { x, y } = toPx(midXn, sampleCurve(points, midXn));
        return (
          <rect
            key={`c${i}`}
            x={x - 3.5}
            y={y - 3.5}
            width="7"
            height="7"
            transform={`rotate(45 ${x} ${y})`}
            fill="#0b0d11"
            stroke={TEAL}
            strokeOpacity="0.7"
            style={{ cursor: 'ns-resize' }}
            onPointerDown={startCurveDrag(i)}
          />
        );
      })}

      {/* Point handles */}
      {points.map((p, i) => {
        const { x, y } = toPx(p.x, p.y);
        return (
          <circle
            key={`p${i}`}
            cx={x}
            cy={y}
            r="6"
            fill={TEAL}
            stroke="#0b0d11"
            strokeWidth="1.5"
            style={{ cursor: 'grab' }}
            onPointerDown={startPointDrag(i)}
            onDoubleClick={removePoint(i)}
          />
        );
      })}
    </svg>
  );
}
