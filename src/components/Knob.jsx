import React, { useRef, useCallback, useEffect } from 'react';

// A Vital-style rotary knob: a 270° track with a teal value arc and a pointer.
// Drag vertically (or scroll) to change. Value is 0..1; the parent formats the
// readout via `format`. Double-click resets to `defaultValue`.

const START = -135; // degrees, 0 = up
const SWEEP = 270;
const TEAL = '#36d6c3';

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, a0, a1) {
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export default function Knob({ value, onChange, size = 46, defaultValue = 0 }) {
  const drag = useRef(null);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 5;
  const angle = START + value * SWEEP;
  const ptr = polar(cx, cy, r - 2, angle);
  const ptrIn = polar(cx, cy, r * 0.42, angle);

  const onMove = useCallback((e) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    const v = Math.max(0, Math.min(1, drag.current.v + dy / 150));
    onChange(v);
  }, [onChange]);

  const onUp = useCallback(() => { drag.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [onMove, onUp]);

  const onDown = (e) => { e.preventDefault(); drag.current = { y: e.clientY, v: value }; };
  const onWheel = (e) => { onChange(Math.max(0, Math.min(1, value - Math.sign(e.deltaY) * 0.03))); };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="cursor-ns-resize touch-none select-none"
      onPointerDown={onDown}
      onDoubleClick={() => onChange(defaultValue)}
      onWheel={onWheel}
    >
      {/* Track */}
      <path d={arcPath(cx, cy, r, START, START + SWEEP)} fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="3.5" strokeLinecap="round" />
      {/* Value arc */}
      {value > 0.001 && (
        <path d={arcPath(cx, cy, r, START, angle)} fill="none" stroke={TEAL} strokeWidth="3.5" strokeLinecap="round" />
      )}
      {/* Body */}
      <circle cx={cx} cy={cy} r={r * 0.74} fill="#2b2f37" stroke="#000" strokeOpacity="0.4" />
      {/* Pointer */}
      <line x1={ptrIn.x} y1={ptrIn.y} x2={ptr.x} y2={ptr.y} stroke="#e8eef0" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
