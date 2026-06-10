import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

// Gate a route to admins only. Non-admins are redirected home. This is the UX layer;
// the real enforcement is Supabase RLS on the underlying data (see docs/access-control-plan.md).
export default function AdminRoute({ children }) {
  const { isLoadingAuth, isLoadingProfile, isAdmin } = useAuth();

  if (isLoadingAuth || isLoadingProfile) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="w-8 h-8 border-4 border-zinc-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/" replace />;

  return children;
}
