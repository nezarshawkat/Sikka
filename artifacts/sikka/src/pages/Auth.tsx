import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, type Profile } from '@/contexts/AuthContext';
import { t, type Language } from '@/lib/i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Globe2, MapPin, Shield, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Step = 'name' | 'nationality' | 'admin';

type CountryOption = {
  code: string;
  name: string;
};

type DisplayNamesFactory = {
  DisplayNames: new (locales: string[], options: { type: 'region' }) => { of(code: string): string | undefined };
};

const COUNTRY_CODES = [
  'AF', 'AX', 'AL', 'DZ', 'AS', 'AD', 'AO', 'AI', 'AQ', 'AG', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ',
  'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BO', 'BQ', 'BA', 'BW', 'BV', 'BR',
  'IO', 'BN', 'BG', 'BF', 'BI', 'KH', 'CM', 'CA', 'CV', 'KY', 'CF', 'TD', 'CL', 'CN', 'CX', 'CC',
  'CO', 'KM', 'CG', 'CD', 'CK', 'CR', 'CI', 'HR', 'CU', 'CW', 'CY', 'CZ', 'DK', 'DJ', 'DM', 'DO',
  'EC', 'SV', 'GQ', 'ER', 'EE', 'SZ', 'ET', 'FK', 'FO', 'FJ', 'FI', 'FR', 'GF', 'PF', 'TF', 'GA',
  'GM', 'GE', 'DE', 'GH', 'GI', 'GR', 'GL', 'GD', 'GP', 'GU', 'GT', 'GG', 'GN', 'GW', 'GY', 'HT',
  'HM', 'VA', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IM', 'IL', 'IT', 'JM', 'JP',
  'JE', 'JO', 'KZ', 'KE', 'KI', 'KP', 'KR', 'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI',
  'LT', 'LU', 'MO', 'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'MH', 'MQ', 'MR', 'MU', 'YT', 'MX', 'FM',
  'MD', 'MC', 'MN', 'ME', 'MS', 'MA', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NL', 'NC', 'NZ', 'NI', 'NE',
  'NG', 'NU', 'NF', 'MK', 'MP', 'NO', 'OM', 'PK', 'PW', 'PS', 'PA', 'PG', 'PY', 'PE', 'PH', 'PN',
  'PL', 'PT', 'PR', 'QA', 'RE', 'RO', 'RU', 'RW', 'BL', 'SH', 'KN', 'LC', 'MF', 'PM', 'VC', 'WS',
  'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SX', 'SK', 'SI', 'SB', 'SO', 'ZA', 'GS', 'SS',
  'ES', 'LK', 'SD', 'SR', 'SJ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TK', 'TO',
  'TT', 'TN', 'TR', 'TM', 'TC', 'TV', 'UG', 'UA', 'AE', 'GB', 'US', 'UM', 'UY', 'UZ', 'VU', 'VE',
  'VN', 'VG', 'VI', 'WF', 'EH', 'YE', 'ZM', 'ZW',
];

const slideVariants = {
  enter: { x: 50, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -50, opacity: 0 },
};

const LOCATION_DISCLOSURE_STORAGE_KEY = 'sikka_location_permission_disclosure';

function countryNameFor(code: string, language: Language): string {
  const intlWithDisplayNames = typeof Intl !== 'undefined' ? Intl as unknown as DisplayNamesFactory : null;
  const displayNames = intlWithDisplayNames && 'DisplayNames' in Intl
    ? new intlWithDisplayNames.DisplayNames([language], { type: 'region' })
    : null;
  return displayNames?.of(code) || code;
}

function countryOptionsFor(language: Language): CountryOption[] {
  return COUNTRY_CODES
    .map((code) => ({ code, name: countryNameFor(code, language) }))
    .filter((country) => country.code !== 'EG')
    .sort((a, b) => a.name.localeCompare(b.name, language));
}

const Auth = () => {
  const { language, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<Step>(() => (searchParams.get('step') === 'admin' ? 'admin' : 'name'));
  const [displayName, setDisplayName] = useState('');
  const [nationality, setNationality] = useState<'egyptian' | 'foreigner'>('egyptian');
  const [selectedCountryCode, setSelectedCountryCode] = useState('US');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showLocationDisclosure, setShowLocationDisclosure] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(LOCATION_DISCLOSURE_STORAGE_KEY);
    setShowLocationDisclosure(!stored);
  }, []);

  const countryOptions = useMemo(() => countryOptionsFor(language), [language]);
  const selectedCountry = countryOptions.find((country) => country.code === selectedCountryCode) ?? countryOptions[0];

  const handleCreateRider = async () => {
    const name = displayName.trim();
    if (!name) return;
    setIsLoading(true);
    try {
      const res = await api.post<{ token: string; profile: Profile }>('/auth/local-rider', {
        displayName: name,
        nationality: nationality === 'egyptian' ? 'Egyptian' : countryNameFor(selectedCountryCode, 'en'),
        countryCode: nationality === 'egyptian' ? 'EG' : selectedCountry?.code,
        language,
      });
      localStorage.removeItem('sikka_admin_token');
      localStorage.setItem('sikka_session_token', res.token);
      localStorage.setItem('sikka_local_profile', JSON.stringify(res.profile));
      await refreshProfile();
      navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    if (!adminUsername.trim() || !adminPassword.trim()) return;
    setIsLoading(true);
    try {
      const res = await api.post<{ adminToken: string }>('/auth/admin-login', {
        username: adminUsername,
        password: adminPassword,
      });
      localStorage.removeItem('sikka_session_token');
      localStorage.removeItem('sikka_local_profile');
      localStorage.setItem('sikka_admin_token', res.adminToken);
      await refreshProfile();
      toast.success(language === 'ar' ? 'Welcome, Admin!' : 'Welcome, Admin!');
      navigate('/admin');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  const persistLocationDisclosure = (decision: 'accepted' | 'dismissed') => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCATION_DISCLOSURE_STORAGE_KEY, decision);
    }
    setShowLocationDisclosure(false);
  };

  const handleLocationDisclosureContinue = () => {
    persistLocationDisclosure('accepted');
  };

  const handleLocationDisclosureDismiss = () => {
    persistLocationDisclosure('dismissed');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <AnimatePresence>
        {showLocationDisclosure && (
          <motion.div
            key="location-disclosure"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-4 py-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 16, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-primary/20 bg-card/95 p-6 shadow-2xl"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">{t('locationDisclosureTitle', language)}</h2>
                  <p className="text-sm leading-6 text-muted-foreground">{t('locationDisclosureBody', language)}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="flex-1 rounded-full" onClick={handleLocationDisclosureDismiss}>
                  {t('locationDisclosureDismiss', language)}
                </Button>
                <Button className="flex-1 rounded-full" onClick={handleLocationDisclosureContinue}>
                  {t('locationDisclosureContinue', language)}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="mb-8 text-center"
      >
        <img
          src={`${import.meta.env.BASE_URL}sikka-logo.svg`}
          alt="Sikka"
          className="h-20 w-auto mx-auto"
        />
        <p className="text-sm text-muted-foreground mt-3">{t('tagline', language)}</p>
      </motion.div>

      <AnimatePresence mode="wait">
        {step === 'name' && (
          <motion.div
            key="name"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <UserRound className="h-5 w-5 text-primary" />
                  {t('whatShouldWeCallYou', language)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && displayName.trim() && setStep('nationality')}
                  placeholder={t('namePlaceholder', language)}
                  className="text-base"
                  autoComplete="name"
                  autoFocus
                />
                <Button
                  onClick={() => setStep('nationality')}
                  disabled={!displayName.trim()}
                  className="w-full"
                >
                  {t('next', language)}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'nationality' && (
          <motion.div
            key="nationality"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep('name')}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Users className="h-5 w-5 text-primary" />
                    {t('selectNationality', language)}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant={nationality === 'egyptian' ? 'default' : 'outline'}
                  className="w-full justify-start text-base"
                  onClick={() => setNationality('egyptian')}
                >
                  {t('egyptian', language)}
                </Button>
                <Button
                  variant={nationality === 'foreigner' ? 'default' : 'outline'}
                  className="w-full justify-start text-base"
                  onClick={() => setNationality('foreigner')}
                >
                  {t('foreigner', language)}
                </Button>

                {nationality === 'foreigner' && (
                  <div className="space-y-2 pt-1">
                    <label className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-primary" />
                      {t('country', language)}
                    </label>
                    <select
                      value={selectedCountryCode}
                      onChange={(e) => setSelectedCountryCode(e.target.value)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {countryOptions.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <Button
                  onClick={handleCreateRider}
                  disabled={isLoading || !displayName.trim()}
                  className="w-full mt-4"
                >
                  {isLoading ? '...' : t('continue', language)}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'admin' && (
          <motion.div
            key="admin"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep('name')}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-5 w-5 text-primary" />
                    {t('adminLogin', language)}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  type="text"
                  placeholder={t('username', language)}
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  dir="ltr"
                  autoComplete="username"
                />
                <Input
                  type="password"
                  placeholder={t('password', language)}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                  dir="ltr"
                  autoComplete="current-password"
                />
                <Button
                  onClick={handleAdminLogin}
                  disabled={isLoading || !adminUsername.trim() || !adminPassword.trim()}
                  className="w-full"
                >
                  {isLoading ? '...' : t('login', language)}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {step !== 'admin' && (
        <button
          onClick={() => setStep('admin')}
          className="mt-6 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
        >
          <Shield className="h-3 w-3" />
          {t('admin', language)}
        </button>
      )}
    </div>
  );
};

export default Auth;
