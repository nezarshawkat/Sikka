import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const authFile = join(scriptsDir, '..', 'artifacts', 'sikka', 'src', 'pages', 'Auth.tsx');
let source = readFileSync(authFile, 'utf8');

function replaceRequired(label, from, to) {
  if (!source.includes(from)) {
    throw new Error(`Could not find ${label} in Auth.tsx`);
  }
  source = source.replace(from, to);
}

replaceRequired(
  'dev phone provider type',
  "const [phoneProvider, setPhoneProvider] = useState<'twilio' | 'clerk' | 'dev'>('clerk');",
  "const [phoneProvider, setPhoneProvider] = useState<'twilio' | 'clerk'>('clerk');",
);

replaceRequired(
  'dev OTP send fallback',
  `      const msg = err instanceof Error ? err.message : '';
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
      }`,
  `      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('not enabled') || msg.toLowerCase().includes('strategy')) {
        toast.error(
          language === 'ar'
            ? 'تسجيل الدخول بالهاتف غير مفعّل. راجع إعدادات المصادقة على الخادم.'
            : 'Phone login is not configured. Check the server auth settings.'
        );
      } else {
        toast.error(msg || (language === 'ar' ? 'فشل إرسال الرمز' : 'Failed to send code'));
      }`,
);

replaceRequired(
  'dev OTP verification fallback',
  `      if (otp === '123456') {
        toast.info(language === 'ar' ? 'وضع تجريبي — جاري المتابعة' : 'Dev mode — continuing');
        setStep('name');
      } else {
        setOtpError(true);
        toast.error(language === 'ar' ? 'رمز غير صحيح' : 'Invalid code');
      }`,
  `      setOtpError(true);
      toast.error(language === 'ar' ? 'رمز غير صحيح' : 'Invalid code');`,
);

replaceRequired(
  'silent name save failure',
  `    } catch {
      // If the local dev OTP fallback is being used before a real session exists,
      // keep the name in local storage so the app can still greet the rider later.
      localStorage.setItem('sikka-display-name', displayName.trim());
    } finally {
      setIsLoading(false);
      setStep('location');
    }`,
  `    } catch (err) {
      toast.error(err instanceof Error ? err.message : (language === 'ar' ? 'تعذر حفظ الملف الشخصي' : 'Could not save profile'));
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    setStep('location');`,
);

replaceRequired(
  'silent nationality save failure',
  `    } catch {
      navigate('/');
    } finally {
      setIsLoading(false);
    }`,
  `    } catch (err) {
      toast.error(err instanceof Error ? err.message : (language === 'ar' ? 'تعذر حفظ الملف الشخصي' : 'Could not save profile'));
    } finally {
      setIsLoading(false);
    }`,
);

writeFileSync(authFile, source);
console.log('Removed mobile dev auth fallback and silent profile-save failures.');
