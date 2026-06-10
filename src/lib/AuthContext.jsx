import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

// Bootstrap admin: always treated as admin even before the profiles table/row exists,
// so the owner can never lock themselves out. Other admins come from profiles.role.
const ADMIN_EMAIL = 'stephansinnovations@gmail.com';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings] = useState({ id: 'local', public_settings: {} });

  const loadProfile = async (u) => {
    if (!u) { setProfile(null); return; }
    setIsLoadingProfile(true);
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', u.id).maybeSingle();
      setProfile(data || null);
    } catch {
      setProfile(null); // table may not exist yet — admin still covered by the email fallback
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setIsAuthenticated(true);
        loadProfile(session.user);
      }
      setIsLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setIsAuthenticated(true);
        setAuthError(null);
        loadProfile(session.user);
      } else {
        setUser(null);
        setProfile(null);
        setIsAuthenticated(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const isBootstrapAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
  const role = profile?.role || (isBootstrapAdmin ? 'admin' : 'member');
  const isAdmin = role === 'admin' || isBootstrapAdmin; // owner can never be locked out

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
  };

  const navigateToLogin = () => {
    window.location.href = '/Login';
  };

  const checkAppState = async () => {};

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      role,
      isAdmin,
      isAuthenticated,
      isLoadingAuth,
      isLoadingProfile,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
