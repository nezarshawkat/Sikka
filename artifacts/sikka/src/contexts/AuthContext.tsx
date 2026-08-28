import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useUser, useAuth as useClerkAuth } from '@clerk/react';
import { api, setAuthTokenProvider } from '@/lib/api';
import type { Language } from '@/lib/i18n';

export interface Profile {
  userId?: string;
  displayName: string | null;
  phone: string | null;
  language: string;
  nationality: string | null;
  hasRatedApp?: boolean;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: { id: string } | null;
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
  language: Language;
  setLanguage: (lang: Language) => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  isAdmin: false,
  isLoading: true,
  language: 'en',
  setLanguage: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user: clerkUser, isLoaded: userLoaded } = useUser();
  const { signOut: clerkSignOut, getToken } = useClerkAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('sikka-lang') as Language) || 'en';
  });

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('sikka_admin_token') : null;
  const sessionToken = typeof window !== 'undefined' ? localStorage.getItem('sikka_session_token') : null;

  useEffect(() => {
    setAuthTokenProvider(async () => getToken());
    return () => setAuthTokenProvider(null);
  }, [getToken]);

  const fetchProfile = useCallback(async () => {
    const hasAdminToken = !!localStorage.getItem('sikka_admin_token');
    const hasSessionToken = !!localStorage.getItem('sikka_session_token');
    if (!clerkUser && !hasAdminToken && !hasSessionToken) {
      setProfile(null);
      setIsAdmin(false);
      setProfileLoaded(true);
      return;
    }
    try {
      const data = await api.get<Profile & { isAdmin: boolean }>('/profile');
      setProfile(data);
      setIsAdmin(!!data.isAdmin);
      if (data.language) setLanguageState(data.language as Language);
    } catch {
      const cachedProfile = localStorage.getItem('sikka_local_profile');
      if (hasSessionToken && cachedProfile) {
        try {
          const parsed = JSON.parse(cachedProfile) as Profile;
          setProfile(parsed);
          setIsAdmin(false);
        } catch {
          setProfile(null);
          setIsAdmin(false);
        }
      } else {
        setProfile(null);
        setIsAdmin(false);
      }
    } finally {
      setProfileLoaded(true);
    }
  }, [clerkUser]);

  useEffect(() => {
    if (userLoaded) {
      setProfileLoaded(false);
      fetchProfile();
    }
  }, [userLoaded, fetchProfile]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('sikka-lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    if (clerkUser || localStorage.getItem('sikka_admin_token') || localStorage.getItem('sikka_session_token')) {
      api.put('/profile', { language: lang }).catch(() => {});
    }
  };

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const signOut = async () => {
    const token = localStorage.getItem('sikka_admin_token');
    if (token) {
      try {
        await api.post('/auth/admin-logout', {});
      } catch {}
      localStorage.removeItem('sikka_admin_token');
    }
    if (localStorage.getItem('sikka_session_token')) {
      localStorage.removeItem('sikka_session_token');
      localStorage.removeItem('sikka_local_profile');
    }
    if (clerkUser) {
      await clerkSignOut();
    }
    setProfile(null);
    setIsAdmin(false);
  };

  const hasAdminSession = !!adminToken;
  const hasLocalSession = !!sessionToken;
  const effectiveUser = clerkUser
    ? { id: clerkUser.id }
    : hasAdminSession
    ? { id: 'sikka-admin' }
    : hasLocalSession
    ? { id: profile?.userId || 'sikka-rider' }
    : null;

  const isLoading = !userLoaded || (!!effectiveUser && !profileLoaded);

  return (
    <AuthContext.Provider value={{
      user: effectiveUser,
      profile,
      isAdmin,
      isLoading,
      language,
      setLanguage,
      signOut,
      refreshProfile: fetchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
