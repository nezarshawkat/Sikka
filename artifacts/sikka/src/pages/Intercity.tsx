import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowLeftRight, Clock, Wallet, MapPin,
  ExternalLink, Bus, Loader2, Search, CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useIsDark, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from '@/hooks/useIsDark';

interface City {
  id: string;
  nameEn: string;
  nameAr: string;
  governorate: string;
  lat: number | null;
  lng: number | null;
}

interface Trip {
  operator: string;
  operatorSlug: string;
  departure: string;
  arrival: string;
  durationMinutes: number;
  priceEgp: number;
  fromStation: string;
  toStation: string;
  bookingUrl: string | null;
  bookingMethod: string;
  busType: string | null;
  availableSeats: number | null;
}

const OPERATOR_COLORS: Record<string, string> = {
  superjet: '#E53E3E',
  gobus: '#3182CE',
  bluebus: '#2B6CB0',
};
const OPERATOR_LABELS: Record<string, string> = {
  superjet: 'SuperJet',
  gobus: 'GoBus',
  bluebus: 'BlueBus',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const Intercity = () => {
  const navigate = useNavigate();
  const { language } = useAuth();
  const isDark = useIsDark();
  const isAr = language === 'ar';

  const [cities, setCities] = useState<City[]>([]);
  const [fromCity, setFromCity] = useState<City | null>(null);
  const [toCity, setToCity] = useState<City | null>(null);
  const [date, setDate] = useState(todayStr());
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [cityFilter, setCityFilter] = useState('');
  // When arriving from the home map's intercity flow (?from=&to=), preselect
  // both cities and auto-run the search once.
  const [autoSearch, setAutoSearch] = useState(false);

  useEffect(() => {
    fetch('/api/intercity/cities')
      .then((r) => r.json())
      .then((data: City[]) => {
        setCities(data);
        const params = new URLSearchParams(window.location.search);
        const fromParam = params.get('from');
        const toParam = params.get('to');
        const byName = (name: string | null) =>
          name
            ? data.find(
                (c) =>
                  c.nameEn.toLowerCase() === name.toLowerCase() ||
                  c.id.toLowerCase() === name.toLowerCase(),
              )
            : undefined;
        const fromMatch = byName(fromParam);
        const toMatch = byName(toParam);
        setFromCity(fromMatch ?? data.find((c) => c.id === 'cairo') ?? null);
        if (toMatch) setToCity(toMatch);
        if (fromMatch && toMatch && fromMatch.id !== toMatch.id) setAutoSearch(true);
      })
      .catch(() => toast.error('Could not load cities'));
  }, []);

  const swapCities = () => {
    setFromCity(toCity);
    setToCity(fromCity);
  };

  const handleSearch = useCallback(async () => {
    if (!fromCity || !toCity) { toast.error(isAr ? 'اختر المدينتين' : 'Select both cities'); return; }
    if (fromCity.id === toCity.id) { toast.error(isAr ? 'اختر مدينتين مختلفتين' : 'Cities must differ'); return; }
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({
        from: fromCity.nameEn,
        to: toCity.nameEn,
        date,
      });
      const res = await fetch(`/api/intercity/search?${params}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setTrips(data.trips ?? []);
    } catch {
      toast.error(isAr ? 'فشل البحث، حاول مرة أخرى' : 'Search failed, try again');
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [fromCity, toCity, date, isAr]);

  // Fire the auto-search once both cities are set from URL params.
  useEffect(() => {
    if (autoSearch && fromCity && toCity && fromCity.id !== toCity.id) {
      setAutoSearch(false);
      void handleSearch();
    }
  }, [autoSearch, fromCity, toCity, handleSearch]);

  const routeGeoJSON = fromCity?.lat && fromCity?.lng && toCity?.lat && toCity?.lng
    ? {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [fromCity.lng, fromCity.lat],
            [toCity.lng, toCity.lat],
          ],
        },
        properties: {},
      }
    : null;

  const mapCenter = fromCity?.lat && fromCity?.lng
    ? {
        latitude: (fromCity.lat + (toCity?.lat ?? fromCity.lat)) / 2,
        longitude: (fromCity.lng + (toCity?.lng ?? fromCity.lng)) / 2,
      }
    : { latitude: 26.8206, longitude: 30.8025 };

  const filteredCities = cities.filter((c) =>
    c.nameEn.toLowerCase().includes(cityFilter.toLowerCase()) ||
    c.nameAr.includes(cityFilter)
  );

  const groupedByOperator = trips
    ? trips.reduce<Record<string, Trip[]>>((acc, t) => {
        const key = t.operatorSlug;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {})
    : {};
  const routeContext = fromCity && toCity
    ? isAr
      ? `${fromCity.nameAr} (${fromCity.governorate}) إلى ${toCity.nameAr} (${toCity.governorate})`
      : `${fromCity.nameEn} (${fromCity.governorate}) to ${toCity.nameEn} (${toCity.governorate})`
    : '';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-card/82 backdrop-blur-2xl border-b z-20 p-4 flex items-center gap-3 safe-area-top">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-semibold text-lg leading-tight">
            {isAr ? 'السفر بين المحافظات' : 'Intercity Travel'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isAr ? 'سوبر جت · جو باص · بلو باص' : 'SuperJet · GoBus · BlueBus'}
          </p>
        </div>
      </div>

      {/* Search Card */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="p-4 pb-0"
      >
        <Card className="glass-panel rounded-[2rem] border-primary/15">
          <CardContent className="p-4 space-y-3">
            {routeContext && (
              <div className="rounded-[1.5rem] border border-primary/15 bg-primary/8 p-3">
                <p className="text-xs font-semibold text-foreground">
                  {isAr ? 'نطاق البحث الحالي' : 'Current search corridor'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{routeContext}</p>
              </div>
            )}
            {/* From */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{isAr ? 'من' : 'From'}</p>
              <button
                onClick={() => { setCityFilter(''); setShowFromPicker(true); }}
                className="w-full h-12 px-4 rounded-[1.5rem] border bg-background/70 text-start flex items-center gap-3 hover:border-primary transition-colors"
              >
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <span className={fromCity ? 'text-foreground font-medium' : 'text-muted-foreground text-sm'}>
                  {fromCity ? (isAr ? fromCity.nameAr : fromCity.nameEn) : (isAr ? 'اختر المدينة' : 'Select city')}
                </span>
              </button>
            </div>

            {/* Swap */}
            <div className="flex justify-center">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" onClick={swapCities}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* To */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{isAr ? 'إلى' : 'To'}</p>
              <button
                onClick={() => { setCityFilter(''); setShowToPicker(true); }}
                className="w-full h-12 px-4 rounded-[1.5rem] border bg-background/70 text-start flex items-center gap-3 hover:border-primary transition-colors"
              >
                <MapPin className="h-4 w-4 text-destructive shrink-0" />
                <span className={toCity ? 'text-foreground font-medium' : 'text-muted-foreground text-sm'}>
                  {toCity ? (isAr ? toCity.nameAr : toCity.nameEn) : (isAr ? 'اختر المدينة' : 'Select city')}
                </span>
              </button>
            </div>

            {/* Date */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{isAr ? 'التاريخ' : 'Date'}</p>
              <div className="relative">
                <CalendarDays className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="date"
                  value={date}
                  min={todayStr()}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-12 pl-11 pr-4 rounded-[1.5rem] border bg-background/70 text-foreground text-sm focus:outline-none focus:border-primary transition-colors"
                />
              </div>
            </div>

            <Button onClick={handleSearch} disabled={loading || !fromCity || !toCity} className="w-full h-12 rounded-[1.5rem] gap-2 text-base">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              {isAr ? 'ابحث عن رحلات' : 'Search Trips'}
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Map showing route */}
      {fromCity?.lat && toCity?.lat && (
        <div className="mx-4 mt-4 h-44 rounded-[2rem] overflow-hidden border shadow-xl">
          <Map
            initialViewState={{
              ...mapCenter,
              zoom: 5,
            }}
            mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
            style={{ width: '100%', height: '100%' }}
            attributionControl={false}
            interactive={false}
          >
            {routeGeoJSON && (
              <Source type="geojson" data={routeGeoJSON}>
                <Layer
                  id="intercity-route"
                  type="line"
                  paint={{
                    'line-color': '#3B82F6',
                    'line-width': 3,
                    'line-dasharray': [4, 3],
                  }}
                />
              </Source>
            )}
            <Marker latitude={fromCity.lat!} longitude={fromCity.lng!}>
              <div className="h-3 w-3 rounded-full bg-primary border-2 border-white shadow" />
            </Marker>
            {toCity?.lat && (
              <Marker latitude={toCity.lat!} longitude={toCity.lng!}>
                <div className="h-3 w-3 rounded-full bg-destructive border-2 border-white shadow" />
              </Marker>
            )}
          </Map>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 p-4 space-y-4 pb-8">
        <AnimatePresence>
          {loading && (
            <motion.div
              key="loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 gap-3"
            >
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {isAr ? 'جاري البحث عن رحلات...' : 'Searching for trips...'}
              </p>
            </motion.div>
          )}

          {!loading && searched && trips && trips.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-16 gap-3 text-center"
            >
              <Bus className="h-12 w-12 text-muted-foreground/40" />
              <p className="font-medium text-foreground">{isAr ? 'لا توجد رحلات' : 'No trips found'}</p>
              <p className="text-sm text-muted-foreground max-w-[260px]">
                {isAr
                  ? 'لم يتم العثور على رحلات في هذا الموعد. جرب تاريخ آخر.'
                  : 'No trips found for this date. Try a different date.'}
              </p>
            </motion.div>
          )}

          {!loading && trips && trips.length > 0 && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {isAr
                  ? `${trips.length} رحلة من ${fromCity?.nameAr} إلى ${toCity?.nameAr}`
                  : `${trips.length} trips from ${fromCity?.nameEn} to ${toCity?.nameEn}`}
              </p>

              {Object.entries(groupedByOperator).map(([slug, opTrips]) => (
                <div key={slug}>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: OPERATOR_COLORS[slug] ?? '#6B7280' }}
                    />
                    <h2 className="font-semibold text-sm text-foreground">
                      {OPERATOR_LABELS[slug] ?? slug}
                    </h2>
                    <span className="text-xs text-muted-foreground">({opTrips.length})</span>
                  </div>
                  <div className="space-y-3">
                    {opTrips.map((trip, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: idx * 0.05 }}
                      >
                        <Card className="overflow-hidden rounded-[2rem] glass-panel">
                          <div
                            className="h-1"
                            style={{ backgroundColor: OPERATOR_COLORS[trip.operatorSlug] ?? '#6B7280' }}
                          />
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              {/* Times */}
                              <div className="flex items-center gap-3">
                                <div className="text-center">
                                  <p className="text-lg font-bold text-foreground leading-none">{trip.departure}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 max-w-[80px] truncate">{trip.fromStation}</p>
                                </div>
                                <div className="flex flex-col items-center gap-1 flex-1">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {formatDuration(trip.durationMinutes)}
                                  </div>
                                  <div className="w-16 h-px bg-border relative">
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 border-t-4 border-l-4 border-b-4 border-b-transparent border-t-transparent border-l-muted-foreground" />
                                  </div>
                                  {trip.busType && (
                                    <span className="text-[10px] text-muted-foreground">{trip.busType}</span>
                                  )}
                                </div>
                                <div className="text-center">
                                  <p className="text-lg font-bold text-foreground leading-none">{trip.arrival || '—'}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 max-w-[80px] truncate">{trip.toStation}</p>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t">
                              <div className="flex items-center gap-1">
                                <Wallet className="h-3.5 w-3.5 text-primary" />
                                <span className="text-base font-bold text-primary">{trip.priceEgp} EGP</span>
                              </div>
                              {trip.bookingUrl ? (
                                <a
                                  href={trip.bookingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-3 py-2 rounded-[1.25rem] hover:bg-primary/90 transition-colors"
                                >
                                  {isAr ? 'احجز' : 'Book'}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground capitalize">
                                  {trip.bookingMethod}
                                </span>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* City picker modals */}
      <AnimatePresence>
        {(showFromPicker || showToPicker) && (
          <motion.div
            key="picker-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end"
            onClick={() => { setShowFromPicker(false); setShowToPicker(false); }}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="glass-panel w-full rounded-t-[2rem] max-h-[70vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b">
                <p className="font-semibold text-center mb-3">
                  {showFromPicker
                    ? (isAr ? 'اختر مدينة الانطلاق' : 'Select departure city')
                    : (isAr ? 'اختر مدينة الوصول' : 'Select destination city')}
                </p>
                <input
                  autoFocus
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  placeholder={isAr ? 'ابحث عن مدينة...' : 'Search city...'}
                  className="w-full h-10 px-4 rounded-[1.5rem] border bg-background/70 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="overflow-y-auto flex-1 p-2">
                {filteredCities.map((city) => (
                  <button
                    key={city.id}
                    className="w-full text-start px-4 py-3 rounded-[1.5rem] hover:bg-muted transition-colors flex items-center justify-between"
                    onClick={() => {
                      if (showFromPicker) setFromCity(city);
                      else setToCity(city);
                      setShowFromPicker(false);
                      setShowToPicker(false);
                    }}
                  >
                    <div>
                      <p className="font-medium text-foreground text-sm">{isAr ? city.nameAr : city.nameEn}</p>
                      <p className="text-xs text-muted-foreground">{city.governorate}</p>
                    </div>
                    {(showFromPicker ? fromCity?.id : toCity?.id) === city.id && (
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

export default Intercity;
