import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Mail, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function MyProfile() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/Login');
  };

  const displayName = user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.email?.split('@')[0]
    || 'User';

  const avatar = user?.user_metadata?.avatar_url;

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-md mx-auto">
        <button onClick={() => navigate('/Profile')}
          className="text-gray-400 hover:text-white transition-colors mb-6 flex items-center gap-2">
          <ArrowLeft className="w-5 h-5" />
        </button>

        <h1 className="text-4xl font-bold text-white tracking-tight mb-8">My Profile</h1>

        {/* Avatar */}
        <div className="flex justify-center mb-8">
          {avatar ? (
            <img src={avatar} alt={displayName}
              className="w-24 h-24 rounded-full border-2 border-zinc-700 object-cover" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <User className="w-10 h-10 text-gray-400" />
            </div>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-6">
          <div className="flex items-center gap-4 px-5 py-4 border-b border-zinc-800">
            <User className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Name</p>
              <p className="text-white font-medium">{displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 px-5 py-4">
            <Mail className="w-5 h-5 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Email</p>
              <p className="text-white font-medium">{user?.email || '—'}</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 bg-red-900/30 border border-red-900/50 text-red-400 font-medium py-3 rounded-xl hover:bg-red-900/50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
