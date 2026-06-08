import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Clock, Wallet, MapPin, RefreshCw, Check, Navigation, X, Info, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import Map, { Marker, type MapRef } from 'react-map-gl/maplibre';
import RouteLayers from '@/components/RouteLayers';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useIsDark, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from '@/hooks/useIsDark';

interface Segment {
  transport_type_id: string; transport_name: string; start_name: string; end_name: string;
  cost_egp: number; duration_minutes: number; color: string; icon: string;
  alternatives: Alternative[];
  line_id?: string | null; line_number?: string | null; info?: string; instructions?: string[];
  route_geometry?: [number, number][] | null;
}
interface Alternative {
  transport_type_id: string; transport_name: string; cost_egp: number; duration_minutes: number; color: string; icon: string; line_id?: string | null; line_number?: string | null; info?: string; instructions?: string[]; route_geometry?: [number, number][] | null;
}
interface TripPlanData {
  segments: Segment[]; total_cost_egp: number; total_duration_minutes: number;
  budget_range: { min: number; max: number }; distance_km: number; destination: string;
  tripType: string; startLat: number; startLng: number; destLat: number; destLng: number;
}

type LngLat = [number, number];
type RouteCoords = { segIndex: number; coords: LngLat[] }[];

const ICONS: Record<string, string> = {
  bus: '🚌', train: '🚆', car: '🚕', bike: '🛺', ship: '🚢', plane: '✈️', metro: '🚇', monorail: '🚝', walk: '🚶',
};

const toRad = (deg: number) => deg * Math.PI / 180;
const toDeg = (rad: number) => rad * 180 / Math.PI;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const bearingDegrees = (from: LngLat, to: LngLat) => {
  const fromLat = toRad(from[1]);
  const toLat = toRad(to[1]);
  const dLng = toRad(to[0] - from[0]);
  const y = Math.sin(dLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const projectOntoSegment = (point: LngLat, start: LngLat, end: LngLat) => {
  const metersPerLat = 111132;
  const metersPerLng = Math.max(Math.cos(toRad(point[1])) * 111320, 0.000001);
  const sx = (start[0] - point[0]) * metersPerLng;
  const sy = (start[1] - point[1]) * metersPerLat;
  const ex = (end[0] - point[0]) * metersPerLng;
  const ey = (end[1] - point[1]) * metersPerLat;
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq ? clamp(((-sx) * dx + (-sy) * dy) / lenSq) : 0;
  const snapped: LngLat = [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
  const snappedX = sx + dx * t;
  const snappedY = sy + dy * t;
  return { snapped, distance: Math.sqrt(snappedX * snappedX + snappedY * snappedY) };
};

const getRouteProgress = (routeCoords: RouteCoords, userPos: { lat: number; lng: number }) => {
  const userCoord: LngLat = [userPos.lng, userPos.lat];
  let best: {
    segIndex: number;
    coordIndex: number;
    snapped: LngLat;
    bearing: number;
    distance: number;
  } | null = null;

  routeCoords.forEach(({ segIndex, coords }) => {
    for (let i = 0; i < coords.length - 1; i += 1) {
      const start = coords[i];
      const end = coords[i + 1];
      const projected = projectOntoSegment(userCoord, start, end);
      if (!best || projected.distance < best.distance) {
        best = {
          segIndex,
          coordIndex: i,
          snapped: projected.snapped,
          bearing: bearingDegrees(start, end),
          distance: projected.distance,
        };
      }
    }
  });

  if (!best) return null;

  const remainingRouteCoords = routeCoords
    .map(({ segIndex, coords }) => {
      if (!best || segIndex < best.segIndex) return null;
      if (segIndex > best.segIndex) return { segIndex, coords };
      const trimmed = [best.snapped, ...coords.slice(best.coordIndex + 1)];
      return { segIndex, coords: trimmed.length >= 2 ? trimmed : [best.snapped, best.snapped] as LngLat[] };
    })
    .filter((route): route is { segIndex: number; coords: LngLat[] } => !!route && route.coords.length >= 2);

  return {
    segIndex: best.segIndex,
    snapped: best.snapped,
    bearing: best.bearing,
    distanceFromRouteMeters: best.distance,
    remainingRouteCoords,
  };
};

const TripResult = () => {
  const navigate = useNavigate();
  const { language } = useAuth();
  const [plan, setPlan] = useState<TripPlanData | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [isTracking, setIsTracking] = useState(false);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [currentSegIndex, setCurrentSegIndex] = useState(0);
  const [routeCoords, setRouteCoords] = useState<RouteCoords>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [popupSegIndex, setPopupSegIndex] = useState<number | null>(null);
  const watchRef = useRef<number | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  const isDark = useIsDark();

  useEffect(() => {
    const stored = sessionStorage.getItem('tripPlan');
    if (stored) setPlan(JSON.parse(stored));
    else navigate('/');
  }, [navigate]);

  // Render the route geometry supplied by the backend directly — no client-side
  // road snapping. Segments without geometry fall back to a straight line.
  const loadRoutes = useCallback(() => {
    if (!plan) return;
    setIsLoadingRoutes(true);
    const results: { segIndex: number; coords: [number, number][] }[] = [];

    const segCount = plan.segments.length;
    for (let i = 0; i < segCount; i++) {
      const seg = plan.segments[i];
      // Use the backend-supplied geometry for this segment directly
      if (seg.route_geometry && seg.route_geometry.length >= 2) {
        results.push({ segIndex: i, coords: seg.route_geometry });
        continue;
      }
      // Otherwise draw a straight line between approximated start/end positions
      const startLng = plan.startLng + (plan.destLng - plan.startLng) * (i / segCount);
      const startLat = plan.startLat + (plan.destLat - plan.startLat) * (i / segCount);
      const endLng = plan.startLng + (plan.destLng - plan.startLng) * ((i + 1) / segCount);
      const endLat = plan.startLat + (plan.destLat - plan.startLat) * ((i + 1) / segCount);
      results.push({ segIndex: i, coords: [[startLng, startLat], [endLng, endLat]] });
    }

    setRouteCoords(results);
    setIsLoadingRoutes(false);
  }, [plan]);

  useEffect(() => { if (plan) loadRoutes(); }, [plan, loadRoutes]);

  const startTracking = useCallback(() => {
    setIsTracking(true);
    setShowMap(true);
    setCurrentSegIndex(0);
    if (navigator.geolocation) {
      watchRef.current = navigator.geolocation.watchPosition(
        pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => toast.error(t('gpsUnavailable', language)),
        { enableHighAccuracy: true, maximumAge: 3000 }
      );
    }
    toast.success(t('haveGreatTrip', language));
  }, [language]);

  useEffect(() => {
    return () => { if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current); };
  }, []);

  const routeProgress = useMemo(
    () => (isTracking && userPos ? getRouteProgress(routeCoords, userPos) : null),
    [isTracking, routeCoords, userPos]
  );
  const displayedRouteCoords = routeProgress?.remainingRouteCoords.length ? routeProgress.remainingRouteCoords : routeCoords;
  const trackingLngLat = routeProgress?.snapped ?? (userPos ? [userPos.lng, userPos.lat] as LngLat : null);
  const trackingBearing = routeProgress?.bearing ?? 0;

  useEffect(() => {
    if (routeProgress) setCurrentSegIndex(routeProgress.segIndex);
  }, [routeProgress]);

  useEffect(() => {
    if (isTracking || !routeCoords.length || !mapRef.current) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    routeCoords.forEach(({ coords }) => coords.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }));
    if (Number.isFinite(minLng)) {
      try { mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 48, duration: 600 }); } catch {}
    }
  }, [isTracking, routeCoords]);

  useEffect(() => {
    if (!isTracking || !trackingLngLat || !mapRef.current) return;
    const map = mapRef.current.getMap();
    map.easeTo({
      center: trackingLngLat,
      zoom: 17.6,
      bearing: trackingBearing,
      pitch: 58,
      offset: [0, 110],
      duration: 700,
      essential: true,
    });
  }, [isTracking, trackingBearing, trackingLngLat]);

  const stopTracking = () => {
    setIsTracking(false);
    if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current);
  };

  const handleSwap = (segIndex: number, alt: Alternative) => {
    if (!plan) return;
    const newSegments = [...plan.segments];
    const oldSeg = newSegments[segIndex];
    newSegments[segIndex] = {
      ...oldSeg,
      transport_type_id: alt.transport_type_id,
      transport_name: alt.transport_name,
      cost_egp: alt.cost_egp,
      duration_minutes: alt.duration_minutes,
      color: alt.color,
      icon: alt.icon,
      line_id: alt.line_id ?? null,
      line_number: alt.line_number || '',
      info: alt.info ?? oldSeg.info,
      instructions: alt.instructions ?? oldSeg.instructions,
      route_geometry: alt.route_geometry && alt.route_geometry.length >= 2 ? alt.route_geometry : oldSeg.route_geometry,
    };
    const newTotal = newSegments.reduce((s, seg) => s + seg.cost_egp, 0);
    const newTime = newSegments.reduce((s, seg) => s + seg.duration_minutes, 0);
    const updated = { ...plan, segments: newSegments, total_cost_egp: newTotal, total_duration_minutes: newTime };
    setPlan(updated);
    sessionStorage.setItem('tripPlan', JSON.stringify(updated));
    setRouteCoords((prev) => prev.map((r) => r.segIndex === segIndex && alt.route_geometry?.length ? { ...r, coords: alt.route_geometry! } : r));
    setSwapIndex(null);
    setPopupSegIndex(segIndex);
    toast.success(t('planUpdated', language));
  };

  if (!plan) return null;

  const getIcon = (icon: string) => ICONS[icon] || '🚌';

  const routeGeoJSON = {
    type: 'FeatureCollection' as const,
    features: displayedRouteCoords.map(({ segIndex, coords }) => ({
      type: 'Feature' as const,
      properties: { color: plan.segments[segIndex]?.color || '#3B82F6', name: plan.segments[segIndex]?.line_number || plan.segments[segIndex]?.transport_name },
      geometry: { type: 'LineString' as const, coordinates: coords },
    })),
  };

  const midLat = (plan.startLat + plan.destLat) / 2;
  const midLng = (plan.startLng + plan.destLng) / 2;

  const currentSeg = plan.segments[currentSegIndex];
  const nextSeg = plan.segments[currentSegIndex + 1];
  const remainingTime = plan.segments.slice(currentSegIndex).reduce((s, seg) => s + seg.duration_minutes, 0);
  const isLastSeg = currentSegIndex >= plan.segments.length - 1;

  const popupSeg = popupSegIndex != null ? plan.segments[popupSegIndex] : null;
  const popupCoords = popupSegIndex != null ? routeCoords.find(r => r.segIndex === popupSegIndex)?.coords : null;
  const popupMid = popupCoords?.[Math.floor(popupCoords.length / 2)];

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 glass-panel border-b z-30 p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/plan?' + new URLSearchParams({
          destination: plan.destination, destLat: String(plan.destLat), destLng: String(plan.destLng),
          lat: String(plan.startLat), lng: String(plan.startLng),
        }).toString())}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-foreground">{t('yourPlan', language)}</p>
          <p className="text-xs text-muted-foreground truncate">{plan.destination}</p>
        </div>
      </div>

      {/* Sticky tracking notification with Next/Check buttons */}
      {isTracking && currentSeg && (
        <div className="sticky top-[65px] z-20 bg-primary text-primary-foreground p-3 shadow-lg space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: currentSeg.color }}>
              {getIcon(currentSeg.icon)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {currentSeg.line_number && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{currentSeg.line_number}</Badge>}
                <p className="text-sm font-semibold truncate">{currentSeg.transport_name}</p>
              </div>
              <p className="text-xs opacity-90 truncate">~{Math.round(remainingTime)} min left · → {currentSeg.end_name}</p>
              {nextSeg && (
                <p className="text-[10px] opacity-75 truncate">Next: {getIcon(nextSeg.icon)} {nextSeg.line_number || ''} {nextSeg.transport_name}</p>
              )}
            </div>
            <Button size="icon" variant="secondary" className="shrink-0 h-8 w-8" onClick={stopTracking}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            {!isLastSeg ? (
              <Button size="sm" variant="secondary" className="flex-1 gap-1 h-9"
                onClick={() => { setCurrentSegIndex(i => i + 1); toast.success(t('movedToNextSegment', language)); }}>
                <ChevronRight className="h-4 w-4" /> {t('nextSegment', language)}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" className="flex-1 gap-1 h-9"
                onClick={() => { stopTracking(); toast.success(t('tripComplete', language)); }}>
                <Check className="h-4 w-4" /> {t('markTripComplete', language)}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Map */}
      <AnimatePresence>
        {(showMap || isTracking) && (
          <motion.div initial={{ height: 0 }} animate={{ height: isTracking ? 420 : 320 }} exit={{ height: 0 }} className="overflow-hidden">
            <Map
              ref={mapRef}
              initialViewState={{ latitude: trackingLngLat?.[1] || userPos?.lat || midLat, longitude: trackingLngLat?.[0] || userPos?.lng || midLng, zoom: isTracking ? 17.6 : 11, pitch: isTracking ? 58 : 0, bearing: isTracking ? trackingBearing : 0 }}
              mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
              style={{ width: '100%', height: isTracking ? 420 : 320 }}
              attributionControl={false}
              onError={(e) => { const err = (e as { error?: Error })?.error; console.error('[trip-map] error:', err?.message || e, err?.stack); }}
            >
              {isLoadingRoutes && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <RouteLayers id="route" data={routeGeoJSON} />

              {/* Segment icon markers — clickable to open popup */}
              {!isTracking && routeCoords.map(({ segIndex, coords }) => {
                if (!coords.length) return null;
                const mid = coords[Math.floor(coords.length / 2)];
                const seg = plan.segments[segIndex];
                return (
                  <Marker key={`seg-${segIndex}`} latitude={mid[1]} longitude={mid[0]} anchor="bottom">
                    <button onClick={e => { e.stopPropagation(); setPopupSegIndex(segIndex); }}
                      className="flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full shadow-lg border-2 border-white hover:scale-110 transition-transform"
                      style={{ backgroundColor: seg?.color || '#3B82F6' }}>
                      <div className="h-6 w-6 rounded-full flex items-center justify-center text-xs bg-black/20">{getIcon(seg?.icon || 'bus')}</div>
                      {seg?.line_number && <span className="text-[11px] font-bold text-white whitespace-nowrap">{seg.line_number}</span>}
                    </button>
                  </Marker>
                );
              })}

              {/* Popup-like Marker for clicked segment */}
              {popupSeg && popupMid && (
                <Marker latitude={popupMid[1]} longitude={popupMid[0]} anchor="bottom" offset={[0, -36]}>
                  <div className="glass-popup-surface rounded-[2rem] p-4 w-72 text-foreground relative">
                    <button onClick={() => setPopupSegIndex(null)} className="absolute top-1 right-1 h-5 w-5 rounded-full hover:bg-accent flex items-center justify-center">
                      <X className="h-3 w-3" />
                    </button>
                    <div className="flex items-center gap-2 pr-5">
                      <div className="h-8 w-8 rounded-full flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: popupSeg.color + '20', border: `2px solid ${popupSeg.color}` }}>{getIcon(popupSeg.icon)}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          {popupSeg.line_number && <Badge variant="outline" className="text-[10px] h-4 px-1" style={{ borderColor: popupSeg.color, color: popupSeg.color }}>{popupSeg.line_number}</Badge>}
                          <p className="text-sm font-semibold truncate">{popupSeg.transport_name}</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{popupSeg.start_name} → {popupSeg.end_name}</p>
                    <div className="flex items-center gap-3 text-xs mt-1">
                      <span>⏱ {Math.round(popupSeg.duration_minutes)} min</span>
                      <span>💰 {Math.round(popupSeg.cost_egp)} EGP</span>
                    </div>
                    {popupSeg.info && <p className="text-[11px] text-muted-foreground border-t pt-2 mt-2">{popupSeg.info}</p>}
                    {popupSeg.instructions?.length ? (
                      <ol className="mt-2 space-y-1 border-t pt-2">
                        {popupSeg.instructions.slice(0, 4).map((ins, idx) => (
                          <li key={idx} className="flex gap-1.5 text-[11px] leading-snug">
                            <span className="h-3.5 w-3.5 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                            <span>{ins}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                </Marker>
              )}

              <Marker latitude={plan.startLat} longitude={plan.startLng}>
                <div className="h-4 w-4 rounded-full bg-primary border-2 border-primary-foreground shadow" />
              </Marker>
              <Marker latitude={plan.destLat} longitude={plan.destLng} anchor="bottom">
                <MapPin className="h-8 w-8 text-destructive drop-shadow-lg" fill="currentColor" strokeWidth={1.5} />
              </Marker>
              {trackingLngLat && isTracking && currentSeg && (
                <Marker latitude={trackingLngLat[1]} longitude={trackingLngLat[0]} anchor="center">
                  <div className="relative flex h-14 w-14 items-center justify-center">
                    <div className="absolute h-12 w-12 rounded-full bg-blue-500/25 animate-ping" />
                    <div
                      className="relative flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 border-2 border-white shadow-xl"
                      style={{ transform: 'rotate(0deg)' }}
                    >
                      <Navigation className="h-5 w-5 text-white" fill="currentColor" />
                    </div>
                    <div className="absolute -bottom-0.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-background px-1 text-xs shadow-md">
                      {getIcon(currentSeg.icon)}
                    </div>
                  </div>
                </Marker>
              )}
            </Map>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <Card className="glass-panel rounded-[2rem]"><CardContent className="p-3 text-center">
          <Wallet className="h-4 w-4 mx-auto text-primary mb-1" />
          <p className="text-lg font-bold text-foreground">{Math.round(plan.total_cost_egp)}</p>
          <p className="text-xs text-muted-foreground">{t('egp', language)}</p>
        </CardContent></Card>
        <Card className="glass-panel rounded-[2rem]"><CardContent className="p-3 text-center">
          <Clock className="h-4 w-4 mx-auto text-primary mb-1" />
          <p className="text-lg font-bold text-foreground">{Math.round(plan.total_duration_minutes)}</p>
          <p className="text-xs text-muted-foreground">{t('minutes', language)}</p>
        </CardContent></Card>
        <Card className="glass-panel rounded-[2rem]"><CardContent className="p-3 text-center">
          <MapPin className="h-4 w-4 mx-auto text-primary mb-1" />
          <p className="text-lg font-bold text-foreground">{plan.distance_km?.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">km</p>
        </CardContent></Card>
      </div>

      {/* Segments list — show line number + i info popover */}
      <div className="px-4 pb-6 space-y-1">
        {plan.segments.map((seg, i) => (
          <motion.div key={`${seg.transport_type_id}-${i}`}
            initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.1 }}>
            <div className="flex items-center gap-3 py-1">
              <div className="w-8 flex justify-center">
                <div className="h-3 w-3 rounded-full border-2" style={{ borderColor: seg.color }} />
              </div>
              <p className="text-sm text-muted-foreground">{seg.start_name}</p>
            </div>
            <div className="flex gap-3">
              <div className="w-8 flex justify-center">
                <div className="w-0.5 h-full" style={{ backgroundColor: seg.color }} />
              </div>
              <div className="flex-1">
                <Card className="border-l-4 glass-panel" style={{ borderLeftColor: seg.color }}>
                  <CardContent className="p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 rounded-full flex items-center justify-center text-lg shrink-0"
                          style={{ backgroundColor: seg.color + '20' }}>
                          {getIcon(seg.icon)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {seg.line_number && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4" style={{ borderColor: seg.color, color: seg.color }}>{seg.line_number}</Badge>}
                            <p className="text-sm font-medium text-foreground truncate">{seg.transport_name}</p>
                            {seg.info && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="h-5 w-5 rounded-full bg-muted hover:bg-accent flex items-center justify-center shrink-0">
                                    <Info className="h-3 w-3 text-muted-foreground" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-xs">
                                  <p className="font-semibold mb-1">{seg.transport_name}</p>
                                  <p className="text-muted-foreground">{seg.info}</p>
                                </PopoverContent>
                              </Popover>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {Math.round(seg.duration_minutes)} {t('minutes', language)} · {Math.round(seg.cost_egp)} {t('egp', language)}
                          </p>
                        </div>
                      </div>
                      {seg.alternatives?.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setSwapIndex(swapIndex === i ? null : i)} className="gap-1 text-xs shrink-0">
                          <RefreshCw className="h-3 w-3" /> {t('swap', language)}
                        </Button>
                      )}
                    </div>
                    <AnimatePresence>
                      {swapIndex === i && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="mt-3 pt-3 border-t space-y-2">
                            <p className="text-xs text-muted-foreground font-medium">{t('alternativeOptions', language)}:</p>
                            {seg.alternatives.map((alt, j) => (
                              <button key={j} onClick={() => handleSwap(i, alt)}
                                className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl bg-background/45 hover:bg-accent/20 backdrop-blur transition-colors">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{getIcon(alt.icon)}</span>
                                  {alt.line_number && <Badge variant="outline" className="text-[10px] h-4 px-1">{alt.line_number}</Badge>}
                                  <span className="text-sm">{alt.transport_name}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {Math.round(alt.duration_minutes)} {t('minutes', language)} · {Math.round(alt.cost_egp)} {t('egp', language)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </div>
            </div>
            {i === plan.segments.length - 1 && (
              <div className="flex items-center gap-3 py-1">
                <div className="w-8 flex justify-center"><div className="h-3 w-3 rounded-full bg-destructive" /></div>
                <p className="text-sm font-medium text-foreground">{seg.end_name}</p>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {!isTracking && (
        <div className="sticky bottom-0 p-4 glass-panel border-t">
          <Button className="w-full h-14 text-base rounded-[2rem] gap-2" onClick={() => {
            const stored = sessionStorage.getItem('tripPlan');
            if (stored) sessionStorage.setItem('activeTrip', stored);
            navigate('/');
          }}>
            <Navigation className="h-5 w-5" />
            {t('startGuide', language)}
          </Button>
        </div>
      )}
    </div>
  );
};

export default TripResult;
