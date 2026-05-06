import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';

const ZONES = [
  // Top row
  { id: 'plumbing-inventory', label: 'Plumbing\nInventory', top: '10%', left: '23%', width: '12%', height: '20%' },
  { id: 'hardware-inventory', label: 'Hardware\nInventory', top: '10%', left: '36%', width: '12%', height: '20%' },
  { id: 'electrical-inventory', label: 'Electrical\nInventory', top: '10%', left: '49%', width: '12%', height: '20%' },
  { id: 'wires', label: 'Wires', top: '10%', left: '62%', width: '12%', height: '20%' },
  // Left
  { id: 'wood-stock', label: 'Wood /\nStock', top: '13%', left: '5%', width: '9%', height: '64%' },
  // Right column
  { id: 'windows-seats', label: 'Windows /\nSeats', top: '10%', left: '83%', width: '11%', height: '28%' },
  { id: 'builds-inventory', label: 'Builds\nInventory', top: '42%', left: '83%', width: '11%', height: '42%' },
  // Bottom row
  { id: 'plumbing-parts', label: 'Plumbing Parts', top: '72%', left: '35%', width: '13%', height: '18%' },
  { id: 'fasteners', label: 'Fasteners', top: '72%', left: '49%', width: '13%', height: '18%' },
  { id: 'electrical-parts', label: 'Electrical Parts', top: '72%', left: '63%', width: '13%', height: '18%' },
];

function ZoneCard({ zone, onClick }) {
  return (
    <button
      onClick={() => onClick(zone)}
      style={{
        position: 'absolute',
        top: zone.top,
        left: zone.left,
        width: zone.width,
        height: zone.height,
        backgroundColor: '#2a2a2a',
        borderRadius: '10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        transition: 'background-color 0.15s ease',
      }}
      className="hover:bg-zinc-600"
    >
      <span
        style={{
          color: 'white',
          fontSize: 'clamp(9px, 1.2vw, 14px)',
          fontWeight: 600,
          textAlign: 'center',
          whiteSpace: 'pre-line',
          lineHeight: 1.35,
          padding: '4px',
        }}
      >
        {zone.label}
      </span>
    </button>
  );
}

export default function Stock() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef(null);
  const didDrag = useRef(false);

  const handleZoneClick = (zone) => {
    navigate(`/StockLocation?location=${encodeURIComponent(zone.label.replace(/\n/g, ' '))}`);
  };

  const onPointerDown = (e) => {
    dragState.current = {
      startX: e.clientX - offset.x,
      startY: e.clientY - offset.y,
    };
    didDrag.current = false;
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const isMobile = window.innerWidth < 768;

  const onPointerMove = (e) => {
    if (!dragState.current || !isMobile) return;
    const newX = e.clientX - dragState.current.startX;
    const newY = e.clientY - dragState.current.startY;
    if (Math.abs(newX - offset.x) > 3) {
      didDrag.current = true;
    }
    setOffset({ x: newX, y: 0 });
  };

  const onPointerUp = () => {
    dragState.current = null;
  };

  return (
    <div className="min-h-screen flex flex-col p-6" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/Inventory')} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-4xl font-bold text-white tracking-tight">Stock</h1>
      </div>

      {/* Building Floor Plan */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            position: 'relative',
            width: '960px',
            aspectRatio: '16 / 9',
            backgroundColor: '#1a1a1a',
            borderRadius: '18px',
            border: '1px solid rgba(255,255,255,0.08)',
            touchAction: 'none',
            cursor: dragState.current ? 'grabbing' : 'grab',
            flexShrink: 0,
          }}
        >
          {ZONES.map(zone => (
            <ZoneCard key={zone.id} zone={zone} onClick={handleZoneClick} />
          ))}
        </div>
      </div>
    </div>
  );
}