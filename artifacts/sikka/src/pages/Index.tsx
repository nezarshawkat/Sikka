import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { User, MapPin, Navigation, Square, X, LocateFixed } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Map, { Marker, type MapRef } from 'react-map-gl/maplibre';
import RouteLayers from '@/components/RouteLayers';
import 'maplibre-gl/dist/maplibre-gl.css';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { useMapStyle } from '@/hooks/useMapStyle';
import { useTripTracking } from '@/hooks/useTripTracking';
import TripGuideSheet, { type GuidePlan, type GuideSegment, type GuideAlternative } from '@/components/trip/TripGuideSheet';
import SegmentReviewDialog, { type ReviewSegment } from '@/components/trip/SegmentReviewDialog';
import BusUsedDialog from '@/components/trip/BusUsedDialog';
import IntercityChoiceDialog from '@/components/trip/IntercityChoiceDialog';
import ReportDialog from '@/components/ReportDialog';
import ContributeTransportDialog from '@/components/ContributeTransportDialog';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ';
const CAIRO_CENTER = { latitude: 30.0444, longitude: 31.2357 };
const FLIGHT_CITY_IDS = new Set([
  'cairo', 'giza', 'newCairo', '6october',
  'alexandria', 'luxor', 'aswan', 'hurghada', 'sharm',
  'sohag', 'asyut', 'matrouh',
]);
const NILE_CITY_IDS = new Set(['cairo', 'giza', 'luxor', 'aswan']);

const hasDomesticFlightOption = (fromId: string, toId: string) => (
  fromId !== toId && FLIGHT_CITY_IDS.has(fromId) && FLIGHT_CITY_IDS.has(toId)
);

const langForGeocoding = (language: string) => language === 'zh' ? 'zh-CN' : language;

const haversineMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const pointToSegmentMeters = (
  p: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const cosLat = Math.cos(toRad(p.lat));
  const ax = toRad(a[0] - p.lng) * cosLat * R;
  const ay = toRad(a[1] - p.lat) * R;
  const bx = toRad(b[0] - p.lng) * cosLat * R;
  const by = toRad(b[1] - p.lat) * R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};

const distanceToRouteMeters = (p: { lat: number; lng: number }, coords: [number, number][]) => {
  if (coords.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    best = Math.min(best, pointToSegmentMeters(p, coords[i], coords[i + 1]));
  }
  return best;
};

const closestPointOnRoute = (p: { lat: number; lng: number }, coords: [number, number][]): [number, number] | null => {
  if (coords.length < 2) return null;
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const cosLat = Math.cos(toRad(p.lat));
  let best: { point: [number, number]; dist: number } | null = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = toRad(a[0] - p.lng) * cosLat * R;
    const ay = toRad(a[1] - p.lat) * R;
    const bx = toRad(b[0] - p.lng) * cosLat * R;
    const by = toRad(b[1] - p.lat) * R;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    const dist = Math.hypot(px, py);
    if (!best || dist < best.dist) {
      best = {
        dist,
        point: [p.lng + toDeg(px / (cosLat * R)), p.lat + toDeg(py / R)],
      };
    }
  }
  return best?.point ?? null;
};

const isFlexibleConnector = (seg?: { icon?: string; transport_type_id?: string }) => {
  const key = `${seg?.icon || ''} ${seg?.transport_type_id || ''}`.toLowerCase();
  return /\b(walk|car|taxi|tuktuk|bike)\b/.test(key);
};

const isBoardAnywhereTransit = (seg?: { icon?: string; transport_type_id?: string; transport_name?: string }) => {
  const key = `${seg?.icon || ''} ${seg?.transport_type_id || ''} ${seg?.transport_name || ''}`.toLowerCase();
  return /\b(bus|microbus|serfis)\b/.test(key);
};

async function fetchConnectorRoute(
  mode: 'walking' | 'driving',
  start: { lat: number; lng: number },
  end: [number, number],
): Promise<[number, number][]> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/${mode}/${start.lng},${start.lat};${end[0]},${end[1]}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`,
    );
    const data = await res.json();
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) return coords;
  } catch {}
  return [[start.lng, start.lat], end];
}

const reverseGeocode = async (lat: number, lng: number, language: string): Promise<string> => {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&country=eg&language=${encodeURIComponent(langForGeocoding(language))}&limit=1&types=address,neighborhood,locality,place,poi`
    );
    const data = await res.json();
    return data.features?.[0]?.place_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
};

interface ActiveTripPlan extends GuidePlan {
  segments: (GuideSegment & { route_geometry?: [number, number][] | null; line_id?: string | null })[];
  startLat: number; startLng: number; destLat: number; destLng: number;
  destination: string;
}

const Index = () => {
  const { user, isLoading, language } = useAuth();
  const navigate = useNavigate();
  const { style: mapStyle, mode: mapMode } = useMapStyle();
  const mapRef = useRef<MapRef | null>(null);
  const recenteringRef = useRef(false);
  const reroutingRef = useRef(false);
  const [viewState, setViewState] = useState({ ...CAIRO_CENTER, zoom: 14 });
  const [mapNeedsRecenter, setMapNeedsRecenter] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Destination chosen by tapping the map (reverse-geocoded address shown for confirmation)
  const [pickedDest, setPickedDest] = useState<{ lat: number; lng: number; name: string; loading: boolean } | null>(null);

  const [activeTrip, setActiveTrip] = useState<ActiveTripPlan | null>(null);
  const [currentSegIdx, setCurrentSegIdx] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [routeCoords, setRouteCoords] = useState<{ segIndex: number; coords: [number, number][] }[]>([]);
  const [contributionTrace, setContributionTrace] = useState<[number, number][]>([]);
  const [isContributingRoute, setIsContributingRoute] = useState(false);
  const [showDiscoveryRecorder, setShowDiscoveryRecorder] = useState(false);
  const [contributionDialogOpen, setContributionDialogOpen] = useState(false);
  const [contributionOperator, setContributionOperator] = useState<'microbus' | 'bus'>('microbus');
  const contributionWatchRef = useRef<number | null>(null);

  const [reviewSeg, setReviewSeg] = useState<ReviewSegment | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [tripReviewOpen, setTripReviewOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [cancelTripOpen, setCancelTripOpen] = useState(false);

  // #6 — ask which bus the user took after finishing a bus segment
  const [busUsedOpen, setBusUsedOpen] = useState(false);
  const [busUsedName, setBusUsedName] = useState<string | undefined>(undefined);
  const [busUsedFrom, setBusUsedFrom] = useState<string | undefined>(undefined);
  const [busUsedTo, setBusUsedTo] = useState<string | undefined>(undefined);

  // #7 — intercity vs serfis choice when crossing governorates
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [pendingTrip, setPendingTrip] = useState<{
    planUrl: string;
    intercityUrl: string;
    trainUrl: string;
    flightUrl: string;
    taxiUrl: string;
    nileUrl: string;
    fromName: string;
    toName: string;
    hasSerfis: boolean;
    hasFlight: boolean;
    hasNile: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      if (!sessionStorage.getItem('splashShown')) {
        navigate('/splash');
      } else {
        navigate('/auth');
      }
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (sessionStorage.getItem('sikkaDiscoveryRecord') === '1') {
      sessionStorage.removeItem('sikkaDiscoveryRecord');
      const storedMode = sessionStorage.getItem('sikkaDiscoveryMode');
      sessionStorage.removeItem('sikkaDiscoveryMode');
      setContributionOperator(storedMode === 'bus' ? 'bus' : 'microbus');
      setShowDiscoveryRecorder(true);
    }
    const stored = sessionStorage.getItem('activeTrip');
    if (stored) {
      try {
        const plan = JSON.parse(stored);
        if (plan?.segments?.length) {
          setActiveTrip(plan);
          setCurrentSegIdx(0);
        }
      } catch {}
    }
  }, []);

  // On the homepage the UI theme follows the chosen MAP type (a light/white map
  // forces light mode here, a dark map forces dark mode here), independent of the
  // app-wide theme. Leaving the homepage restores the user's chosen app theme.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', mapMode === 'dark');
    return () => {
      const storedTheme = localStorage.getItem('sikka-theme');
      const appDark = storedTheme
        ? storedTheme === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', appDark);
    };
  }, [mapMode]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          setViewState((v) => ({ ...v, latitude: loc.lat, longitude: loc.lng }));
          const name = await reverseGeocode(loc.lat, loc.lng, language);
          setLocationName(name);
        },
        () => {
          setUserLocation({ lat: CAIRO_CENTER.latitude, lng: CAIRO_CENTER.longitude });
          setLocationName('Cairo, Egypt');
        }
      );
    }
  }, [language]);

  // Render the route geometry supplied by the backend directly — no client-side
  // road snapping. Segments without geometry fall back to a straight line drawn
  // between their approximated start/end positions along the trip.
  const loadRoutes = useCallback((plan: ActiveTripPlan) => {
    const results: { segIndex: number; coords: [number, number][] }[] = [];
    const segCount = plan.segments.length;
    for (let i = 0; i < segCount; i++) {
      const seg = plan.segments[i];
      if (seg.route_geometry && seg.route_geometry.length >= 2) {
        results.push({ segIndex: i, coords: seg.route_geometry });
        continue;
      }
      const startLng = plan.startLng + (plan.destLng - plan.startLng) * (i / segCount);
      const startLat = plan.startLat + (plan.destLat - plan.startLat) * (i / segCount);
      const endLng = plan.startLng + (plan.destLng - plan.startLng) * ((i + 1) / segCount);
      const endLat = plan.startLat + (plan.destLat - plan.startLat) * ((i + 1) / segCount);
      results.push({ segIndex: i, coords: [[startLng, startLat], [endLng, endLat]] });
    }
    setRouteCoords(results);
  }, []);

  useEffect(() => {
    if (activeTrip) {
      setRouteCoords([]);
      loadRoutes(activeTrip);
    }
  }, [activeTrip, loadRoutes]);

  // Fit map to the route once loaded
  useEffect(() => {
    if (!activeTrip || !routeCoords.length || !mapRef.current) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    routeCoords.forEach(({ coords }) =>
      coords.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      })
    );
    if (Number.isFinite(minLng)) {
      try {
        recenteringRef.current = true;
        mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 800 });
        window.setTimeout(() => { recenteringRef.current = false; }, 900);
        setMapNeedsRecenter(false);
      } catch {}
    }
  }, [routeCoords, activeTrip]);

  const onApproachSegmentEnd = useCallback((segIdx: number) => {
    if (!activeTrip) return;
    if (segIdx < activeTrip.segments.length - 1) {
      toast(t('approachingNext', language));
    }
  }, [activeTrip, language]);

  const { userPos, progress, remainingMinutes } = useTripTracking({
    enabled: !!activeTrip,
    segments: activeTrip?.segments ?? [],
    currentSegIdx,
    routeCoords,
    onApproachSegmentEnd,
  });

  const centerActiveMap = useCallback(() => {
    if (!mapRef.current) return;
    recenteringRef.current = true;
    if (userPos) {
      mapRef.current.flyTo({ center: [userPos.lng, userPos.lat], zoom: 15.5, duration: 500 });
    } else if (routeCoords.length) {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      routeCoords.forEach(({ coords }) => coords.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }));
      if (Number.isFinite(minLng)) {
        mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 500 });
      }
    }
    window.setTimeout(() => { recenteringRef.current = false; }, 650);
    setMapNeedsRecenter(false);
  }, [routeCoords, userPos]);

  useEffect(() => {
    if (!activeTrip || !userPos || mapNeedsRecenter || !mapRef.current) return;
    recenteringRef.current = true;
    mapRef.current.easeTo({ center: [userPos.lng, userPos.lat], duration: 450 });
    window.setTimeout(() => { recenteringRef.current = false; }, 550);
  }, [activeTrip, mapNeedsRecenter, userPos]);

  useEffect(() => {
    if (!activeTrip || !userPos || reroutingRef.current) return;
    const seg = activeTrip.segments[currentSegIdx];
    if (!isFlexibleConnector(seg)) return;
    const route = routeCoords.find((r) => r.segIndex === currentSegIdx);
    const nextSeg = activeTrip.segments[currentSegIdx + 1];
    const nextRoute = routeCoords.find((r) => r.segIndex === currentSegIdx + 1);
    const boardAnywhereTarget = isBoardAnywhereTransit(nextSeg) && nextRoute?.coords?.length
      ? closestPointOnRoute(userPos, nextRoute.coords)
      : null;
    const end = boardAnywhereTarget ?? route?.coords?.[route.coords.length - 1];
    if (!route || !end || route.coords.length < 2) return;
    if (distanceToRouteMeters(userPos, route.coords) < 90) return;
    reroutingRef.current = true;
    const mode = seg.icon === 'walk' ? 'walking' : 'driving';
    fetchConnectorRoute(mode, userPos, end)
      .then((coords) => {
        setRouteCoords((prev) => prev.map((r) => r.segIndex === currentSegIdx ? { ...r, coords } : r));
        setActiveTrip((prev) => {
          if (!prev) return prev;
          const segments = prev.segments.map((s, idx) => idx === currentSegIdx ? { ...s, route_geometry: coords } : s);
          const updated = { ...prev, segments };
          sessionStorage.setItem('activeTrip', JSON.stringify(updated));
          return updated;
        });
        toast.info(t('reroutingConnector', language));
      })
      .finally(() => {
        window.setTimeout(() => { reroutingRef.current = false; }, 5000);
      });
  }, [activeTrip, currentSegIdx, language, routeCoords, userPos]);

  const clearTrip = () => {
    sessionStorage.removeItem('activeTrip');
    sessionStorage.removeItem('tripPlan');
    setActiveTrip(null);
    setCurrentSegIdx(0);
    setExpanded(false);
    setRouteCoords([]);
  };

  const stopContributionRecording = useCallback(() => {
    if (contributionWatchRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(contributionWatchRef.current);
      contributionWatchRef.current = null;
    }
    setIsContributingRoute(false);
  }, []);

  const clearContributionFlow = useCallback(() => {
    stopContributionRecording();
    setContributionTrace([]);
    setShowDiscoveryRecorder(false);
    setContributionDialogOpen(false);
    setContributionOperator('microbus');
  }, [stopContributionRecording]);

  const startContributionRecording = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error(t('gpsUnavailable', language));
      return;
    }
    setContributionTrace([]);
    setIsContributingRoute(true);
    contributionWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setContributionTrace((prev) => [...prev, point]);
      },
      () => toast.error(t('gpsUnavailable', language)),
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }, [language]);

  useEffect(() => () => stopContributionRecording(), [stopContributionRecording]);

  const handleNext = () => {
    if (!activeTrip) return;
    setCurrentSegIdx((i) => Math.min(i + 1, activeTrip.segments.length - 1));
  };
  const handleBack = () => setCurrentSegIdx((i) => Math.max(i - 1, 0));

  const openSegmentReview = () => {
    if (!activeTrip) return;
    const seg = activeTrip.segments[currentSegIdx];
    setReviewSeg({ transport_type_id: seg.transport_type_id, transport_name: seg.transport_name });
    setReviewOpen(true);
  };

  const handleDone = () => {
    if (!activeTrip) return;
    const seg = activeTrip.segments[currentSegIdx];
    // #6 — after finishing a bus leg, ask which bus number + operator was used.
    if (seg.icon === 'bus') {
      setBusUsedName(seg.transport_name);
      setBusUsedFrom(seg.start_name);
      setBusUsedTo(seg.end_name);
      setBusUsedOpen(true);
      return;
    }
    openSegmentReview();
  };

  // #7 — when a destination is chosen, detect intercity travel and offer the
  // Serfis-vs-Intercity choice (or route straight to the intercity page).
  const handleDestinationSelect = async (suggestion: { place_name: string; center: [number, number] }) => {
    const destName = suggestion.place_name;
    const destLat = suggestion.center[1];
    const destLng = suggestion.center[0];
    const sLat = userLocation?.lat || CAIRO_CENTER.latitude;
    const sLng = userLocation?.lng || CAIRO_CENTER.longitude;

    const planUrl = (forceCity = false) =>
      `/plan?destination=${encodeURIComponent(destName)}&destLat=${destLat}&destLng=${destLng}&lat=${sLat}&lng=${sLng}${forceCity ? '&mode=city' : ''}`;

    try {
      const check = await api.get<{
        isIntercity: boolean;
        hasSerfis: boolean;
        fromCity: { id: string; nameEn: string; nameAr: string } | null;
        toCity: { id: string; nameEn: string; nameAr: string } | null;
      }>(
        `/trips/plan/intercity-check?startLat=${sLat}&startLng=${sLng}&endLat=${destLat}&endLng=${destLng}`,
      );
      if (check?.isIntercity && check.fromCity && check.toCity) {
        const fromCity = check.fromCity;
        const toCity = check.toCity;
        const fromName = language === 'ar' ? fromCity.nameAr : fromCity.nameEn;
        const toName = language === 'ar' ? toCity.nameAr : toCity.nameEn;
        const intercityUrl = `/intercity?from=${encodeURIComponent(fromCity.nameEn)}&to=${encodeURIComponent(toCity.nameEn)}`;
        const travelParams = `from=${encodeURIComponent(fromCity.nameEn)}&to=${encodeURIComponent(toCity.nameEn)}&fromLabel=${encodeURIComponent(fromName)}&toLabel=${encodeURIComponent(toName)}`;
        const hasFlight = hasDomesticFlightOption(fromCity.id, toCity.id);
        const hasNile = NILE_CITY_IDS.has(fromCity.id) && NILE_CITY_IDS.has(toCity.id);
        setPendingTrip({
          planUrl: planUrl(true),
          intercityUrl,
          trainUrl: `/travel/train?${travelParams}`,
          flightUrl: `/travel/flight?${travelParams}`,
          taxiUrl: `/travel/taxi?${travelParams}`,
          nileUrl: `/travel/nile?${travelParams}`,
          fromName,
          toName,
          hasSerfis: check.hasSerfis,
          hasFlight,
          hasNile,
        });
        setChoiceOpen(true);
        return;
      }
    } catch (err) {
      console.error('intercity-check failed, falling back to city planning', err);
    }
    navigate(planUrl());
  };

  // Tap anywhere on the map to choose a destination. Drops a pin, reverse-geocodes
  // the chosen point into an address, and shows a confirmation card.
  const handleMapClick = useCallback(async (evt: { lngLat: { lng: number; lat: number } }) => {
    if (activeTrip || choiceOpen) return; // don't hijack taps while a trip guide or blocking dialog is open
    const { lat, lng } = evt.lngLat;
    setPickedDest({ lat, lng, name: '', loading: true });
    const name = await reverseGeocode(lat, lng, language);
    setPickedDest((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...prev, name, loading: false } : prev));
  }, [activeTrip, choiceOpen, language]);

  // Confirm the tapped destination — runs the exact same flow as a search selection.
  const confirmPickedDest = () => {
    if (!pickedDest) return;
    const name = pickedDest.name || `${pickedDest.lat.toFixed(4)}, ${pickedDest.lng.toFixed(4)}`;
    const dest = { place_name: name, center: [pickedDest.lng, pickedDest.lat] as [number, number] };
    setPickedDest(null);
    void handleDestinationSelect(dest);
  };

  const handleSegmentReviewDone = () => {
    if (!activeTrip) return;
    if (currentSegIdx >= activeTrip.segments.length - 1) {
      setTripReviewOpen(true);
    } else {
      setCurrentSegIdx((i) => i + 1);
    }
  };

  const handleSwap = (segIdx: number, alt: GuideAlternative) => {
    if (!activeTrip) return;
    const newSegments = [...activeTrip.segments];
    const old = newSegments[segIdx];
    newSegments[segIdx] = {
      ...old, transport_type_id: alt.transport_type_id, transport_name: alt.transport_name,
      cost_egp: alt.cost_egp, duration_minutes: alt.duration_minutes, color: alt.color,
      icon: alt.icon, line_id: alt.line_id ?? null, line_number: alt.line_number || '',
      info: alt.info ?? old.info, instructions: alt.instructions ?? old.instructions,
      route_geometry: alt.route_geometry && alt.route_geometry.length >= 2 ? alt.route_geometry : old.route_geometry,
    };
    const newTotal = newSegments.reduce((s, sg) => s + sg.cost_egp, 0);
    const newTime = newSegments.reduce((s, sg) => s + sg.duration_minutes, 0);
    const updated = { ...activeTrip, segments: newSegments, total_cost_egp: newTotal, total_duration_minutes: newTime };
    setActiveTrip(updated);
    setRouteCoords((prev) => prev.map((r) => r.segIndex === segIdx && alt.route_geometry?.length ? { ...r, coords: alt.route_geometry! } : r));
    sessionStorage.setItem('activeTrip', JSON.stringify(updated));
    toast.success(t('planUpdated', language));
  };

  const routeGeoJSON = {
    type: 'FeatureCollection' as const,
    features: routeCoords.map(({ segIndex, coords }) => ({
      type: 'Feature' as const,
      properties: {
        color: activeTrip?.segments[segIndex]?.color || '#3B82F6',
        name: activeTrip?.segments[segIndex]?.line_number || activeTrip?.segments[segIndex]?.transport_name || '',
      },
      geometry: { type: 'LineString' as const, coordinates: coords },
    })),
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden">
        <Map
          ref={mapRef}
          {...viewState}
          onMove={(evt) => {
            setViewState(evt.viewState);
            if (activeTrip && !recenteringRef.current) setMapNeedsRecenter(true);
          }}
          onClick={(evt) => { void handleMapClick(evt); }}
          onError={(e) => { const err = (e as { error?: Error })?.error; console.error('[home-map] error:', err?.message || e, err?.stack); }}
          cursor={activeTrip ? undefined : 'crosshair'}
          mapStyle={mapStyle}
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
        >
          {activeTrip && routeCoords.length > 0 && (
            <RouteLayers id="home-route" data={routeGeoJSON} />
          )}
          {!activeTrip && contributionTrace.length > 1 && (
            <RouteLayers
              id="contribution-route"
              data={{
                type: 'FeatureCollection',
                features: [{
                  type: 'Feature',
                  properties: { color: '#258DFF', name: 'Contribution route' },
                  geometry: { type: 'LineString', coordinates: contributionTrace },
                }],
              }}
            />
          )}

          {activeTrip && (
            <>
              <Marker latitude={activeTrip.startLat} longitude={activeTrip.startLng}>
                <div className="h-4 w-4 rounded-full bg-primary border-2 border-white shadow" />
              </Marker>
              <Marker latitude={activeTrip.destLat} longitude={activeTrip.destLng}>
                <div className="h-4 w-4 rounded-full bg-destructive border-2 border-white shadow" />
              </Marker>
            </>
          )}

          {!activeTrip && pickedDest && (
            <Marker latitude={pickedDest.lat} longitude={pickedDest.lng} anchor="bottom">
              <MapPin className="h-8 w-8 text-destructive drop-shadow-lg" fill="currentColor" strokeWidth={1.5} />
            </Marker>
          )}

          {(userPos || userLocation) && (
            <Marker latitude={(userPos ?? userLocation)!.lat} longitude={(userPos ?? userLocation)!.lng}>
              <div className="relative">
                <div className="h-4 w-4 rounded-full bg-blue-500 border-2 border-white shadow-lg" />
                <div className="absolute inset-0 h-4 w-4 rounded-full bg-blue-500 animate-ping opacity-30" />
              </div>
            </Marker>
          )}
        </Map>

      {activeTrip && mapNeedsRecenter && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-44 right-4 z-30 h-12 w-12 rounded-full shadow-2xl border border-white/25"
          aria-label={t('centerMap', language)}
          onClick={centerActiveMap}
        >
          <LocateFixed className="h-5 w-5" />
        </Button>
      )}

      {/* Search bar overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 safe-area-top z-20">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-2">
          <LocationAutocomplete
            value={searchQuery}
            onChange={setSearchQuery}
            onSelect={(suggestion) => {
              void handleDestinationSelect(suggestion);
            }}
            placeholder={t('searchDestination', language)}
            className="flex-1"
            language={language}
            readOnlyDisplay={activeTrip?.destination || undefined}
            trailingAction={activeTrip ? 'cancelTrip' : searchQuery ? 'clear' : undefined}
            trailingLabel={t('cancel', language)}
            onTrailingAction={() => {
              if (activeTrip) setCancelTripOpen(true);
              else setSearchQuery('');
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-14 w-14 rounded-full shadow-xl border border-white/20 shrink-0 glass-panel"
            onClick={() => navigate('/profile')}
          >
            <User className="h-5 w-5" />
          </Button>
        </motion.div>
      </div>

      {/* Active trip guide sheet OR location info */}
      {activeTrip ? (
        <TripGuideSheet
          plan={activeTrip}
          currentSegIdx={currentSegIdx}
          progress={progress}
          remainingMinutes={remainingMinutes || activeTrip.total_duration_minutes}
          expanded={expanded}
          onToggleExpand={() => setExpanded((e) => !e)}
          onNext={handleNext}
          onBack={handleBack}
          onDone={handleDone}
          onSwap={handleSwap}
          onReport={() => setReportOpen(true)}
          language={language}
        />
      ) : (
        <div className="absolute bottom-6 left-4 right-4">
          <AnimatePresence mode="wait">
            {pickedDest ? (
              <motion.div
                key="picked"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="rounded-[2rem] shadow-2xl border border-white/20 p-4 space-y-3 glass-panel"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                    <MapPin className="h-5 w-5 text-destructive" />
                  </div>
                  <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{t('chosenDestination', language)}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {pickedDest.loading
                        ? t('locating', language)
                        : pickedDest.name || `${pickedDest.lat.toFixed(4)}, ${pickedDest.lng.toFixed(4)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="flex-1 rounded-[2rem]" onClick={() => setPickedDest(null)}>
                    {t('cancel', language)}
                  </Button>
                  <Button className="flex-1 rounded-[2rem]" onClick={confirmPickedDest} disabled={pickedDest.loading}>
                    {t('planTripHere', language)}
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="location"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-2"
              >
                {userLocation && !showDiscoveryRecorder && (
                  <div className="rounded-[2rem] shadow-2xl border border-white/20 p-4 flex items-center gap-3 glass-panel">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Navigation className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{t('myLocation', language)}</p>
                      <p className="text-xs text-muted-foreground truncate">{locationName || `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`}</p>
                    </div>
                  </div>
                )}
                {showDiscoveryRecorder && (
                  <div className="mx-auto w-[calc(100%-3rem)] max-w-md min-w-[16rem] space-y-2">
                    {!isContributingRoute && contributionTrace.length < 2 ? (
                      <Button
                        className="w-full h-16 rounded-[2rem] gap-2 text-base"
                        onClick={startContributionRecording}
                      >
                        <Navigation className="h-5 w-5" />
                        {t('recordGps', language)}
                      </Button>
                    ) : isContributingRoute ? (
                      <Button
                        variant="destructive"
                        className="w-full h-16 rounded-[2rem] gap-2 text-base"
                        onClick={stopContributionRecording}
                      >
                        <Square className="h-5 w-5" />
                        {t('stopRecording', language)}
                      </Button>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="h-12 rounded-[2rem] gap-2 bg-card/80"
                          onClick={clearContributionFlow}
                        >
                          <X className="h-4 w-4" />
                          {t('cancel', language)}
                        </Button>
                        <Button
                          className="h-12 rounded-[2rem] gap-2"
                          onClick={() => setContributionDialogOpen(true)}
                        >
                          {t('save', language)}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {showDiscoveryRecorder && contributionTrace.length > 0 && (
                  <p className="text-center text-xs text-muted-foreground/90 bg-card/70 backdrop-blur-xl rounded-[2rem] py-1.5 px-3 block mx-auto w-[calc(100%-3rem)] max-w-md min-w-[16rem] border border-white/10">
                    {contributionTrace.length} {t('gpsPointsCaptured', language)}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Per-segment review */}
      <SegmentReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onSubmitted={handleSegmentReviewDone}
        segment={reviewSeg}
        language={language}
      />

      {/* End-of-trip review */}
      <SegmentReviewDialog
        open={tripReviewOpen}
        onClose={() => setTripReviewOpen(false)}
        onSubmitted={() => { setTripReviewOpen(false); clearTrip(); toast.success(t('tripComplete', language)); }}
        segment={null}
        tripLevel
        language={language}
      />

      {/* Report a problem */}
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        transportTypeId={activeTrip?.segments[currentSegIdx]?.transport_type_id}
        transitLineId={activeTrip?.segments[currentSegIdx]?.line_id || undefined}
        segments={activeTrip?.segments.map((seg, index) => ({
          index,
          label: `${index + 1}. ${seg.transport_name} (${seg.start_name} → ${seg.end_name})`,
          transportTypeId: seg.transport_type_id,
          transitLineId: seg.line_id,
        }))}
        language={language}
      />

      <ContributeTransportDialog
        open={contributionDialogOpen}
        onClose={() => setContributionDialogOpen(false)}
        onSubmitted={clearContributionFlow}
        initialTrace={contributionTrace}
        initialOperator={contributionOperator}
        language={language}
      />

      {/* #6 — which bus did you take? */}
      <BusUsedDialog
        open={busUsedOpen}
        onClose={() => setBusUsedOpen(false)}
        onDone={openSegmentReview}
        transportName={busUsedName}
        fromArea={busUsedFrom}
        toArea={busUsedTo}
        language={language}
      />

      {/* #7 — Serfis vs Intercity choice */}
      <IntercityChoiceDialog
        open={choiceOpen}
        onClose={() => setChoiceOpen(false)}
        onChoose={(choice) => {
          setChoiceOpen(false);
          if (!pendingTrip) return;
          const urls = {
            serfis: pendingTrip.planUrl,
            intercity: pendingTrip.intercityUrl,
            train: pendingTrip.trainUrl,
            flight: pendingTrip.flightUrl,
            taxi: pendingTrip.taxiUrl,
            nile: pendingTrip.nileUrl,
          };
          navigate(urls[choice]);
        }}
        fromName={pendingTrip?.fromName}
        toName={pendingTrip?.toName}
        showSerfis={pendingTrip?.hasSerfis}
        showFlight={pendingTrip?.hasFlight}
        showNile={pendingTrip?.hasNile}
        language={language}
      />

      <AlertDialog open={cancelTripOpen} onOpenChange={setCancelTripOpen}>
        <AlertDialogContent className="glass-panel rounded-[2rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelTripTitle', language)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cancelTripDescription', language)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepTrip', language)}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { clearTrip(); setCancelTripOpen(false); }}
            >
              {t('cancelTrip', language)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default Index;
