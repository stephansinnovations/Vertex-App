import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Search, Plus, Camera } from 'lucide-react';
import { motion } from 'framer-motion';

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
        {/* Search Parts Library */}
        <button
          onClick={() => navigate('/PartsLibrary?focus=search')}
          className="w-full flex items-center justify-between px-6 py-5 cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors duration-150"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <div className="flex items-center gap-3">
            <Search className="w-5 h-5 text-gray-400" />
            <span className="text-lg font-medium tracking-wide text-white">Search Parts</span>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>

        {/* Add Part */}
        <button
          onClick={() => navigate('/PartsLibrary?add=1')}
          className="w-full flex items-center justify-between px-6 py-5 cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 transition-colors duration-150"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <div className="flex items-center gap-3">
            <Plus className="w-5 h-5 text-gray-400" />
            <span className="text-lg font-medium tracking-wide text-white">Add Part</span>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>

        {/* Photo → Add Part (replaces Scan Parts) */}
        <button
          onClick={() => navigate('/PartsLibrary?photo=1')}
          className="w-full flex items-center justify-between px-6 py-5 cursor-pointer rounded-2xl border border-blue-900/50 bg-blue-950/30 hover:bg-blue-950/50 transition-colors duration-150"
          style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        >
          <div className="flex items-center gap-3">
            <Camera className="w-5 h-5 text-blue-400" />
            <div className="text-left">
              <span className="text-lg font-medium tracking-wide text-white block">Photo → Add Part</span>
              <span className="text-xs text-blue-400/70">Snap a part, AI fills it in</span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-500" />
        </button>
      </div>
    </motion.div>
  );
}