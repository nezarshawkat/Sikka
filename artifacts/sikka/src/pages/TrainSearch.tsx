import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowLeftRight, Clock, MapPin, Train, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { toast } from 'sonner';

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

const TrainSearch = () => {
  const navigate = useNavigate();
  const { language } = useAuth();
  const isAr = language === 'ar';

  const [cities, setCities] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [results, setResults] = useState<TrainRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [autoSearch, setAutoSearch] = useState(false);

  useEffect(() => {
    api.get<string[]>('/trains/cities').then(setCities).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const toParam = params.get('to');
    if (fromParam) setFrom(fromParam);
    if (toParam) setTo(toParam);
    if (fromParam || toParam) setAutoSearch(true);
  }, []);

  // Fires once after the URL-prefilled from/to land in state.
  useEffect(() => {
    if (autoSearch && (from || to)) {
      setAutoSearch(false);
      void handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, from, to]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (from.trim()) params.set('from', from.trim());
      if (to.trim()) params.set('to', to.trim());
      const data = await api.get<TrainRow[]>(`/trains/search?${params}`);
      setResults(data ?? []);
    } catch {
      toast.error(isAr ? 'فشل البحث، حاول مرة أخرى' : 'Search failed, try again');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, isAr]);

  const filteredCities = (query: string) =>
    cities.filter((c) => c.toLowerCase().includes(query.toLowerCase()));

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
        {/* From / To search bar, same shape as the intercity bus search */}
        <div className="glass-panel rounded-[2rem] p-4 space-y-2 relative">
          <div className="relative">
            <Input
              placeholder={isAr ? 'من (مدينة أو محطة)' : 'From (city or station)'}
              value={from}
              onChange={(e) => { setFrom(e.target.value); setShowFromPicker(true); }}
              onFocus={() => setShowFromPicker(true)}
              className="rounded-2xl"
            />
            {showFromPicker && from && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-card border rounded-2xl shadow-xl max-h-48 overflow-y-auto z-20">
                {filteredCities(from).slice(0, 8).map((c) => (
                  <button
                    key={c}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted/50"
                    onClick={() => { setFrom(c); setShowFromPicker(false); }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-center">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={swap}>
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="relative">
            <Input
              placeholder={isAr ? 'إلى (مدينة أو محطة)' : 'To (city or station)'}
              value={to}
              onChange={(e) => { setTo(e.target.value); setShowToPicker(true); }}
              onFocus={() => setShowToPicker(true)}
              className="rounded-2xl"
            />
            {showToPicker && to && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-card border rounded-2xl shadow-xl max-h-48 overflow-y-auto z-20">
                {filteredCities(to).slice(0, 8).map((c) => (
                  <button
                    key={c}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted/50"
                    onClick={() => { setTo(c); setShowToPicker(false); }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button className="w-full rounded-2xl gap-2 mt-1" onClick={() => { setShowFromPicker(false); setShowToPicker(false); void handleSearch(); }} disabled={loading}>
            <Search className="h-4 w-4" />
            {loading ? (isAr ? 'بحث...' : 'Searching...') : (isAr ? 'بحث' : 'Search')}
          </Button>
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
    </div>
  );
};

export default TrainSearch;
