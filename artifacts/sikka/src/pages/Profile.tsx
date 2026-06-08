import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, LogOut, Shield, User, Milestone, Map } from 'lucide-react';
import { motion } from 'framer-motion';
import LanguageSelect from '@/components/LanguageSelect';
import ThemeToggle from '@/components/ThemeToggle';
import { MAP_MODES, type MapMode, useMapStyle } from '@/hooks/useMapStyle';

const Profile = () => {
  const { user, profile, isAdmin, language, setLanguage, signOut } = useAuth();
  const navigate = useNavigate();
  const { mode: mapMode, setMode: setMapMode } = useMapStyle();

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-card/82 backdrop-blur-2xl border-b z-10 p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-semibold text-lg">{t('profile', language)}</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <Card className="rounded-[2rem] glass-panel">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{profile?.displayName ?? profile?.phone ?? user?.id?.replace(/^(?:phone|admin):/, '') ?? t('user', language)}</p>
                <p className="text-sm text-muted-foreground">{t(profile?.nationality || 'egyptian', language)}</p>
              </div>
              {isAdmin && (
                <div className="ml-auto">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full flex items-center gap-1">
                    <Shield className="h-3 w-3" /> {t('admin', language)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
          <Card className="rounded-[2rem] glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                {t('language', language)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.12 }}>
          <Card className="rounded-[2rem] glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Map className="h-4 w-4" /> {t('mapSettings', language)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{t('mapSettingsDesc', language)}</p>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(MAP_MODES) as MapMode[]).map((key) => {
                  const item = MAP_MODES[key];
                  return (
                    <button
                      key={key}
                      onClick={() => setMapMode(key)}
                      className={`rounded-[1.5rem] border p-2 text-left transition-all glass-panel ${mapMode === key ? 'border-primary bg-primary/15' : 'border-white/20'}`}
                    >
                      <div className="h-16 rounded-[1.15rem] border border-white/30 shadow-inner mb-2" style={{ background: item.preview }} />
                      <p className="text-sm font-semibold text-foreground">{language === 'ar' ? item.labelAr : item.labelEn}</p>
                      <p className="text-[10px] text-muted-foreground leading-snug">{language === 'ar' ? item.descriptionAr : item.descriptionEn}</p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}>
          <Button variant="outline" className="w-full h-14 rounded-[2rem] text-base justify-start px-5 glass-panel profile-glass-action" onClick={() => navigate('/discover-trip')}>
            <Milestone className="h-4 w-4 mr-2" />
            {t('contributeRoute', language)}
          </Button>
        </motion.div>

        {isAdmin && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
            <Button variant="outline" className="w-full h-14 rounded-[2rem] text-base justify-start px-5 glass-panel profile-glass-action" onClick={() => navigate('/admin')}>
              <Shield className="h-4 w-4 mr-2" />
              {t('dashboard', language)}
            </Button>
          </motion.div>
        )}

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
          <Button variant="destructive" className="w-full h-14 rounded-[2rem] text-base justify-start px-5 profile-glass-action" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            {t('logout', language)}
          </Button>
        </motion.div>
      </div>
    </div>
  );
};

export default Profile;
