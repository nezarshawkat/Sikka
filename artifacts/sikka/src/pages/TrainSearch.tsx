import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowLeftRight, Clock, MapPin, Train, ChevronDown, ChevronUp, Search, ExternalLink, Info } from 'lucide-react';
import { toast } from 'sonner';
import { hasAcceptedLocationDisclosure } from '@/lib/locationDisclosure';

// The Egyptian National Railways booking site — Arabic-only, and booking
// online requires an Egyptian national ID, so it's only offered as the
// next step for riders with an Egyptian account. It's never scraped or
// automated against (no login, no captcha bypass, no auto-checkout) — this
// is just a direct link to ENR's own site for the rider to book themselves.
const ENR_BOOKING_URL = 'https://obs.enr.gov.eg/o-city/obs/enr/railway/ar/booktickets';

interface GovernorateOption {
  governorate: string;
  nameEn: string;
  nameAr: string;
  hubCityId: string;
  hubCityNameEn: string;
  hubCityNameAr: string;
}

interface TrainStop {
  name: string;
  nameAr?: string;
  arrival?: string;
  departure?: string;
}

interface TrainRow {
  id: string;
  trainNumber: string;
  trainType: string;
  fromCity: string;
  toCity: string;
  stops: TrainStop[];
  operatingNote: string | null;
  operatingNoteAr: string | null;
}

function isSummaryTrain(t: TrainRow) {
  // Route-summary placeholders (no confirmed per-stop clock times yet) use a
  // synthesized "SUM-From-To" number instead of a real Egyptian National
  // Railways train number — flagged in the UI rather than presented as if
  // it were a precise timetable.
  return t.trainNumber.startsWith('SUM-');
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestGovernorate(
  cities: { governorate: string; lat: number | null; lng: number | null }[],
  lat: number,
  lng: number,
): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const c of cities) {
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = c.governorate;
    }
  }
  return best;
}

const TrainSearch = () => {
  const navigate = useNavigate();
  const { language, profile } = useAuth();
  const isAr = language === 'ar';
  const isForeigner = !!profile?.nationality && !/^egyptian$/i.test(profile.nationality);

  const [governorates, setGovernorates] = useState<GovernorateOption[]>([]);
  const [fromGov, setFromGov] = useState<GovernorateOption | null>(null);
  const [toGov, setToGov] = useState<GovernorateOption | null>(null);
  const [results, setResults] = useState<TrainRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [govFilter, setGovFilter] = useState('');
  const [autoSearch, setAutoSearch] = useState(false);

  useEffect(() => {
    api.get<GovernorateOption[]>('/trains/governorates').then((data) => {
      setGovernorates(data ?? []);
      const params = new URLSearchParams(window.location.search);
      const fromParam = params.get('from');
      const toParam = params.get('to');
      const byName = (name: string | null) =>
        name ? (data ?? []).find((g) => g.hubCityNameEn.toLowerCase() === name.toLowerCase()) : undefined;
      const fromMatch = byName(fromParam);
      const toMatch = byName(toParam);
      if (fromMatch) setFromGov(fromMatch);
      if (toMatch) setToGov(toMatch);
      if (fromMatch || toMatch) setAutoSearch(true);

      // No explicit ?from= handoff (e.g. opened directly from a menu rather
      // than through the destination-select flow that already resolves
      // this) — fall back to the rider's current governorate so they only
      // have to choose where they're going, same as trip planning already
      // does elsewhere. Only applied when that governorate is actually
      // reachable by train; otherwise the picker is left for manual choice.
      if (!fromMatch && navigator.geolocation && hasAcceptedLocationDisclosure()) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const cities = await api.get<{ governorate: string; lat: number | null; lng: number | null }[]>('/intercity/cities');
              const governorate = nearestGovernorate(cities ?? [], pos.coords.latitude, pos.coords.longitude);
              const match = governorate ? (data ?? []).find((g) => g.governorate === governorate) : undefined;
              if (match) setFromGov(match);
            } catch {
              // Keep the picker available for manual selection.
            }
          },
          () => {},
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
        );
      }
    }).catch(() => {});
  }, []);

  // Fires once after the URL-prefilled governorates land in state.
  useEffect(() => {
    if (autoSearch && (fromGov || toGov)) {
      setAutoSearch(false);
      void handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, fromGov, toGov]);

  const swap = () => {
    setFromGov(toGov);
    setToGov(fromGov);
  };

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (fromGov) params.set('from', fromGov.hubCityNameEn);
      if (toGov) params.set('to', toGov.hubCityNameEn);
      const data = await api.get<TrainRow[]>(`/trains/search?${params}`);
      setResults(data ?? []);
    } catch {
      toast.error(isAr ? 'فشل البحث، حاول مرة أخرى' : 'Search failed, try again');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [fromGov, toGov, isAr]);

  const filteredGovernorates = governorates.filter((g) =>
    g.nameEn.toLowerCase().includes(govFilter.toLowerCase()) || g.nameAr.includes(govFilter)
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-card/[0.92] backdrop-blur-2xl border-b z-10 p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Train className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-lg">{isAr ? 'بحث القطارات' : 'Train Search'}</h1>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* From / To governorate pickers — same pattern as the intercity bus search,
            so all intercity travel choices work the same way. */}
        <div className="glass-panel rounded-[2rem] p-4 space-y-2 relative">
          <button
            onClick={() => { setGovFilter(''); setShowFromPicker(true); }}
            className="w-full h-12 px-4 rounded-2xl border bg-background/70 text-start flex items-center gap-3 hover:border-primary transition-colors"
          >
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <span className={fromGov ? 'text-foreground font-medium' : 'text-muted-foreground text-sm'}>
              {fromGov ? (isAr ? fromGov.nameAr : fromGov.nameEn) : (isAr ? 'من (محافظة)' : 'From (governorate)')}
            </span>
          </button>

          <div className="flex items-center justify-center">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={swap}>
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>

          <button
            onClick={() => { setGovFilter(''); setShowToPicker(true); }}
            className="w-full h-12 px-4 rounded-2xl border bg-background/70 text-start flex items-center gap-3 hover:border-primary transition-colors"
          >
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <span className={toGov ? 'text-foreground font-medium' : 'text-muted-foreground text-sm'}>
              {toGov ? (isAr ? toGov.nameAr : toGov.nameEn) : (isAr ? 'إلى (محافظة)' : 'To (governorate)')}
            </span>
          </button>

          <Button className="w-full rounded-2xl gap-2 mt-1" onClick={() => void handleSearch()} disabled={loading}>
            <Search className="h-4 w-4" />
            {loading ? (isAr ? 'بحث...' : 'Searching...') : (isAr ? 'بحث' : 'Search')}
          </Button>
        </div>

        {/* Nationality-aware next step. ENR's booking site is Arabic-only and
            needs an Egyptian national ID to check out, so it's only offered as
            a real next step for Egyptian accounts — a foreign account gets the
            schedule (so they know when to show up) plus in-person instructions
            instead of a booking link they wouldn't be able to use. */}
        <div className={`rounded-2xl p-3 flex items-start gap-2.5 text-xs ${isForeigner ? 'bg-muted/60' : 'bg-primary/10'}`}>
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          {isForeigner ? (
            <p className="text-muted-foreground">
              {isAr
                ? 'حجز السكة الحديد أونلاين متاح فقط لحاملي الرقم القومي المصري. يمكنك رؤية المواعيد هنا، ثم التوجه إلى المحطة قبل الموعد لشراء التذكرة مباشرة.'
                : "Online booking needs an Egyptian national ID, so it isn't available on your account. You can still see train times here, then go to the station before departure to buy your ticket in person."}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {isAr
                ? 'ابحث عن موعد مناسب هنا، ثم احجز تذكرتك مباشرة من موقع السكة الحديد المصرية.'
                : "Find a time that works here, then book your seat directly on Egyptian National Railways' own site."}
              <a
                href={ENR_BOOKING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary font-medium ms-1 hover:underline"
              >
                {isAr ? 'فتح موقع الحجز' : 'Open booking website'}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
        </div>

        {/* Results */}
        <AnimatePresence mode="wait">
          {searched && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              {!loading && results?.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  {isAr ? 'لا توجد قطارات مطابقة' : 'No matching trains found'}
                </p>
              )}
              {results?.map((train) => {
                const expanded = expandedId === train.id;
                const summary = isSummaryTrain(train);
                const first = train.stops[0];
                const last = train.stops[train.stops.length - 1];
                return (
                  <Card key={train.id} className="overflow-hidden">
                    <CardContent
                      className="p-4 space-y-2 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : train.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Train className="h-4 w-4 text-primary" />
                          <span className="text-sm font-semibold">
                            {summary ? (isAr ? 'مجموعة قطارات' : 'Train service') : `${isAr ? 'قطار' : 'Train'} #${train.trainNumber}`}
                          </span>
                          <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">{train.trainType}</span>
                        </div>
                        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{first?.name}</span>
                        {first?.departure && <span className="text-muted-foreground">· {first.departure}</span>}
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{last?.name}</span>
                        {last?.arrival && <span className="text-muted-foreground">· {last.arrival}</span>}
                      </div>

                      {train.operatingNote && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {isAr && train.operatingNoteAr ? train.operatingNoteAr : train.operatingNote}
                        </p>
                      )}

                      {expanded && (
                        <div className="pt-2 border-t mt-2 space-y-1.5">
                          {train.stops.map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className={i === 0 || i === train.stops.length - 1 ? 'font-semibold' : 'text-muted-foreground'}>
                                {isAr && s.nameAr ? s.nameAr : s.name}
                              </span>
                              <span className="text-muted-foreground">
                                {s.arrival && s.departure ? `${s.arrival} → ${s.departure}` : s.departure || s.arrival || '—'}
                              </span>
                            </div>
                          ))}
                          {!isForeigner && (
                            <a
                              href={ENR_BOOKING_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {isAr ? 'حجز هذا القطار على موقع السكة الحديد' : 'Book this train on the ENR website'}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Governorate picker sheet, shared by the From and To buttons */}
      <AnimatePresence>
        {(showFromPicker || showToPicker) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 flex items-end"
            onClick={() => { setShowFromPicker(false); setShowToPicker(false); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30 }}
              className="bg-card w-full rounded-t-[2rem] max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b">
                <p className="font-semibold text-center mb-3">
                  {showFromPicker
                    ? (isAr ? 'اختر محافظة الانطلاق' : 'Select departure governorate')
                    : (isAr ? 'اختر محافظة الوصول' : 'Select destination governorate')}
                </p>
                <input
                  autoFocus
                  value={govFilter}
                  onChange={(e) => setGovFilter(e.target.value)}
                  placeholder={isAr ? 'ابحث عن محافظة...' : 'Search governorate...'}
                  className="w-full h-10 px-4 rounded-2xl border bg-background/70 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="overflow-y-auto flex-1 p-2">
                {filteredGovernorates.map((gov) => (
                  <button
                    key={gov.governorate}
                    className="w-full text-start px-4 py-3 rounded-2xl hover:bg-muted transition-colors flex items-center justify-between"
                    onClick={() => {
                      if (showFromPicker) setFromGov(gov);
                      else setToGov(gov);
                      setShowFromPicker(false);
                      setShowToPicker(false);
                    }}
                  >
                    <p className="font-medium text-foreground text-sm">{isAr ? gov.nameAr : gov.nameEn}</p>
                    {(showFromPicker ? fromGov?.governorate : toGov?.governorate) === gov.governorate && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TrainSearch;
