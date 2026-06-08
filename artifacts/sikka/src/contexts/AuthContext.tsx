import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useUser, useAuth as useClerkAuth } from '@clerk/react';
import { api } from '@/lib/api';
import type { Language } from '@/lib/i18n';

export interface Profile {
  displayName: string | null;
  phone: string | null;
  language: string;
  nationality: 'egyptian' | 'foreigner';
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
  const { signOut: clerkSignOut } = useClerkAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem('sikka-lang') as Language) || 'en';
  });

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('sikka_admin_token') : null;

  const fetchProfile = useCallback(async () => {
    const hasAdminToken = !!localStorage.getItem('sikka_admin_token');
    if (!clerkUser && !hasAdminToken) {
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
      setProfile(null);
      setIsAdmin(false);
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
    if (clerkUser || localStorage.getItem('sikka_admin_token')) {
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
    if (clerkUser) {
      await clerkSignOut();
    }
    setProfile(null);
    setIsAdmin(false);
  };

  const hasAdminSession = !!adminToken;
  const effectiveUser = clerkUser
    ? { id: clerkUser.id }
    : hasAdminSession
    ? { id: 'sikka-admin' }
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
