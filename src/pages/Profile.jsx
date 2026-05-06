import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, UserCircle, Users, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

const TABS = [
  { id: 'my', label: 'My Profile', icon: UserCircle, path: '/MyProfile' },
  { id: 'team', label: 'Team Profiles', icon: Users, path: '/TeamProfiles' },
];

export default function Profile() {
  const navigate = useNavigate();

  return (
    <motion.div
      className="min-h-screen flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="w-full max-w-lg px-6 mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-4xl font-bold text-white tracking-tight">Profile</h1>
      </div>

      <div
        className="w-full mx-6 rounded-2xl overflow-hidden border border-zinc-800"
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)', maxWidth: '480px' }}
      >
        {TABS.map((tab, index) => {
          const Icon = tab.icon;
          return (
            <motion.div
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`w-full flex items-center justify-between px-6 py-5 cursor-pointer hover:bg-zinc-900/60 transition-colors duration-150 ${index !== TABS.length - 1 ? 'border-b border-zinc-800' : ''}`}
              whileTap={{ scale: 0.97, opacity: 0.5 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5 text-gray-400" />
                <span className="text-lg font-medium tracking-wide text-white">{tab.label}</span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-500" />
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}