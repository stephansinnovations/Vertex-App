import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Mail, Shield, Phone, Briefcase, Edit2, Check, X } from 'lucide-react';

export default function MyProfile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const u = await base44.auth.me();
      setForm({ phone: u?.phone || '', job_title: u?.job_title || '' });
      return u;
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setEditing(false);
    }
  });

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-md mx-auto">
        <button
          onClick={() => navigate('/Profile')}
          className="text-gray-400 hover:text-white transition-colors mb-6 flex items-center gap-2"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-4xl font-bold text-white tracking-tight">My Profile</h1>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
              <Edit2 className="w-4 h-4" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="flex items-center gap-1.5 text-sm text-green-400 hover:text-green-300 transition-colors">
                <Check className="w-4 h-4" /> Save
              </button>
              <button onClick={() => setEditing(false)} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-gray-500 text-sm">Loading...</div>
        ) : (
          <div className="space-y-4">
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
                  <p className="text-white font-medium">{user?.full_name || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
                <Mail className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Email</p>
                  <p className="text-white font-medium">{user?.email || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
                <Shield className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">Role</p>
                  <p className="text-white font-medium capitalize">{user?.role || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
                <Briefcase className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-0.5">Job Title</p>
                  {editing ? (
                    <input value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} placeholder="e.g. Van Builder" className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-zinc-400" />
                  ) : (
                    <p className="text-white font-medium">{user?.job_title || '—'}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 px-5 py-4">
                <Phone className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-gray-500 mb-0.5">Phone</p>
                  {editing ? (
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="e.g. 555-123-4567" className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-zinc-400" />
                  ) : (
                    <p className="text-white font-medium">{user?.phone || '—'}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}