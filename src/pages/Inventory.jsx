import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Package, Layers, ScanLine } from 'lucide-react';
import { motion } from 'framer-motion';
import LongPressRow from '@/components/LongPressRow';

const TABS = [
  { id: 'parts', label: 'Parts Library', icon: Package, path: '/PartsLibrary' },
  { id: 'stock', label: 'Stock', icon: Layers, path: '/Stock' },
];

export default function Inventory() {
  const navigate = useNavigate();

  return (
    <motion.div
      className="min-h-screen flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Header */}
      <div className="w-full max-w-lg px-6 mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-4xl font-bold text-white tracking-tight">Inventory</h1>
      </div>

      {/* Menu Cards */}
      <div className="w-full max-w-lg px-6 space-y-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <LongPressRow
              key={tab.id}
              label={tab.label}
              icon={tab.id === 'parts' ? 'Package' : 'Layers'}
              path={tab.path}
              onClick={() => navigate(tab.path)}
              className="w-full flex items-center justify-between px-6 py-5 cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors duration-150"
              style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 text-gray-400" />
                <span className="text-lg font-medium tracking-wide text-white">{tab.label}</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </LongPressRow>
          );
        })}

        {/* Scan Parts */}
        <button
          onClick={() => navigate('/GeminiScanner')}
          className="w-full flex items-center justify-between px-6 py-5 cursor-pointer rounded-2xl border border-blue-900/50 bg-blue-950/30 hover:bg-blue-950/50 transition-colors duration-150"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <div className="flex items-center gap-3">
            <ScanLine className="w-5 h-5 text-blue-400" />
            <div className="text-left">
              <span className="text-lg font-medium tracking-wide text-white block">Scan Parts</span>
              <span className="text-xs text-blue-400/70">Live AI recognition</span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
      </div>
    </motion.div>
  );
}