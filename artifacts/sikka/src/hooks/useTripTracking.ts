import { useEffect, useRef, useState } from 'react';

export interface TrackSegment {
  duration_minutes: number;
}

interface UseTripTrackingArgs {
  enabled: boolean;
  segments: TrackSegment[];
  currentSegIdx: number;
  /** Per-segment road geometry as [lng, lat][] arrays, in segment order. */
  routeCoords: { segIndex: number; coords: [number, number][] }[];
  /** Fired once when the user gets within the arrival threshold of the current segment end. */
  onApproachSegmentEnd?: (segIdx: number) => void;
  /** Fired once when the rider's drift-off-route state changes (true = just
   *  went off-route, false = just came back onto it). */
  onOffRouteChange?: (offRoute: boolean) => void;
}

export interface UserPos {
  lat: number;
  lng: number;
  timestamp: number;
}

const EARTH_R = 6371000; // metres
const ARRIVAL_THRESHOLD_M = 120;
const PASSED_END_THRESHOLD_M = 80;
const WALKING_SPEED_MAX_KMH = 7;
// How far the rider can be from the expected path before we consider them
// drifted off it. Generous enough to absorb normal GPS noise and the width of
// a real street, but still tight enough to flag "wrong vehicle" or "missed a
// turn" situations meaningfully sooner than just silently mistracking progress.
const OFF_ROUTE_THRESHOLD_M = 220;
// Require this many consecutive readings on the wrong side of the threshold
// before flipping state, so a single noisy GPS fix doesn't trigger a false
// alarm (and so a brief reconnect to the route doesn't instantly clear a real
// one either).
const OFF_ROUTE_STREAK = 3;

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * GPS tracking for an active trip. Watches the user position, computes overall
 * progress along the full route polyline, auto-suggests segment advance when the
 * user nears the current segment end, and estimates remaining minutes.
 */
export function useTripTracking({
  enabled,
  segments,
  currentSegIdx,
  routeCoords,
  onApproachSegmentEnd,
  onOffRouteChange,
}: UseTripTrackingArgs) {
  const [userPos, setUserPos] = useState<UserPos | null>(null);
  const [progress, setProgress] = useState(0); // 0..100 over whole route
  const [segProgress, setSegProgress] = useState(0); // 0..1 within current segment
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [offRouteDistanceM, setOffRouteDistanceM] = useState(0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [distanceToSegmentEndM, setDistanceToSegmentEndM] = useState<number | null>(null);
  const [segmentEndReached, setSegmentEndReached] = useState(false);
  const [passedSegmentEnd, setPassedSegmentEnd] = useState(false);
  const watchRef = useRef<number | null>(null);
  const approachedRef = useRef<Record<number, boolean>>({});
  const reachedRef = useRef<Record<number, boolean>>({});
  const lastSampleRef = useRef<UserPos | null>(null);
  const offRouteStreakRef = useRef(0);
  const onRouteStreakRef = useRef(0);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;
    // Reset ephemeral tracking state for the new tracking session / trip.
    approachedRef.current = {};
    reachedRef.current = {};
    lastSampleRef.current = null;
    offRouteStreakRef.current = 0;
    onRouteStreakRef.current = 0;
    setProgress(0);
    setSegProgress(0);
    setIsOffRoute(false);
    setOffRouteDistanceM(0);
    setSpeedKmh(0);
    setDistanceToSegmentEndM(null);
    setSegmentEndReached(false);
    setPassedSegmentEnd(false);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const next: UserPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: pos.timestamp || Date.now(),
        };
        const prev = lastSampleRef.current;
        if (prev) {
          const seconds = Math.max(0.1, (next.timestamp - prev.timestamp) / 1000);
          const meters = haversine(prev.lat, prev.lng, next.lat, next.lng);
          const instantaneous = (meters / seconds) * 3.6;
          if (Number.isFinite(instantaneous) && instantaneous >= 0 && instantaneous <= 160) {
            setSpeedKmh((old) => old <= 0 ? instantaneous : old * 0.65 + instantaneous * 0.35);
          }
        }
        lastSampleRef.current = next;
        setUserPos(next);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [enabled]);

  useEffect(() => {
    setDistanceToSegmentEndM(null);
    setSegmentEndReached(!!reachedRef.current[currentSegIdx]);
    setPassedSegmentEnd(false);
  }, [currentSegIdx]);

  // Compute progress + auto-advance heuristic whenever the position changes.
  useEffect(() => {
    if (!userPos) return;

    const ordered = [...routeCoords].sort((a, b) => a.segIndex - b.segIndex);
    const flat: [number, number][] = [];
    const segDistances: number[] = []; // cumulative length at the END of each segment
    let running = 0;
    for (const r of ordered) {
      for (let i = 0; i < r.coords.length; i++) {
        flat.push(r.coords[i]);
        if (flat.length > 1) {
          const prev = flat[flat.length - 2];
          const cur = flat[flat.length - 1];
          running += haversine(prev[1], prev[0], cur[1], cur[0]);
        }
      }
      segDistances[r.segIndex] = running;
    }

    const totalDist = running;

    if (flat.length >= 2 && totalDist > 0) {
      // Find nearest vertex on the flattened polyline and its cumulative distance.
      let nearestIdx = 0;
      let nearestD = Infinity;
      let cum = 0;
      let nearestCum = 0;
      for (let i = 0; i < flat.length; i++) {
        if (i > 0) {
          const prev = flat[i - 1];
          const cur = flat[i];
          cum += haversine(prev[1], prev[0], cur[1], cur[0]);
        }
        const d = haversine(userPos.lat, userPos.lng, flat[i][1], flat[i][0]);
        if (d < nearestD) {
          nearestD = d;
          nearestIdx = i;
          nearestCum = cum;
        }
      }
      void nearestIdx;
      setProgress(Math.max(0, Math.min(100, (nearestCum / totalDist) * 100)));

      // Off-route detection: nearestD is the distance from the rider's actual
      // GPS fix to the closest point on the expected route polyline. A
      // sustained large gap means they likely boarded the wrong vehicle,
      // missed a turn on foot, or got off somewhere unexpected — not just GPS
      // jitter, which is why we require a streak in either direction before
      // flipping state.
      setOffRouteDistanceM(Math.round(nearestD));
      if (nearestD > OFF_ROUTE_THRESHOLD_M) {
        offRouteStreakRef.current += 1;
        onRouteStreakRef.current = 0;
        if (offRouteStreakRef.current >= OFF_ROUTE_STREAK) {
          setIsOffRoute((prev) => {
            if (!prev) onOffRouteChange?.(true);
            return true;
          });
        }
      } else {
        onRouteStreakRef.current += 1;
        offRouteStreakRef.current = 0;
        if (onRouteStreakRef.current >= OFF_ROUTE_STREAK) {
          setIsOffRoute((prev) => {
            if (prev) onOffRouteChange?.(false);
            return false;
          });
        }
      }

      // progress within the current segment
      const segStartCum = currentSegIdx > 0 ? segDistances[currentSegIdx - 1] ?? 0 : 0;
      const segEndCum = segDistances[currentSegIdx] ?? totalDist;
      const segLen = Math.max(1, segEndCum - segStartCum);
      const rawWithin = (nearestCum - segStartCum) / segLen;
      const within = Math.max(0, Math.min(1, rawWithin));
      setSegProgress(within);
      if (nearestCum > segEndCum + PASSED_END_THRESHOLD_M) {
        setPassedSegmentEnd(true);
      }
    }

    // Auto-advance heuristic: near the current segment's end point.
    const curSeg = ordered.find((r) => r.segIndex === currentSegIdx);
    const endPt = curSeg?.coords?.[curSeg.coords.length - 1];
    if (endPt) {
      const distToEnd = haversine(userPos.lat, userPos.lng, endPt[1], endPt[0]);
      setDistanceToSegmentEndM(Math.round(distToEnd));
      if (distToEnd <= ARRIVAL_THRESHOLD_M && !approachedRef.current[currentSegIdx]) {
        approachedRef.current[currentSegIdx] = true;
        reachedRef.current[currentSegIdx] = true;
        setSegmentEndReached(true);
        onApproachSegmentEnd?.(currentSegIdx);
      }
      if (distToEnd <= ARRIVAL_THRESHOLD_M) {
        reachedRef.current[currentSegIdx] = true;
        setSegmentEndReached(true);
      }
      if (
        reachedRef.current[currentSegIdx]
        && distToEnd > ARRIVAL_THRESHOLD_M + PASSED_END_THRESHOLD_M
        && speedKmh > WALKING_SPEED_MAX_KMH
      ) {
        setPassedSegmentEnd(true);
      }
    } else {
      setDistanceToSegmentEndM(null);
    }
  }, [userPos, routeCoords, currentSegIdx, onApproachSegmentEnd, onOffRouteChange, speedKmh]);

  // Remaining minutes = remaining segments' durations, scaled by progress in current.
  const remainingMinutes = (() => {
    if (!segments.length) return 0;
    let total = 0;
    for (let i = currentSegIdx; i < segments.length; i++) {
      const dur = segments[i]?.duration_minutes || 0;
      if (i === currentSegIdx) total += dur * (1 - segProgress);
      else total += dur;
    }
    return Math.round(total);
  })();

  return {
    userPos,
    progress,
    segProgress,
    remainingMinutes,
    isOffRoute,
    offRouteDistanceM,
    speedKmh,
    distanceToSegmentEndM,
    segmentEndReached,
    passedSegmentEnd,
  };
}
