import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Compass, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { api } from '@/lib/api';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ';

const langForGeocoding = (language: string) => language === 'zh' ? 'zh-CN' : language;

async function reverseGeocode(lat: number, lng: number, language: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&country=eg&language=${encodeURIComponent(langForGeocoding(language))}&limit=1&types=address,neighborhood,locality,place,poi`,
    );
    const data = await res.json();
    return data.features?.[0]?.place_name || '';
  } catch {
    return '';
  }
}

const loadingSteps = [
  'setupStepGraph',
  'setupStepRoutes',
  'setupStepPrice',
  'setupStepGuide',
] as const;

export default function PlanSetup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { language } = useAuth();
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isNoRoute, setIsNoRoute] = useState(false);

  const request = useMemo(() => {
    const destination = params.get('destination') || '';
    return {
      destination,
      destLat: parseFloat(params.get('destLat') || '0'),
      destLng: parseFloat(params.get('destLng') || '0'),
      startLat: parseFloat(params.get('lat') || '30.0444'),
      startLng: parseFloat(params.get('lng') || '31.2357'),
      tripType: params.get('tripType') || 'economic',
      budget: params.get('budget') ? parseFloat(params.get('budget') || '') : null,
      mode: params.get('mode') || undefined,
    };
  }, [params]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const plan = async () => {
      try {
        const data = await api.post<{ segments?: Array<Record<string, unknown>>; [k: string]: unknown }>('/trips/plan', {
          startLat: request.startLat,
          startLng: request.startLng,
          endLat: request.destLat,
          endLng: request.destLng,
          tripType: request.tripType,
          budget: request.budget,
          language,
          mode: request.mode,
        });
        if (cancelled) return;
        if (!data?.segments?.length) throw new Error(t('noRouteTitle', language));

        const originName = await reverseGeocode(request.startLat, request.startLng, language);
        if (Array.isArray(data.segments) && data.segments.length > 0) {
          const segs = [...data.segments];
          if (originName) segs[0] = { ...segs[0], start_name: originName };
          if (request.destination) {
            const last = segs.length - 1;
            segs[last] = { ...segs[last], end_name: request.destination };
          }
          data.segments = segs;
        }

        sessionStorage.setItem('tripPlan', JSON.stringify({
          ...data,
          destination: request.destination,
          tripType: request.tripType,
          startLat: request.startLat,
          startLng: request.startLng,
          destLat: request.destLat,
          destLng: request.destLng,
        }));
        navigate('/trip-result', { replace: true });
      } catch (err) {
        if (cancelled) return;
        setIsNoRoute(true);
        setError(err instanceof Error ? err.message : t('noRouteBody', language));
      }
    };
    void plan();
    return () => { cancelled = true; };
  }, [language, navigate, request]);

  const activeStep = Math.floor(elapsed / 2) % loadingSteps.length;
  const tooLong = elapsed >= 20;

  if (isNoRoute) {
    const discoverParams = new URLSearchParams({
      destination: request.destination,
      destLat: String(request.destLat),
      destLng: String(request.destLng),
      lat: String(request.startLat),
      lng: String(request.startLng),
    });
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <Card className="max-w-md w-full glass-panel rounded-[2rem]">
          <CardContent className="p-6 space-y-5 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Compass className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">{t('noRouteTitle', language)}</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">{t('noRouteBody', language)}</p>
              {error && <p className="text-xs text-muted-foreground/80">{error}</p>}
            </div>
            <div className="rounded-2xl bg-primary/8 border border-primary/15 p-4 text-left space-y-2">
              <p className="text-sm font-semibold text-foreground">{t('helpJourneyTitle', language)}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{t('helpJourneyBody', language)}</p>
            </div>
            <Button className="w-full h-12 rounded-2xl" onClick={() => navigate(`/discover-trip?${discoverParams.toString()}`)}>
              {t('registerJourney', language)}
            </Button>
            <Button variant="outline" className="w-full h-11 rounded-2xl" onClick={() => navigate('/')}>
              {t('back', language)}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 flex items-center justify-center">
      <Button variant="ghost" size="icon" className="absolute top-4 left-4" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full">
        <Card className="glass-panel rounded-[2rem] overflow-hidden">
          <CardContent className="p-8 space-y-8 text-center">
            <div className="relative mx-auto h-24 w-24">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }} className="absolute inset-0 rounded-full border-4 border-primary/15 border-t-primary" />
              <div className="absolute inset-3 rounded-full bg-primary/10 flex items-center justify-center">
                <Route className="h-9 w-9 text-primary" />
              </div>
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">{t('settingUpPlanTitle', language)}</h1>
            </div>
            <div className="min-h-[3.5rem] flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.p
                  key={activeStep}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.4 }}
                  className="text-lg font-semibold text-foreground"
                >
                  {t(loadingSteps[activeStep], language)}
                </motion.p>
              </AnimatePresence>
            </div>
            {tooLong && (
              <p className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-muted-foreground leading-relaxed">
                {t('setupTakingLong', language)}
              </p>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
