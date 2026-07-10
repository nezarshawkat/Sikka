import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { User, MapPin, Navigation, Square, X, Focus, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Map, { Marker, type MapRef } from 'react-map-gl/maplibre';
import RouteLayers from '@/components/RouteLayers';
import 'maplibre-gl/dist/maplibre-gl.css';
import LocationAutocomplete from '@/components/LocationAutocomplete';
import { useMapStyle } from '@/hooks/useMapStyle';
import { useTripTracking } from '@/hooks/useTripTracking';
import { useTripNotification } from '@/hooks/useTripNotification';
import TripGuideSheet, { type GuidePlan, type GuideSegment, type GuideAlternative } from '@/components/trip/TripGuideSheet';
import SegmentReviewDialog, { type ReviewSegment } from '@/components/trip/SegmentReviewDialog';
import BusUsedDialog from '@/components/trip/BusUsedDialog';
import MicrobusUsedDialog from '@/components/trip/MicrobusUsedDialog';
import IntercityChoiceDialog from '@/components/trip/IntercityChoiceDialog';
import ReportDialog from '@/components/ReportDialog';
import ContributeTransportDialog from '@/components/ContributeTransportDialog';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { nativeLocationIsEnabled, openNativeAppSettings, openNativeLocationSettings } from '@/lib/nativeLocationSettings';
import {
  acknowledgeNativeDiscoveryTrip,
  getPendingNativeDiscoveryTrips,
  startNativeDiscovery,
  type NativeDiscoveryTrip,
} from '@/lib/nativeDiscovery';
import { onTripPipChange, setTripPipEnabled } from '@/lib/nativeMapUi';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  saveOfflineTrip,
  getOfflineTrip,
  clearOfflineTrip,
  saveOfflineData,
  setupOfflineListeners,
  isOnline,
} from '@/lib/offline';

const CAIRO_CENTER = { latitude: 30.0444, longitude: 31.2357 };
const FLIGHT_CITY_IDS = new Set(['cairo', 'alexandria', 'luxor', 'aswan', 'hurghada', 'sharm']);
const NILE_CITY_IDS = new Set(['cairo', 'giza', 'luxor', 'aswan']);
const PENDING_FEEDBACK_KEY = 'sikkaPendingTripFeedback';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ';
const langForGeocoding = (language: string) => language === 'zh' ? 'zh-CN' : language;

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
  segments: (GuideSegment & { route_geometry?: [number, number][] | null; line_id?: string | null; line_number?: string | null })[];
  startLat: number; startLng: number; destLat: number; destLng: number;
  destination: string;
}

const isBusOrMicrobusSegment = (seg?: Pick<GuideSegment, 'icon' | 'transport_name'>) =>
  !!seg && (seg.icon === 'bus' || /bus|microbus|Ù…ÙŠÙƒØ±ÙˆØ¨Ø§Øµ|Ø£ØªÙˆØ¨ÙŠØ³|Ø§ØªÙˆØ¨ÙŠØ³/i.test(seg.transport_name || ''));

const Index = () => {
  const { user, isLoading, language } = useAuth();
  const navigate = useNavigate();
  const { style: mapStyle, mode: mapMode } = useMapStyle();
  const mapRef = useRef<MapRef | null>(null);
  // zoom 15 (rather than 14) is where OpenFreeMap's "liberty" style starts
  // showing POI labels (landmarks, mosques, hospitals) instead of just roads.
  const [viewState, setViewState] = useState({ ...CAIRO_CENTER, zoom: 15 });
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState('');
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [enablingLocation, setEnablingLocation] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Destination chosen by tapping the map or searching (reverse-geocoded address shown for confirmation)
  const [pickedDest, setPickedDest] = useState<{ lat: number; lng: number; name: string; loading: boolean } | null>(null);

  const [activeTrip, setActiveTrip] = useState<ActiveTripPlan | null>(null);
  const [currentSegIdx, setCurrentSegIdx] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [routeCoords, setRouteCoords] = useState<{ segIndex: number; coords: [number, number][] }[]>([]);
  const [guideSheetHeight, setGuideSheetHeight] = useState(190);
  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [pipMapOnly, setPipMapOnly] = useState(false);
  const [getOffPrompt, setGetOffPrompt] = useState<{ segIdx: number; reason: 'passed' | 'walking' } | null>(null);
  const dismissedGetOffPromptsRef = useRef<Record<string, boolean>>({});
  const [contributionTrace, setContributionTrace] = useState<[number, number][]>([]);
  const [contributionTimestamps, setContributionTimestamps] = useState<number[]>([]);
  const [isContributingRoute, setIsContributingRoute] = useState(false);
  const [showDiscoveryRecorder, setShowDiscoveryRecorder] = useState(false);
  const [contributionDialogOpen, setContributionDialogOpen] = useState(false);
  const [contributionOperator, setContributionOperator] = useState<'microbus' | 'bus'>('microbus');
  const contributionWatchRef = useRef<number | null>(null);
  const [pendingNativeDiscovery, setPendingNativeDiscovery] = useState<NativeDiscoveryTrip | null>(null);
  const [pendingNativeFromArea, setPendingNativeFromArea] = useState('');
  const [pendingNativeToArea, setPendingNativeToArea] = useState('');

  const [reviewSeg, setReviewSeg] = useState<ReviewSegment | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [tripReviewOpen, setTripReviewOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [cancelTripOpen, setCancelTripOpen] = useState(false);

  // Bus info dialog (NTA/CTA operator + bus number)
  const [busUsedOpen, setBusUsedOpen] = useState(false);
  const [busUsedName, setBusUsedName] = useState<string | undefined>(undefined);
  const [busUsedFrom, setBusUsedFrom] = useState<string | undefined>(undefined);
  const [busUsedTo, setBusUsedTo] = useState<string | undefined>(undefined);

  // Microbus info dialog
  const [microbusUsedOpen, setMicrobusUsedOpen] = useState(false);
  const [microbusUsedName, setMicrobusUsedName] = useState<string | undefined>(undefined);
  const [microbusUsedFrom, setMicrobusUsedFrom] = useState<string | undefined>(undefined);
  const [microbusUsedTo, setMicrobusUsedTo] = useState<string | undefined>(undefined);

  // Intercity vs serfis choice
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [pendingTrip, setPendingTrip] = useState<{
    planUrl: string; intercityUrl: string; trainUrl: string;
    flightUrl: string; taxiUrl: string; nileUrl: string;
    fromName: string; toName: string; hasSerfis: boolean; hasFlight: boolean; hasNile: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      if (!sessionStorage.getItem('splashShown')) navigate('/splash');
      else navigate('/auth');
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
          const pending = sessionStorage.getItem(PENDING_FEEDBACK_KEY);
          const pendingIndex = pending ? Number(JSON.parse(pending).segmentIndex) : 0;
          setCurrentSegIdx(Number.isFinite(pendingIndex) ? pendingIndex : 0);
          saveOfflineTrip(plan);
        }
      } catch {}
    } else {
      const offlineTrip = getOfflineTrip();
      if (offlineTrip?.segments?.length) setActiveTrip(offlineTrip);
    }
  }, []);

  const loadPendingNativeDiscovery = useCallback(async () => {
    if (activeTrip || contributionDialogOpen) return;
    const trips = await getPendingNativeDiscoveryTrips();
    if (!trips.length) return;
    const trip = trips[0];
    setPendingNativeDiscovery(trip);
    const first = trip.trace[0];
    const last = trip.trace[trip.trace.length - 1];
    void Promise.all([
      reverseGeocode(first[1], first[0], language),
      reverseGeocode(last[1], last[0], language),
    ]).then(([from, to]) => {
      setPendingNativeFromArea(from);
      setPendingNativeToArea(to);
    });
    // Neutral initial choice only: the rider can switch to bus or microbus in
    // the classification dialog before the trace is submitted.
    setContributionOperator('microbus');
    setContributionDialogOpen(true);
  }, [activeTrip, contributionDialogOpen, language]);

  useEffect(() => {
    void loadPendingNativeDiscovery();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadPendingNativeDiscovery();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [loadPendingNativeDiscovery]);

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
    if (!navigator.geolocation) return;

    // Resolve a real position before showing any warning. The previous
    // permission pre-check made the card flash while an enabled GPS was still
    // acquiring its first fix.
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setShowLocationPrompt(false);
        setViewState((v) => ({ ...v, latitude: loc.lat, longitude: loc.lng }));
        const name = await reverseGeocode(loc.lat, loc.lng, language);
        setLocationName(name);
        void startNativeDiscovery();
      },
      () => {
        setUserLocation(null);
        setLocationName('');
        setShowLocationPrompt(true);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [language]);

  const pollRef = useRef<number | null>(null);
  const attemptInFlightRef = useRef(false);

  const stopEnablingPoll = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setEnablingLocation(false);
  }, []);

  const attemptGetPosition = useCallback(() => {
    if (attemptInFlightRef.current) return;
    attemptInFlightRef.current = true;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        attemptInFlightRef.current = false;
        stopEnablingPoll();
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        setShowLocationPrompt(false);
        setViewState((v) => ({ ...v, latitude: loc.lat, longitude: loc.lng, zoom: 15 }));
        const name = await reverseGeocode(loc.lat, loc.lng, language);
        setLocationName(name);
        void startNativeDiscovery();
      },
      async (error) => {
        attemptInFlightRef.current = false;
        // Only reach for the settings dialog here if we haven't already
        // fired it below — this branch mainly now handles permission-denied,
        // since the "services are off" case is short-circuited up front.
        if (error.code === error.PERMISSION_DENIED) {
          stopEnablingPoll();
          const opened = await openNativeAppSettings();
          if (!opened) toast.error(t('locationStillOff', language));
        }
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }, [language, stopEnablingPoll]);

  const requestLocation = useCallback(async () => {
    if (!navigator.geolocation) return;
    setEnablingLocation(true);

    // Check the fast, local OS flag first instead of only finding out
    // location services are off after a slow getCurrentPosition() timeout —
    // that up-front wait was most of what made this feel slow to open.
    const enabled = await nativeLocationIsEnabled();
    if (enabled === false) {
      const opened = await openNativeLocationSettings();
      if (!opened) {
        stopEnablingPoll();
        toast.error(t('locationStillOff', language));
        return;
      }
    } else {
      attemptGetPosition();
    }

    // Keep checking in the background until location actually turns on, so
    // there's no need to back out of the system dialog and reopen Sikka —
    // this fires on its own the moment it's enabled. Capped at 2 minutes so
    // an abandoned attempt doesn't poll forever; tapping "Enable" again
    // restarts it.
    if (pollRef.current == null) {
      let ticks = 0;
      pollRef.current = window.setInterval(async () => {
        ticks += 1;
        if (ticks > 80) {
          stopEnablingPoll();
          return;
        }
        const nowEnabled = await nativeLocationIsEnabled();
        if (nowEnabled) attemptGetPosition();
      }, 1500);
    }
  }, [attemptGetPosition, language, stopEnablingPoll]);

  useEffect(() => stopEnablingPoll, [stopEnablingPoll]);

  useEffect(() => {
    const retryAfterSystemDialog = async () => {
      if (!showLocationPrompt) return;
      const enabled = await nativeLocationIsEnabled();
      if (enabled) attemptGetPosition();
    };
    window.addEventListener('focus', retryAfterSystemDialog);
    return () => window.removeEventListener('focus', retryAfterSystemDialog);
  }, [attemptGetPosition, showLocationPrompt]);

  const loadRoutes = useCallback((plan: ActiveTripPlan) => {
    const results: { segIndex: number; coords: [number, number][] }[] = [];
    for (let i = 0; i < plan.segments.length; i++) {
      const seg = plan.segments[i];
      if (seg.route_geometry && seg.route_geometry.length >= 2) {
        results.push({ segIndex: i, coords: seg.route_geometry });
      }
    }
    setRouteCoords(results);
  }, []);

  useEffect(() => {
    if (activeTrip) { setRouteCoords([]); loadRoutes(activeTrip); }
  }, [activeTrip, loadRoutes]);

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
      try { mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 800 }); } catch {}
    }
  }, [routeCoords, activeTrip]);

  useEffect(() => {
    setupOfflineListeners(
      () => toast(t('backOnline', language) || 'Back online'),
      () => toast(t('noInternet', language) || 'You are offline'),
    );
    if (activeTrip) saveOfflineTrip(activeTrip);
  }, [activeTrip, language]);

  /**
   * Detects whether a segment is a bus or microbus ride and, if so, opens the
   * matching confirmation dialog (persisting a pending-feedback marker so it
   * survives a refresh). Returns true if it handled the segment as bus/microbus,
   * false if the caller should fall back to the generic segment review.
   */
  const openBusOrMicrobusUsedIfApplicable = (segIdx: number): boolean => {
    if (!activeTrip) return false;
    const seg = activeTrip.segments[segIdx];
    if (!seg) return false;
    // Microbus and CTA/NTA buses share the same "bus" icon in the data, so the transport
    // name (e.g. "Microbus" / "ميكروباص") is the only reliable way to tell them apart.
    const isMicrobus = /microbus|ميكروباص/i.test(seg.transport_name || '');
    const isBus = seg.icon === 'bus' && !isMicrobus;

    if (isMicrobus) {
      sessionStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify({ type: 'microbus', segmentIndex: segIdx }));
      setMicrobusUsedName(seg.transport_name);
      setMicrobusUsedFrom(seg.start_name);
      setMicrobusUsedTo(seg.end_name);
      setMicrobusUsedOpen(true);
      return true;
    }
    if (isBus) {
      sessionStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify({ type: 'bus', segmentIndex: segIdx }));
      setBusUsedName(seg.transport_name);
      setBusUsedFrom(seg.start_name);
      setBusUsedTo(seg.end_name);
      setBusUsedOpen(true);
      return true;
    }
    return false;
  };

  const openSegmentReview = (segmentIndex = currentSegIdx) => {
    if (!activeTrip) return;
    const seg = activeTrip.segments[segmentIndex];
    if (!seg) return;
    setReviewSeg({
      transport_type_id: seg.transport_type_id,
      transport_name: seg.transport_name,
      line_id: seg.line_id ?? null,
      line_number: seg.line_number ?? null,
    });
    setReviewOpen(true);
  };

  const completeSegment = (segmentIndex = currentSegIdx) => {
    if (!activeTrip) return;
    setCurrentSegIdx(segmentIndex);
    setGetOffPrompt(null);
    if (openBusOrMicrobusUsedIfApplicable(segmentIndex)) return;
    openSegmentReview(segmentIndex);
  };

  const onApproachSegmentEnd = useCallback((segIdx: number) => {
    if (!activeTrip) return;
    if (segIdx < activeTrip.segments.length - 1) toast(t('approachingNext', language));

    // Auto-arrival: for bus/microbus specifically, GPS proximity to the segment's
    // end is treated as "arrived" and the confirmation popup opens on its own —
    // no need to wait for the rider to tap "I arrived" manually. Other modes
    // (metro/train/walk/taxi/monorail) are untouched and still use the manual
    // "I arrived" button, since a premature auto-advance is riskier on multi-stop
    // rides where GPS proximity to the final stop isn't necessarily "get off now".
    if (reviewOpen || busUsedOpen || microbusUsedOpen || tripReviewOpen) return;
    const seg = activeTrip.segments[segIdx];
    if (isBusOrMicrobusSegment(seg)) return;
    completeSegment(segIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip, language, reviewOpen, busUsedOpen, microbusUsedOpen, tripReviewOpen]);

  const {
    userPos,
    progress,
    remainingMinutes,
    isOffRoute,
    speedKmh,
    segmentEndReached,
    passedSegmentEnd,
  } = useTripTracking({
    enabled: !!activeTrip,
    segments: activeTrip?.segments ?? [],
    currentSegIdx,
    routeCoords,
    onApproachSegmentEnd,
    onOffRouteChange: (offRoute) => {
      if (offRoute) toast.error(t('offRouteWarning', language));
    },
  });

  // Persistent OS-level notification while trip is active
  const currentSeg = activeTrip?.segments[currentSegIdx];
  // Short, already-localized mode word for the notification badge — reuses
  // the same bilingual mode-name strings already in i18n.ts and the same
  // microbus-vs-bus detection used elsewhere for the used-transport dialogs.
  const modeLabelFor = (seg?: typeof currentSeg): string => {
    if (!seg) return t('bus', language);
    if (/microbus|ميكروباص/i.test(seg.transport_name || '')) return t('microbus', language);
    switch (seg.icon) {
      case 'metro': return t('metro', language);
      case 'monorail': return t('monorail', language);
      case 'train': return t('train', language);
      case 'car': return t('taxi', language);
      case 'bike': return t('tuktuk', language);
      case 'bus': return t('bus', language);
      default: return seg.transport_name || t('bus', language);
    }
  };

  useTripNotification({
    active: !!activeTrip,
    from: currentSeg?.start_name ?? '',
    to: currentSeg?.end_name ?? '',
    transportName: currentSeg?.transport_name ?? '',
    transportColor: currentSeg?.color ?? '#3B82F6',
    transportCode: currentSeg?.line_number || undefined,
    modeLabel: modeLabelFor(currentSeg),
    language,
    progress,
  });

  useEffect(() => {
    return onTripPipChange((active) => {
      setPipMapOnly(active);
      if (active) {
        setExpanded(false);
        setIsFollowingUser(true);
      }
    });
  }, []);

  useEffect(() => {
    void setTripPipEnabled(!!activeTrip);
    if (!activeTrip) setPipMapOnly(false);
    return () => { void setTripPipEnabled(false); };
  }, [activeTrip]);

  useEffect(() => {
    if (
      !activeTrip
      || !currentSeg
      || !isBusOrMicrobusSegment(currentSeg)
      || reviewOpen
      || busUsedOpen
      || microbusUsedOpen
      || tripReviewOpen
    ) {
      setGetOffPrompt(null);
      return;
    }

    const walkingAfterStop = segmentEndReached && speedKmh <= 7;
    const stayedOnAfterStop = passedSegmentEnd && speedKmh > 7;
    const reason = stayedOnAfterStop ? 'passed' : walkingAfterStop ? 'walking' : null;
    if (!reason) return;

    const key = `${currentSegIdx}:${reason}`;
    if (dismissedGetOffPromptsRef.current[key]) return;
    setGetOffPrompt({ segIdx: currentSegIdx, reason });
  }, [
    activeTrip,
    currentSeg,
    currentSegIdx,
    speedKmh,
    segmentEndReached,
    passedSegmentEnd,
    reviewOpen,
    busUsedOpen,
    microbusUsedOpen,
    tripReviewOpen,
  ]);


  const clearTrip = () => {
    sessionStorage.removeItem('activeTrip');
    sessionStorage.removeItem('tripPlan');
    sessionStorage.removeItem(PENDING_FEEDBACK_KEY);
    clearOfflineTrip();
    setActiveTrip(null);
    setCurrentSegIdx(0);
    setExpanded(false);
    setRouteCoords([]);
    setGetOffPrompt(null);
    setIsFollowingUser(false);
  };

  useEffect(() => {
    if (!activeTrip) setIsFollowingUser(false);
  }, [activeTrip]);

  useEffect(() => {
    if (!activeTrip || !userPos || !mapRef.current || !isFollowingUser) return;
    const bottomPadding = pipMapOnly ? 24 : Math.min(window.innerHeight * 0.68, guideSheetHeight + 96);
    const topPadding = pipMapOnly ? 24 : 96;
    try {
      mapRef.current.easeTo({
        center: [userPos.lng, userPos.lat],
        zoom: Math.max(15, viewState.zoom),
        padding: { top: topPadding, bottom: bottomPadding, left: 24, right: 24 },
        duration: 450,
      });
    } catch {
      setViewState((value) => ({ ...value, latitude: userPos.lat, longitude: userPos.lng, zoom: Math.max(15, value.zoom) }));
    }
  }, [activeTrip, userPos, isFollowingUser, guideSheetHeight, pipMapOnly, viewState.zoom]);

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
    setContributionTimestamps([]);
    setShowDiscoveryRecorder(false);
    setContributionDialogOpen(false);
    setContributionOperator('microbus');
  }, [stopContributionRecording]);

  const startContributionRecording = useCallback(() => {
    if (!navigator.geolocation) { toast.error(t('gpsUnavailable', language)); return; }
    setContributionTrace([]);
    setContributionTimestamps([]);
    setIsContributingRoute(true);
    contributionWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setContributionTrace((prev) => [...prev, point]);
        // Recorded in lockstep with contributionTrace (same index) so the
        // discovery pipeline can compute real travel speed from elapsed time.
        setContributionTimestamps((prev) => [...prev, pos.timestamp || Date.now()]);
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

  useEffect(() => {
    if (!activeTrip || reviewOpen || busUsedOpen || microbusUsedOpen || tripReviewOpen) return;
    const pending = sessionStorage.getItem(PENDING_FEEDBACK_KEY);
    if (!pending) return;
    try {
      const parsed = JSON.parse(pending) as { type?: string; segmentIndex?: number };
      const segmentIndex = Number(parsed.segmentIndex);
      const seg = activeTrip.segments[Number.isFinite(segmentIndex) ? segmentIndex : currentSegIdx];
      if (Number.isFinite(segmentIndex)) setCurrentSegIdx(segmentIndex);
      if (parsed.type === 'bus') {
        setBusUsedName(seg?.transport_name);
        setBusUsedFrom(seg?.start_name);
        setBusUsedTo(seg?.end_name);
        setBusUsedOpen(true);
      } else if (parsed.type === 'microbus') {
        setMicrobusUsedName(seg?.transport_name);
        setMicrobusUsedFrom(seg?.start_name);
        setMicrobusUsedTo(seg?.end_name);
        setMicrobusUsedOpen(true);
      } else if (parsed.type === 'segment') {
        openSegmentReview(Number.isFinite(segmentIndex) ? segmentIndex : currentSegIdx);
      } else if (parsed.type === 'trip') {
        setTripReviewOpen(true);
      }
    } catch {}
  }, [activeTrip, busUsedOpen, microbusUsedOpen, currentSegIdx, reviewOpen, tripReviewOpen]);

  const handleDone = () => {
    if (!activeTrip) return;
    completeSegment(currentSegIdx);
  };

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
        isIntercity: boolean; hasSerfis: boolean;
        fromCity: { id: string; nameEn: string; nameAr: string } | null;
        toCity: { id: string; nameEn: string; nameAr: string } | null;
      }>(`/trips/plan/intercity-check?startLat=${sLat}&startLng=${sLng}&endLat=${destLat}&endLng=${destLng}`);
      if (check?.isIntercity && check.fromCity && check.toCity) {
        const fromCity = check.fromCity;
        const toCity = check.toCity;
        const fromName = language === 'ar' ? fromCity.nameAr : fromCity.nameEn;
        const toName = language === 'ar' ? toCity.nameAr : toCity.nameEn;
        const intercityUrl = `/intercity?from=${encodeURIComponent(fromCity.nameEn)}&to=${encodeURIComponent(toCity.nameEn)}`;
        const travelParams = `from=${encodeURIComponent(fromCity.nameEn)}&to=${encodeURIComponent(toCity.nameEn)}&fromLabel=${encodeURIComponent(fromName)}&toLabel=${encodeURIComponent(toName)}`;
        const hasFlight = FLIGHT_CITY_IDS.has(fromCity.id) && FLIGHT_CITY_IDS.has(toCity.id);
        const hasNile = NILE_CITY_IDS.has(fromCity.id) && NILE_CITY_IDS.has(toCity.id);
        setPendingTrip({
          planUrl: planUrl(true), intercityUrl,
          trainUrl: `/trains/search?from=${encodeURIComponent(fromCity.nameEn)}&to=${encodeURIComponent(toCity.nameEn)}`,
          flightUrl: `/travel/flight?${travelParams}`,
          taxiUrl: `/travel/taxi?${travelParams}`,
          nileUrl: `/travel/nile?${travelParams}`,
          fromName, toName,
          hasSerfis: check.hasSerfis, hasFlight, hasNile,
        });
        setChoiceOpen(true);
        return;
      }
    } catch (err) {
      console.error('intercity-check failed, falling back to city planning', err);
    }
    navigate(planUrl());
  };

  // Tap anywhere on the map — show place popup (same as search result)
  const handleMapClick = useCallback(async (evt: { lngLat: { lng: number; lat: number } }) => {
    if (activeTrip || choiceOpen) return;
    const { lat, lng } = evt.lngLat;
    setPickedDest({ lat, lng, name: '', loading: true });
    setViewState((value) => ({ ...value, latitude: lat, longitude: lng, zoom: 15 }));
    // Fly to clicked location
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
    }
    const name = await reverseGeocode(lat, lng, language);
    setPickedDest((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...prev, name, loading: false } : prev));
  }, [activeTrip, choiceOpen, language]);

  // When search resolves — show the same place popup as a map tap, and fly to it
  const handleSearchResult = useCallback(async (suggestion: { place_name: string; center: [number, number] }) => {
    if (activeTrip) return; // readonly when trip active — handled by destination intercity check
    const lat = suggestion.center[1];
    const lng = suggestion.center[0];
    setViewState((value) => ({ ...value, latitude: lat, longitude: lng, zoom: 15 }));
    // Fly map to search result
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
    }
    setPickedDest({ lat, lng, name: suggestion.place_name, loading: false });
  }, [activeTrip]);

  const confirmPickedDest = () => {
    if (!pickedDest) return;
    const name = pickedDest.name || `${pickedDest.lat.toFixed(4)}, ${pickedDest.lng.toFixed(4)}`;
    const dest = { place_name: name, center: [pickedDest.lng, pickedDest.lat] as [number, number] };
    setPickedDest(null);
    setSearchQuery('');
    void handleDestinationSelect(dest);
  };

  const handleSegmentReviewDone = () => {
    if (!activeTrip) return;
    if (currentSegIdx >= activeTrip.segments.length - 1) {
      sessionStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify({ type: 'trip', segmentIndex: currentSegIdx }));
      setTripReviewOpen(true);
    } else {
      sessionStorage.removeItem(PENDING_FEEDBACK_KEY);
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

  const stopFollowingForManualMapMove = useCallback(() => {
    if (!pipMapOnly) setIsFollowingUser(false);
  }, [pipMapOnly]);

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
        onMove={(evt) => setViewState(evt.viewState)}
        onDragStart={stopFollowingForManualMapMove}
        onZoomStart={stopFollowingForManualMapMove}
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

      {/* Search bar stays visible across the trip experience so the rider can keep exploring or re-plan quickly. */}
      {!pipMapOnly && (
      <div className="absolute top-0 left-0 right-0 p-4 safe-area-top z-20">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-2">
            <LocationAutocomplete
              value={searchQuery}
              onChange={setSearchQuery}
              onSelect={(suggestion) => {
                if (activeTrip) {
                  void handleDestinationSelect(suggestion);
                } else {
                  void handleSearchResult(suggestion);
                }
              }}
              placeholder={t('searchDestination', language)}
              className="flex-1"
              language={language}
              readOnlyDisplay={activeTrip?.destination || undefined}
              trailingAction={activeTrip ? 'cancelTrip' : searchQuery ? 'clear' : undefined}
              trailingLabel={t('cancel', language)}
              onTrailingAction={() => {
                if (activeTrip) setCancelTripOpen(true);
                else { setSearchQuery(''); setPickedDest(null); }
              }}
            />
            {/* Profile button — only visible when not in minimized trip mode */}
            {!activeTrip && (
              <Button
                variant="outline"
                size="icon"
                className="h-14 w-14 rounded-full shadow-xl border border-white/20 shrink-0 glass-panel"
                onClick={() => navigate('/profile')}
              >
                <User className="h-5 w-5" />
              </Button>
            )}
        </motion.div>
        {activeTrip && getOffPrompt && currentSeg && (
          <motion.div
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            className="mt-2 rounded-[1.5rem] border border-primary/20 bg-background/85 backdrop-blur-xl shadow-xl p-3"
          >
            <div className="flex items-start gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Did you get off the {modeLabelFor(currentSeg)}?
                </p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {getOffPrompt.reason === 'passed'
                    ? 'It looks like you passed this leg destination while still moving faster than walking.'
                    : 'It looks like you reached this leg destination or slowed down to walking speed.'}
                </p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 rounded-full"
                onClick={() => {
                  dismissedGetOffPromptsRef.current[`${getOffPrompt.segIdx}:${getOffPrompt.reason}`] = true;
                  setGetOffPrompt(null);
                }}
              >
                {t('no', language)}
              </Button>
              <Button
                size="sm"
                className="flex-1 rounded-full"
                onClick={() => {
                  stopContributionRecording();
                  completeSegment(getOffPrompt.segIdx);
                }}
              >
                {t('yes', language)}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
      )}

      {/* "Turn on location" prompt — shown whenever location isn't granted yet,
          so trip planning can start from the rider's actual position instead
          of defaulting to the Cairo city center. Never shown during an active
          trip, to keep the minimized map clean. */}
      {!activeTrip && showLocationPrompt && (
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute top-[5.5rem] left-4 right-4 z-20 safe-area-top"
        >
          <div className="glass-panel rounded-[1.75rem] border border-primary/20 shadow-xl p-4 space-y-2 overflow-hidden">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {enablingLocation ? t('locationEnabling', language) : t('locationPromptTitle', language)}
                </p>
                {!enablingLocation && (
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{t('locationPromptBody', language)}</p>
                )}
              </div>
            </div>
            {enablingLocation ? (
              <div className="h-1 rounded-full location-enabling-bar mt-2" />
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 rounded-full"
                  onClick={() => { stopEnablingPoll(); setShowLocationPrompt(false); }}
                >
                  {t('locationPromptDismiss', language)}
                </Button>
                <Button size="sm" className="flex-1 rounded-full" onClick={requestLocation}>
                  {t('locationPromptEnable', language)}
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Active trip guide sheet */}
      {activeTrip && !pipMapOnly ? (
        <>
          {/* Focus button — only shown on the minimized map (above the trip popup), matching
              the "nothing but map + route" rule for the minimized view. Hidden once the
              sheet is expanded since the map is no longer the focus. */}
          {userPos && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ delay: 0.2 }}
              className="absolute right-4 z-20"
              style={{ bottom: `calc(${guideSheetHeight + 8}px + env(safe-area-inset-bottom, 0px))` }}
            >
              <Button
                variant="outline"
                size="icon"
                className="h-14 w-14 rounded-full shadow-xl border border-white/20 shrink-0 glass-panel !bg-background/55 hover:!bg-background/55 active:!bg-background/55 focus:!bg-background/55 focus-visible:!bg-background/55 !text-foreground hover:!text-foreground active:!text-foreground focus-visible:!text-foreground"
                onClick={() => {
                  setIsFollowingUser(true);
                  setViewState(v => ({ ...v, latitude: userPos.lat, longitude: userPos.lng, zoom: 15 }));
                }}
                title={t('focusOnLocation', language) || 'Focus on my location'}
              >
                <Focus className="h-5 w-5" />
              </Button>
            </motion.div>
          )}
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
            onHeightChange={setGuideSheetHeight}
            isOffRoute={isOffRoute}
          />
        </>
      ) : !pipMapOnly ? (
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
                  <Button variant="outline" className="flex-1 rounded-[2rem]" onClick={() => { setPickedDest(null); setSearchQuery(''); }}>
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
                      <Button className="w-full h-16 rounded-[2rem] gap-2 text-base" onClick={startContributionRecording}>
                        <Navigation className="h-5 w-5" />
                        {t('recordGps', language)}
                      </Button>
                    ) : isContributingRoute ? (
                      <Button variant="destructive" className="w-full h-16 rounded-[2rem] gap-2 text-base" onClick={stopContributionRecording}>
                        <Square className="h-5 w-5" />
                        {t('stopRecording', language)}
                      </Button>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" className="h-12 rounded-[2rem] gap-2 bg-card/80" onClick={clearContributionFlow}>
                          <X className="h-4 w-4" />
                          {t('cancel', language)}
                        </Button>
                        <Button className="h-12 rounded-[2rem] gap-2" onClick={() => setContributionDialogOpen(true)}>
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
      ) : null}

      {/* Per-segment review */}
      <SegmentReviewDialog
        open={!pipMapOnly && reviewOpen}
        onClose={() => setReviewOpen(false)}
        onSubmitted={handleSegmentReviewDone}
        segment={reviewSeg}
        language={language}
      />

      {/* End-of-trip review */}
      <SegmentReviewDialog
        open={!pipMapOnly && tripReviewOpen}
        onClose={() => setTripReviewOpen(false)}
        onSubmitted={() => { setTripReviewOpen(false); clearTrip(); toast.success(t('tripComplete', language)); }}
        segment={null}
        tripLevel
        language={language}
      />

      {/* Report a problem */}
      <ReportDialog
        open={!pipMapOnly && reportOpen}
        onClose={() => setReportOpen(false)}
        transportTypeId={activeTrip?.segments[currentSegIdx]?.transport_type_id}
        transitLineId={activeTrip?.segments[currentSegIdx]?.line_id ?? undefined}
        segments={activeTrip?.segments.map((seg, index) => ({
          index,
          label: `${seg.line_number ? `${seg.line_number} · ` : ''}${seg.transport_name}: ${seg.start_name} → ${seg.end_name}`,
          transportTypeId: seg.transport_type_id,
          transitLineId: seg.line_id ?? null,
        })) ?? []}
        language={language}
      />

      <ContributeTransportDialog
        open={!pipMapOnly && contributionDialogOpen}
        onClose={() => setContributionDialogOpen(false)}
        onSubmitted={() => {
          const pendingId = pendingNativeDiscovery?.id;
          if (pendingId) {
            void acknowledgeNativeDiscoveryTrip(pendingId).then(() => {
              setPendingNativeDiscovery(null);
              void loadPendingNativeDiscovery();
            });
          }
          clearContributionFlow();
        }}
        initialTrace={pendingNativeDiscovery?.trace ?? contributionTrace}
        initialTimestamps={pendingNativeDiscovery?.timestamps ?? contributionTimestamps}
        initialOperator={contributionOperator}
        initialFromArea={pendingNativeFromArea}
        initialToArea={pendingNativeToArea}
        initialRouteCompleteness={pendingNativeDiscovery ? 'partial' : 'full'}
        language={language}
      />

      {/* Bus info dialog — collecting operator/route info only; rating is never required here */}
      <BusUsedDialog
        open={!pipMapOnly && busUsedOpen}
        onClose={() => setBusUsedOpen(false)}
        onDone={() => {
          sessionStorage.removeItem(PENDING_FEEDBACK_KEY);
          handleSegmentReviewDone();
        }}
        transportName={busUsedName}
        fromArea={busUsedFrom}
        toArea={busUsedTo}
        language={language}
        onSwitchToMicrobus={() => {
          setBusUsedOpen(false);
          setMicrobusUsedName(busUsedName);
          setMicrobusUsedFrom(busUsedFrom);
          setMicrobusUsedTo(busUsedTo);
          setMicrobusUsedOpen(true);
        }}
      />

      {/* Microbus info dialog — collecting operator/route info only; rating is never required here */}
      <MicrobusUsedDialog
        open={!pipMapOnly && microbusUsedOpen}
        onClose={() => setMicrobusUsedOpen(false)}
        onDone={() => {
          sessionStorage.removeItem(PENDING_FEEDBACK_KEY);
          handleSegmentReviewDone();
        }}
        transportName={microbusUsedName}
        fromArea={microbusUsedFrom}
        toArea={microbusUsedTo}
        language={language}
        onSwitchToBus={() => {
          setMicrobusUsedOpen(false);
          setBusUsedName(microbusUsedName);
          setBusUsedFrom(microbusUsedFrom);
          setBusUsedTo(microbusUsedTo);
          setBusUsedOpen(true);
        }}
      />

      {/* Intercity vs Serfis choice */}
      <IntercityChoiceDialog
        open={!pipMapOnly && choiceOpen}
        onClose={() => setChoiceOpen(false)}
        onChoose={(choice) => {
          setChoiceOpen(false);
          if (!pendingTrip) return;
          const urls = {
            serfis: pendingTrip.planUrl, intercity: pendingTrip.intercityUrl,
            train: pendingTrip.trainUrl, flight: pendingTrip.flightUrl,
            taxi: pendingTrip.taxiUrl, nile: pendingTrip.nileUrl,
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

      <AlertDialog open={!pipMapOnly && cancelTripOpen} onOpenChange={setCancelTripOpen}>
        <AlertDialogContent className="glass-panel rounded-[2rem]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelTripTitle', language)}</AlertDialogTitle>
            <AlertDialogDescription>{t('cancelTripDescription', language)}</AlertDialogDescription>
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
