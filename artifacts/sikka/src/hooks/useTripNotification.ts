import { useEffect, useRef } from 'react';

interface TripNotificationOptions {
  active: boolean;
  from: string;
  to: string;
  transportName: string;
  transportColor: string;
  /** Short code shown inside the colored circle, e.g. a metro line number. Falls back to the transport name. */
  transportCode?: string;
  progress: number; // 0-100
}

let swRegistration: ServiceWorkerRegistration | null = null;

async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  if (swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw-trip.js', { scope: '/' });
    return swRegistration;
  } catch {
    return null;
  }
}

async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function sendToSw(message: Record<string, unknown>) {
  const reg = await getSwRegistration();
  if (!reg?.active) return;
  reg.active.postMessage(message);
}

export function useTripNotification({
  active,
  from,
  to,
  transportName,
  transportColor,
  transportCode,
  progress,
}: TripNotificationOptions) {
  const hasPermRef = useRef(false);
  const lastProgressRef = useRef(-1);

  // Request permission when trip starts
  useEffect(() => {
    if (!active) return;
    requestPermission().then((ok) => {
      hasPermRef.current = ok;
    });
  }, [active]);

  // Cache the map tiles the rider's view touches for the duration of the
  // trip, so the route map stays usable through a tunnel or dead signal —
  // this works regardless of whether notification permission was granted.
  useEffect(() => {
    void sendToSw({ type: 'SET_TILE_CACHING', enabled: active });
  }, [active]);

  // Show / update notification while trip is active
  useEffect(() => {
    if (!active || !hasPermRef.current) return;
    // Only update every 5% to avoid spam
    const rounded = Math.round(progress / 5) * 5;
    if (rounded === lastProgressRef.current) return;
    lastProgressRef.current = rounded;

    void sendToSw({
      type: 'SHOW_TRIP_NOTIFICATION',
      from,
      to,
      transportName,
      transportColor,
      transportCode,
      progress,
    });
  }, [active, from, to, transportName, transportColor, transportCode, progress]);

  // Dismiss when trip ends
  useEffect(() => {
    if (active) return;
    lastProgressRef.current = -1;
    void sendToSw({ type: 'DISMISS_TRIP_NOTIFICATION' });
  }, [active]);
}
