import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { toast } from 'sonner';
import { Bus, MapPin, Square } from 'lucide-react';

const REJECTION_REASON_KEYS: Record<string, string> = {
  no_gps_points: 'discoveryReasonFewPoints',
  too_few_valid_gps_points: 'discoveryReasonFewPoints',
  outside_supported_region: 'discoveryReasonOutsideRegion',
  missing_route_direction: 'discoveryReasonMissingDirection',
  same_start_and_destination: 'discoveryReasonMissingDirection',
  direction_not_confirmed: 'discoveryReasonMissingDirection',
  trace_too_short: 'discoveryReasonTooShort',
  snapped_route_too_short: 'discoveryReasonTooShort',
  snapped_route_too_sparse: 'discoveryReasonTooShort',
  start_and_end_too_close: 'discoveryReasonEndpointsClose',
  stationary_trace: 'discoveryReasonStationary',
  recording_too_short: 'discoveryReasonTooBrief',
  recording_too_long: 'discoveryReasonTooLong',
  // The most common real-world trigger: highway driving with a weak/lost
  // GPS signal computes as an "impossible" jump between two points.
  impossible_gps_jump: 'discoveryReasonImpossibleJump',
  snap_failed: 'discoveryReasonSnapFailed',
  snap_too_far_from_trace: 'discoveryReasonSnapFailed',
  snap_endpoint_mismatch: 'discoveryReasonSnapFailed',
  snap_distance_ratio_bad: 'discoveryReasonSnapFailed',
};

function rejectionMessage(reason: string | undefined, language: Language): string {
  const key = (reason && REJECTION_REASON_KEYS[reason]) || 'discoveryReasonGeneric';
  return t(key, language);
}

interface ContributeTransportDialogProps {
  open: boolean;
  onClose: () => void;
  language: Language;
  initialTrace?: [number, number][];
  initialTimestamps?: number[];
  initialOperator?: Operator;
  initialFromArea?: string;
  initialToArea?: string;
  initialRouteCompleteness?: 'full' | 'partial';
  discoverySource?: 'profile' | 'trip' | 'manual' | 'native';
  onSubmitted?: () => void;
}

type Operator = 'microbus' | 'bus';
interface TransportType {
  id: string;
  nameEn: string;
}

const OPERATOR_TYPE_NAME: Record<Operator, string> = {
  microbus: 'Microbus',
  bus: 'Bus',
};

export default function ContributeTransportDialog({
  open,
  onClose,
  language,
  initialTrace,
  initialTimestamps,
  initialOperator = 'microbus',
  initialFromArea = '',
  initialToArea = '',
  initialRouteCompleteness = 'partial',
  discoverySource = 'manual',
  onSubmitted,
}: ContributeTransportDialogProps) {
  const isTraceSubmit = !!initialTrace?.length;
  const [transportNumber, setTransportNumber] = useState('');
  const [operator, setOperator] = useState<Operator>(initialOperator);
  const [busOperator, setBusOperator] = useState<'nta' | 'cta'>('nta');
  const [fromArea, setFromArea] = useState('');
  const [fromAreaResolving, setFromAreaResolving] = useState(false);
  const [toArea, setToArea] = useState('');
  const [price, setPrice] = useState('');
  const [routeCompleteness, setRouteCompleteness] = useState<'full' | 'partial'>('full');
  // Direction is always taken to be the direction actually recorded by GPS —
  // there's nothing for the rider to confirm, so this is no longer a UI toggle.
  const directionConfirmed = true;
  const [trace, setTrace] = useState<[number, number][]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setOperator(initialOperator);
    setRouteCompleteness(initialRouteCompleteness);
    setFromArea(initialFromArea);
    setToArea(initialToArea);
    let cancelled = false;
    api
      .get('/transport-types')
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setTransportTypes(data as TransportType[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, initialOperator, initialRouteCompleteness]);

  useEffect(() => {
    if (!open) return;
    if (initialFromArea) setFromArea((current) => current || initialFromArea);
    if (initialToArea) setToArea((current) => current || initialToArea);
  }, [open, initialFromArea, initialToArea]);

  useEffect(() => {
    if (!open || initialFromArea) return; // already known from the caller (e.g. a native trip discovery)
    const firstPoint = (initialTrace?.length ? initialTrace : trace)[0];
    if (!firstPoint) return;
    let cancelled = false;
    setFromAreaResolving(true);
    api
      .get<{ nameEn: string | null; nameAr: string | null }>(
        `/transport-reports/reverse-geocode?lat=${firstPoint[1]}&lng=${firstPoint[0]}`,
      )
      .then((result) => {
        if (cancelled) return;
        const resolved = language === 'ar' ? (result?.nameAr || result?.nameEn) : (result?.nameEn || result?.nameAr);
        if (resolved) setFromArea(resolved);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFromAreaResolving(false);
      });
    return () => {
      cancelled = true;
    };
    // Only re-resolve when the starting point itself changes (first capture),
    // not on every subsequent GPS point appended while recording continues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFromArea, initialTrace?.[0]?.[0], initialTrace?.[0]?.[1], trace[0]?.[0], trace[0]?.[1], language]);

  const reset = () => {
    setTransportNumber('');
    setOperator(initialOperator);
    setBusOperator('nta');
    setFromArea('');
    setToArea('');
    setPrice('');
    setRouteCompleteness('partial');
    setTrace([]);
    setTimestamps([]);
    stopRecording();
  };

  const stopRecording = () => {
    if (watchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setRecording(false);
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
      return;
    }
    if (!navigator.geolocation) return;
    setRecording(true);
    let lastAccepted: { lng: number; lat: number; ts: number } | null = null;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const ts = pos.timestamp || Date.now();
        // Matches the native trip-discovery service's own 5s/5m minimums --
        // unthrottled high-accuracy GPS fires rapidly with normal jitter,
        // which reads as an implausible point-to-point speed server-side.
        if (lastAccepted) {
          const dtSeconds = (ts - lastAccepted.ts) / 1000;
          const dLat = ((lat - lastAccepted.lat) * Math.PI) / 180;
          const dLng = ((lng - lastAccepted.lng) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((lastAccepted.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          const distanceMeters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (dtSeconds < 4 && distanceMeters < 5) return;
        }
        lastAccepted = { lng, lat, ts };
        setTrace((prev) => [...prev, [lng, lat]]);
        setTimestamps((prev) => [...prev, ts]);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  };

  const handleSubmit = async () => {
    if (operator === 'bus' && !transportNumber.trim()) {
      toast.error(t('busNumberRequired', language));
      return;
    }
    // Require from/to areas for both operators when recording a GPS trace, so the
    // direction of travel is always captured for the route the contributor rode.
    if (isTraceSubmit && (!fromArea.trim() || !toArea.trim())) {
      toast.error(t('microbusRouteDetailsRequired', language));
      return;
    }
    setSubmitting(true);
    try {
      const priceNum = Number(price);
      const transportTypeId =
        transportTypes.find((tt) => {
          const name = operator === 'bus' ? (busOperator === 'cta' ? 'CTA Bus' : 'NTA Bus') : OPERATOR_TYPE_NAME[operator];
          return tt.nameEn.toLowerCase() === name.toLowerCase() || tt.nameEn.toLowerCase() === OPERATOR_TYPE_NAME[operator].toLowerCase();
        })?.id ?? null;
      const response = await api.post<{ accepted?: boolean; reason?: string }>('/transport-reports', {
        transportName: operator === 'microbus' ? 'Microbus' : (busOperator === 'cta' ? 'CTA Bus' : 'NTA Bus'),
        transportNumber: transportNumber || null,
        transportTypeId,
        fromArea: fromArea || null,
        toArea: toArea || null,
        priceEgp: Number.isFinite(priceNum) && price !== '' ? priceNum : null,
        gpsTrace: (initialTrace?.length ? initialTrace : trace).length ? (initialTrace?.length ? initialTrace : trace) : null,
        gpsTimestamps: (initialTimestamps?.length ? initialTimestamps : timestamps).length
          ? (initialTimestamps?.length ? initialTimestamps : timestamps)
          : null,
        routeCompleteness,
        directionConfirmed,
        discoverySource,
      });
      // The backend responds 200 OK even when it rejects a submission (bad
      // GPS data, failed road-matching, etc.) -- accepted:false there means
      // nothing was saved, so this must not be treated as success.
      if (response?.accepted === false) {
        toast.error(rejectionMessage(response.reason, language));
        return;
      }
      toast.success(t('contributeSubmitted', language));
      reset();
      onSubmitted?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('contributeFailed', language));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm" hideClose>
        <DialogHeader>
          <DialogTitle>{t('contributeTitle', language)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-[2rem] bg-primary/10 p-3 flex gap-3 text-sm text-foreground">
            <Bus className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <p>{t('contributeBusMicrobusOnly', language)}</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">{t('operatorLabel', language)}</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(['microbus', 'bus'] as Operator[]).map((op) => (
                <Button
                  key={op}
                  type="button"
                  variant={operator === op ? 'default' : 'outline'}
                  className="w-full h-11 rounded-[2rem] text-xs"
                  onClick={() => setOperator(op)}
                >
                  {op === 'microbus' ? t('microbus', language) : t('bus', language)}
                </Button>
              ))}
            </div>
            <button
              type="button"
              className="mt-1.5 w-full text-center text-[11px] text-primary hover:underline"
              onClick={() => setOperator((value) => value === 'bus' ? 'microbus' : 'bus')}
            >
              {operator === 'bus'
                ? t('tookMicrobusInstead', language)
                : t('tookBusInstead', language)}
            </button>
          </div>
          {operator === 'bus' && (
            <>
              <div>
                <label className="text-xs text-muted-foreground">{t('operatorLabel', language)}</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(['nta', 'cta'] as const).map((op) => (
                    <Button
                      key={op}
                      type="button"
                      variant={busOperator === op ? 'default' : 'outline'}
                      className="w-full h-11 rounded-[2rem] text-xs"
                      onClick={() => setBusOperator(op)}
                    >
                      {t(op === 'nta' ? 'operatorNta' : 'operatorCta', language)}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('busNumber', language)}</label>
                <Input value={transportNumber} onChange={(e) => setTransportNumber(e.target.value)} className="text-sm rounded-[2rem]" />
              </div>
            </>
          )}
          {operator === 'microbus' && (
            <div>
              <label className="text-xs text-muted-foreground">{t('microbusNumberOptional', language)}</label>
              <Input value={transportNumber} onChange={(e) => setTransportNumber(e.target.value)} className="text-sm rounded-[2rem]" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">
                {t(operator === 'microbus' ? 'microbusBoardingArea' : 'fromArea', language)}
              </label>
              <div className="h-9 flex items-center px-3 rounded-[2rem] border bg-muted/40 text-sm truncate">
                {fromAreaResolving ? (
                  <span className="text-muted-foreground animate-pulse">…</span>
                ) : (
                  fromArea || <span className="text-muted-foreground">{t('locating', language)}</span>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                {t(operator === 'microbus' ? 'microbusRouteEnd' : 'toArea', language)}
              </label>
              <Input value={toArea} onChange={(e) => setToArea(e.target.value)} className="text-sm rounded-[2rem]" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('priceLabel', language)}</label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="text-sm rounded-[2rem]" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={routeCompleteness === 'full' ? 'default' : 'outline'}
              className="h-10 rounded-[2rem] text-xs"
              onClick={() => setRouteCompleteness('full')}
            >
              Full route
            </Button>
            <Button
              type="button"
              variant={routeCompleteness === 'partial' ? 'default' : 'outline'}
              className="h-10 rounded-[2rem] text-xs"
              onClick={() => setRouteCompleteness('partial')}
            >
              Partial route
            </Button>
          </div>

          {!isTraceSubmit && (
            <Button
              type="button"
              variant={recording ? 'destructive' : 'outline'}
              className="w-full h-12 rounded-[2rem] gap-2"
              onClick={toggleRecording}
            >
              {recording ? <Square className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
              {recording ? t('stopRecording', language) : t('recordGps', language)}
            </Button>
          )}
          {(initialTrace?.length || trace.length) > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {initialTrace?.length || trace.length} {t('gpsPointsCaptured', language)}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button className="flex-1 h-11 rounded-[2rem]" onClick={handleSubmit} disabled={submitting}>
              {t('save', language)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
