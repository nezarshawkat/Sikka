import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ArrowLeft, Wallet, Clock, MapPin, ChevronRight } from 'lucide-react';

type TripType = 'economic' | 'comfortable' | 'premium';

const TripPlan = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { language } = useAuth();

  const destination = searchParams.get('destination') || '';
  const destLat = parseFloat(searchParams.get('destLat') || '0');
  const destLng = parseFloat(searchParams.get('destLng') || '0');
  const startLat = parseFloat(searchParams.get('lat') || '30.0444');
  const startLng = parseFloat(searchParams.get('lng') || '31.2357');
  const mode = searchParams.get('mode') || undefined;

  const [tripType, setTripType] = useState<TripType>('comfortable');
  const [budget, setBudget] = useState('');

  const distanceKm = useMemo(() => {
    const R = 6371;
    const dLat = (destLat - startLat) * Math.PI / 180;
    const dLng = (destLng - startLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(startLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, [startLat, startLng, destLat, destLng]);

  const budgetRange = useMemo(() => {
    const busFare = distanceKm > 25 ? 25 : 13;
    const metroFare = distanceKm > 23 ? 20 : distanceKm > 9 ? 15 : 8;
    const taxiFare = 15 + distanceKm * 4.5;
    const ranges: Record<TripType, { min: number; max: number }> = {
      economic: { min: Math.round(Math.min(busFare, metroFare)), max: Math.round(Math.max(25, busFare + 15)) },
      comfortable: { min: Math.round(Math.min(metroFare, 25)), max: Math.round(Math.max(45, metroFare + 30)) },
      premium: { min: Math.round(taxiFare), max: Math.round(taxiFare * 1.35) },
    };
    return ranges[tripType];
  }, [distanceKm, tripType]);

  useEffect(() => {
    setBudget(String(budgetRange.min));
  }, [tripType, budgetRange]);

  const tripTypes: { value: TripType; icon: string; color: string }[] = [
    { value: 'economic', icon: '💰', color: 'border-green-400' },
    { value: 'comfortable', icon: '🛋️', color: 'border-blue-400' },
    { value: 'premium', icon: '✨', color: 'border-yellow-400' },
  ];

  const handlePlanTrip = () => {
    const params = new URLSearchParams({
      destination,
      destLat: String(destLat),
      destLng: String(destLng),
      lat: String(startLat),
      lng: String(startLng),
      tripType,
      budget: budget || '',
    });
    if (mode) params.set('mode', mode);
    navigate(`/plan/setup?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-card/82 backdrop-blur-2xl border-b z-10 p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <p className="text-sm text-muted-foreground">{t('searchDestination', language)}</p>
          <p className="font-semibold text-foreground truncate max-w-[250px]">{destination}</p>
        </div>
      </div>

      <div className="p-4 space-y-6">
        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <Card className="rounded-[2rem] overflow-hidden">
            <CardContent className="p-4 flex items-center gap-3 min-h-[5.75rem]">
              <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <MapPin className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="text-xs text-muted-foreground">{t('searchDestination', language)}</p>
                <p className="font-medium text-foreground truncate block w-full max-w-full" title={destination}>
                  {destination}
                </p>
                <p className="text-xs text-muted-foreground">{t('distanceAway', language).replace('{distance}', distanceKm.toFixed(1))}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
          <p className="text-sm font-medium text-foreground mb-3">{t('tripType', language)}</p>
          <div className="grid grid-cols-3 gap-3">
            {tripTypes.map(({ value, icon, color }) => (
              <button
                key={value}
                onClick={() => setTripType(value)}
                className={`p-4 rounded-[2rem] border-2 text-center transition-all ${
                  tripType === value ? `${color} bg-primary/5` : 'border-border bg-card'
                }`}
              >
                <span className="text-2xl block mb-1">{icon}</span>
                <span className="text-xs font-medium text-foreground">{t(value, language)}</span>
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
          <p className="text-sm font-medium text-foreground mb-3">{t('budget', language)}</p>
          <div className="relative">
            <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              placeholder={String(budgetRange.min)}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="pl-10 h-12 text-base"
              dir="ltr"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {t('egp', language)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t('recommendedBudget', language)}: {budgetRange.min}–{budgetRange.max} {t('egp', language)}
          </p>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
          <Button onClick={handlePlanTrip} className="w-full h-14 text-base rounded-[2rem] gap-2">
            {t('planTrip', language)}
            <ChevronRight className="h-5 w-5" />
          </Button>
        </motion.div>
      </div>
    </div>
  );
};

export default TripPlan;
