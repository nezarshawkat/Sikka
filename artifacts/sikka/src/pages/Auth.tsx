import { useState, useEffect, useRef, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser, useSignIn } from '@clerk/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { t, Language } from '@/lib/i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Shield, ArrowLeft, Users, Globe, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import CountryCodeSelect, { countries, Country } from '@/components/auth/CountryCodeSelect';
import { api } from '@/lib/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { languageNames } from '@/lib/i18n';

type Step = 'language' | 'phone' | 'otp' | 'name' | 'nationality' | 'admin';

const countriesByDialLength = [...countries].sort((a, b) => b.dial.length - a.dial.length);
const stripNationalPrefix = (value: string) => value.replace(/^0/, '');
const buildFullPhone = (country: Country, localNumber: string) =>
  `${country.dial}${stripNationalPrefix(localNumber)}`;

const detectCountryFromPhone = (value: string) => {
  const normalized = value.startsWith('00') ? `+${value.slice(2)}` : value;
  return countriesByDialLength.find((country) => normalized.startsWith(country.dial));
};

const slideVariants = {
  enter: { x: 50, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -50, opacity: 0 },
};

const languageEntries = Object.entries(languageNames) as [Language, string][];

const Auth = () => {
  const { user: clerkUser } = useUser();
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
  const { language, setLanguage, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const onboard = searchParams.get('onboard') === '1';
  const adminParam = searchParams.get('step') === 'admin';

  const [step, setStep] = useState<Step>(() => {
    if (adminParam) return 'admin';
    if (onboard) return 'nationality';
    return 'language';
  });

  const [selectedLang, setSelectedLang] = useState<Language | ''>('');
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [otpError, setOtpError] = useState(false);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [phoneProvider, setPhoneProvider] = useState<'twilio' | 'clerk' | 'dev'>('clerk');
  const [displayName, setDisplayName] = useState('');
  const [nationality, setNationality] = useState<'egyptian' | 'foreigner'>('egyptian');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (clerkUser && step === 'language') navigate('/');
  }, [clerkUser, step, navigate]);

  useEffect(() => {
    if (onboard) setStep('nationality');
    else if (adminParam) setStep('admin');
  }, [onboard, adminParam]);

  const fullPhone = buildFullPhone(selectedCountry, phoneNumber);
  const otp = otpDigits.join('');

  const resetOtp = () => {
    setOtpDigits(Array(6).fill(''));
    setOtpError(false);
  };

  const focusOtpBox = (index: number) => {
    const el = otpRefs.current[index];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const handleOtpChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    setOtpError(false);
    setOtpDigits((prev) => {
      const next = [...prev];
      if (!cleaned) {
        next[index] = '';
        return next;
      }
      if (cleaned.length > 1) {
        const chars = cleaned.slice(0, 6 - index).split('');
        chars.forEach((ch, k) => {
          next[index + k] = ch;
        });
        const focusTo = Math.min(index + chars.length, 5);
        requestAnimationFrame(() => focusOtpBox(focusTo));
        return next;
      }
      next[index] = cleaned;
      if (index < 5) requestAnimationFrame(() => focusOtpBox(index + 1));
      return next;
    });
  };

  const handleOtpPaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    setOtpError(false);
    setOtpDigits((prev) => {
      const next = [...prev];
      const chars = pasted.slice(0, 6 - index).split('');
      chars.forEach((ch, k) => {
        next[index + k] = ch;
      });
      const focusTo = Math.min(index + chars.length, 5);
      requestAnimationFrame(() => focusOtpBox(focusTo));
      return next;
    });
  };

  const handleOtpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      setOtpError(false);
      if (otpDigits[index]) {
        setOtpDigits((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
      } else if (index > 0) {
        e.preventDefault();
        focusOtpBox(index - 1);
        setOtpDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusOtpBox(index - 1);
    } else if (e.key === 'ArrowRight' && index < 5) {
      focusOtpBox(index + 1);
    } else if (e.key === 'Enter' && otp.length === 6) {
      handleVerifyOtp();
    }
  };

  const handlePhoneInput = (value: string) => {
    const normalized = value.replace(/[^\d+]/g, '');
    const internationalValue = normalized.startsWith('00') ? `+${normalized.slice(2)}` : normalized;
    if (internationalValue.startsWith('+')) {
      const detectedCountry = detectCountryFromPhone(internationalValue);
      if (detectedCountry) {
        setSelectedCountry(detectedCountry);
        setPhoneNumber(
          internationalValue.slice(detectedCountry.dial.length).replace(/\D/g, '').replace(/^0/, '')
        );
        return;
      }
    }
    setPhoneNumber(normalized.replace(/\D/g, ''));
  };

  const handleLanguageChange = (lang: Language) => {
    setSelectedLang(lang);
    setLanguage(lang);
    setStep('phone');
  };

  const handleSendOtp = async () => {
    const local = stripNationalPrefix(phoneNumber).trim();
    if (!local || local.length < 6) {
      toast.error(language === 'ar' ? 'أدخل رقم هاتف صحيح' : 'Enter a valid phone number');
      return;
    }
    setIsLoading(true);
    resetOtp();
    try {
      try {
        await api.post('/auth/phone/start', { phoneNumber: fullPhone });
        setPhoneProvider('twilio');
        toast.success(language === 'ar' ? 'تم إرسال رمز التحقق!' : 'Verification code sent!');
        setStep('otp');
        return;
      } catch {
        setPhoneProvider('clerk');
      }
      if (!signInLoaded || !signIn) throw new Error('Auth not ready');
      await signIn.create({ strategy: 'phone_code', phoneNumber: fullPhone });
      toast.success(language === 'ar' ? 'تم إرسال رمز التحقق!' : 'Verification code sent!');
      setStep('otp');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('not enabled') || msg.toLowerCase().includes('strategy')) {
        setPhoneProvider('dev');
        toast.info(
          language === 'ar'
            ? 'رمز التحقق: 123456 (وضع تجريبي)'
            : 'OTP not yet wired — use 123456 to continue'
        );
        setStep('otp');
      } else {
        toast.error(msg || (language === 'ar' ? 'فشل إرسال الرمز' : 'Failed to send code'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setIsLoading(true);
    setOtpError(false);
    try {
      if (phoneProvider === 'twilio') {
        const result = await api.post<{ token: string }>('/auth/phone/verify', { phoneNumber: fullPhone, code: otp });
        localStorage.setItem('sikka_admin_token', result.token);
        await refreshProfile();
        setStep('name');
        return;
      }
      if (!signIn) throw new Error('stub');
      const result = await signIn.attemptFirstFactor({ strategy: 'phone_code', code: otp });
      if (result.status === 'complete' && setActive) {
        await setActive({ session: result.createdSessionId });
        setStep('name');
      }
    } catch (err) {
      if (phoneProvider === 'twilio') {
        setOtpError(true);
        toast.error(err instanceof Error ? err.message : (language === 'ar' ? 'رمز غير صحيح' : 'Invalid code'));
        return;
      }
      if (otp === '123456') {
        toast.info(language === 'ar' ? 'وضع تجريبي — جاري المتابعة' : 'Dev mode — continuing');
        setStep('name');
      } else {
        setOtpError(true);
        toast.error(language === 'ar' ? 'رمز غير صحيح' : 'Invalid code');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetName = async () => {
    if (!displayName.trim()) return;
    setIsLoading(true);
    try {
      await api.put('/profile', { displayName: displayName.trim(), language });
      await refreshProfile();
    } catch {
      // If the local dev OTP fallback is being used before a real session exists,
      // keep the name in local storage so the app can still greet the rider later.
      localStorage.setItem('sikka-display-name', displayName.trim());
    } finally {
      setIsLoading(false);
      setStep('nationality');
    }
  };

  const handleSetNationality = async () => {
    setIsLoading(true);
    try {
      await api.put('/profile', { nationality, language, displayName: displayName.trim() || undefined });
      await refreshProfile();
      navigate('/');
    } catch {
      navigate('/');
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
      localStorage.setItem('sikka_admin_token', res.adminToken);
      await refreshProfile();
      toast.success(language === 'ar' ? 'مرحباً بك، مسؤول!' : 'Welcome, Admin!');
      navigate('/admin');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (language === 'ar' ? 'بيانات غير صحيحة' : 'Invalid credentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
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
        {step === 'language' && (
          <motion.div
            key="language"
            variants={slideVariants}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('selectLanguage', language)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={selectedLang}
                  onValueChange={(v) => handleLanguageChange(v as Language)}
                >
                  <SelectTrigger className="w-full">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      <SelectValue placeholder="Select language" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {languageEntries.map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'phone' && (
          <motion.div
            key="phone"
            variants={slideVariants}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep('language')}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Phone className="h-5 w-5 text-primary" />
                    {t('phone', language)}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t('country', language)}</label>
                  <select
                    value={selectedCountry.code}
                    onChange={(e) => {
                      const c = countries.find((c) => c.code === e.target.value);
                      if (c) setSelectedCountry(c);
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2" dir="ltr">
                  <CountryCodeSelect selected={selectedCountry} onSelect={setSelectedCountry} />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder={t('enterPhone', language)}
                    value={phoneNumber}
                    onChange={(e) => handlePhoneInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                    dir="ltr"
                    className="text-base flex-1"
                  />
                </div>
                <Button
                  onClick={handleSendOtp}
                  disabled={isLoading || stripNationalPrefix(phoneNumber).length < 6}
                  className="w-full"
                >
                  {isLoading ? '...' : t('sendOtp', language)}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'otp' && (
          <motion.div
            key="otp"
            variants={slideVariants}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep('phone')}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="text-lg">{t('enterOtp', language)}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  {language === 'ar'
                    ? `تم إرسال الرمز إلى ${fullPhone}`
                    : `Code sent to ${fullPhone}`}
                </p>
                <div className="flex justify-center gap-2" dir="ltr">
                  {otpDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={1}
                      value={digit}
                      autoFocus={i === 0}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      onPaste={(e) => handleOtpPaste(i, e)}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Digit ${i + 1}`}
                      aria-invalid={otpError}
                      className={`h-14 w-12 rounded-lg border-2 text-center text-2xl font-semibold outline-none transition-colors focus:ring-2 focus:ring-primary/40 ${
                        otpError
                          ? 'border-destructive bg-destructive/10 text-destructive'
                          : digit
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-input bg-background text-foreground'
                      }`}
                    />
                  ))}
                </div>
                <Button
                  onClick={handleVerifyOtp}
                  disabled={isLoading || otp.length !== 6}
                  className="w-full"
                >
                  {isLoading ? '...' : t('verifyOtp', language)}
                </Button>
                <button
                  onClick={() => { resetOtp(); setStep('phone'); }}
                  className="w-full text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  {language === 'ar' ? 'تغيير رقم الهاتف' : 'Change phone number'}
                </button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'name' && (
          <motion.div
            key="name"
            variants={slideVariants}
            initial="enter" animate="center" exit="exit"
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
                  onKeyDown={(e) => e.key === 'Enter' && displayName.trim() && handleSetName()}
                  placeholder={t('namePlaceholder', language)}
                  className="text-base"
                />
                <Button
                  onClick={handleSetName}
                  disabled={isLoading || !displayName.trim()}
                  className="w-full"
                >
                  {isLoading ? '...' : t('continue', language)}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === 'nationality' && (
          <motion.div
            key="nationality"
            variants={slideVariants}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 text-primary" />
                  {t('selectNationality', language)}
                </CardTitle>
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
                <Button
                  onClick={handleSetNationality}
                  disabled={isLoading}
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
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep('language')}>
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
