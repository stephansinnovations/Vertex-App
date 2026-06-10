import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Mail, Phone, Briefcase, ChevronRight } from 'lucide-react';

function RoleBadge({ role }) {
  const admin = role === 'admin';
  return (
    <span
      className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={admin
        ? { background: 'rgba(139,92,246,0.18)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.35)' }
        : { background: 'rgba(255,255,255,0.06)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.12)' }}
    >
      {admin ? 'Admin' : 'Member'}
    </span>
  );
}

export default function TeamProfiles() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').order('created_at');
      return data || [];
    },
  });

  if (selected) {
    return (
      <div className="min-h-screen bg-black p-6">
        <div className="max-w-md mx-auto">
          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white transition-colors mb-6 flex items-center gap-2">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 mb-8">
            <h1 className="text-4xl font-bold text-white tracking-tight">{selected.full_name || selected.email || 'Employee'}</h1>
            <RoleBadge role={selected.role} />
          </div>

          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <User className="w-10 h-10 text-gray-400" />
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
              <User className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Full Name</p>
                <p className="text-white font-medium">{selected.full_name || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
              <Mail className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Email</p>
                <p className="text-white font-medium">{selected.email || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
              <Briefcase className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Job Title</p>
                <p className="text-white font-medium">{selected.job_title || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 px-5 py-4">
              <Phone className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Phone</p>
                <p className="text-white font-medium">{selected.phone || '—'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-md mx-auto">
        <button onClick={() => navigate('/Profile')} className="text-gray-400 hover:text-white transition-colors mb-6 flex items-center gap-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-4xl font-bold text-white tracking-tight mb-8">Team</h1>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading...</div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            {users.map((u, index) => (
              <div
                key={u.id}
                onClick={() => setSelected(u)}
                className={`flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-zinc-800/60 transition-colors ${index !== users.length - 1 ? 'border-b border-zinc-800' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{u.full_name || u.email}</p>
                    {u.job_title && <p className="text-gray-500 text-xs">{u.job_title}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <RoleBadge role={u.role} />
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}