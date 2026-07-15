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

function routeLengthMeters(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

function projectUserToRoute(
  userPos: UserPos,
  coords: [number, number][],
): { cumulativeM: number; distanceM: number } | null {
  if (coords.length < 2) return null;

  const point: [number, number] = [userPos.lng, userPos.lat];
  let best: { cumulativeM: number; distanceM: number } | null = null;
  let cumulativeBefore = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const segmentLength = haversine(start[1], start[0], end[1], end[0]);
    if (segmentLength <= 0) continue;

    const latRad = ((point[1] + start[1] + end[1]) / 3 * Math.PI) / 180;
    const scaleX = Math.max(0.000001, Math.cos(latRad));
    const px = point[0] * scaleX;
    const py = point[1];
    const ax = start[0] * scaleX;
    const ay = start[1];
    const bx = end[0] * scaleX;
    const by = end[1];
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;
    const t = denom > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom)) : 0;
    const projected: [number, number] = [
      (ax + dx * t) / scaleX,
      ay + dy * t,
    ];
    const distanceM = haversine(point[1], point[0], projected[1], projected[0]);
    const candidate = { cumulativeM: cumulativeBefore + segmentLength * t, distanceM };

    if (!best || candidate.distanceM < best.distanceM) {
      best = candidate;
    }

    cumulativeBefore += segmentLength;
  }

  return best;
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
  const [routeProgressMeters, setRouteProgressMeters] = useState(0);
  const [routeTotalMeters, setRouteTotalMeters] = useState(0);
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
  const routeProgressRef = useRef(0);
  const routeSignatureRef = useRef('');
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
    routeProgressRef.current = 0;
    routeSignatureRef.current = '';
    setProgress(0);
    setRouteProgressMeters(0);
    setRouteTotalMeters(0);
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
    const segStartDistances: number[] = [];
    const segDistances: number[] = []; // cumulative length at the END of each segment
    const segmentLengths: number[] = [];
    let totalDist = 0;

    for (const r of ordered) {
      const length = routeLengthMeters(r.coords);
      segStartDistances[r.segIndex] = totalDist;
      segmentLengths[r.segIndex] = length;
      totalDist += length;
      segDistances[r.segIndex] = totalDist;
    }

    const routeSignature = ordered
      .map(({ segIndex, coords }) => {
        const first = coords[0];
        const last = coords[coords.length - 1];
        return [
          segIndex,
          coords.length,
          (segmentLengths[segIndex] ?? 0).toFixed(1),
          first ? `${first[0]},${first[1]}` : '',
          last ? `${last[0]},${last[1]}` : '',
        ].join(':');
      })
      .join('|');

    if (routeSignatureRef.current !== routeSignature) {
      routeSignatureRef.current = routeSignature;
      routeProgressRef.current = 0;
      setRouteProgressMeters(0);
      setRouteTotalMeters(totalDist);
      setProgress(0);
      setSegProgress(0);
    }

    if (totalDist > 0) {
      let nearestD = Infinity;
      let nearestCum = 0;
      for (const r of ordered) {
        const projected = projectUserToRoute(userPos, r.coords);
        if (projected && projected.distanceM < nearestD) {
          nearestD = projected.distanceM;
          nearestCum = (segStartDistances[r.segIndex] ?? 0) + projected.cumulativeM;
        }
      }

      const segStartCum = segStartDistances[currentSegIdx] ?? 0;
      const segEndCum = segDistances[currentSegIdx] ?? totalDist;
      const segLen = Math.max(1, segEndCum - segStartCum);
      const gpsRouteProgress = nearestD <= OFF_ROUTE_THRESHOLD_M
        ? nearestCum
        : routeProgressRef.current;
      const nextRouteProgress = Math.min(totalDist, Math.max(routeProgressRef.current, gpsRouteProgress));

      routeProgressRef.current = nextRouteProgress;
      setRouteProgressMeters(nextRouteProgress);
      setRouteTotalMeters(totalDist);
      setProgress(Math.max(0, Math.min(100, (nearestCum / totalDist) * 100)));

      // Off-route detection: nearestD is the distance from the rider's actual
      // GPS fix to the closest point on the expected route polyline. A
      // sustained large gap means they likely boarded the wrong vehicle,
      // missed a turn on foot, or got off somewhere unexpected — not just GPS
      // jitter, which is why we require a streak in either direction before
      // flipping state.
      if (Number.isFinite(nearestD)) {
        setOffRouteDistanceM(Math.round(nearestD));
      }
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

      const rawWithin = (nextRouteProgress - segStartCum) / segLen;
      const within = Math.max(0, Math.min(1, rawWithin));
      setSegProgress(within);
      if (nearestCum > segEndCum + PASSED_END_THRESHOLD_M) {
        setPassedSegmentEnd(true);
      }
    } else {
      routeProgressRef.current = 0;
      setRouteProgressMeters(0);
      setRouteTotalMeters(0);
      setProgress(0);
      setSegProgress(0);
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
    routeProgressMeters,
    routeTotalMeters,
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
