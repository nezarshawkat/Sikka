import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { showTripNotification, clearTripNotification } from '@/lib/nativeTripNotification';
import type { Language } from '@/lib/i18n';

interface TripNotificationOptions {
  active: boolean;
  from: string;
  to: string;
  transportName: string;
  transportColor: string;
  /** Short code shown inside the colored circle, e.g. a metro line number. Falls back to the transport name. */
  transportCode?: string;
  /** Short, already-localized mode word for the badge, e.g. "Bus" / "Microbus" / "أتوبيس". */
  modeLabel?: string;
  /** Mode key used to pick the native notification badge glyph (bus/metro/car/tuktuk/etc). */
  icon?: string;
  language: Language;
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

/**
 * Shows a persistent "active trip" notification. On the native Android app
 * this is a real custom-layout system notification (see
 * SikkaTripNotificationPlugin.java) with a dynamically-colored route badge.
 * In a browser/PWA context (no native layer available) it falls back to a
 * service-worker-driven Web Notification, which is a plainer OS-styled
 * notification but works without any native code.
 */
export function useTripNotification({
  active,
  from,
  to,
  transportName,
  transportColor,
  transportCode,
  modeLabel,
  icon,
  language,
  progress,
}: TripNotificationOptions) {
  const isNative = Capacitor.isNativePlatform();
  const hasPermRef = useRef(false);
  const lastProgressRef = useRef(-1);
  const shownNativeRef = useRef(false);

  // Request permission when trip starts (web path only — the native path
  // requests Android's own POST_NOTIFICATIONS permission internally).
  useEffect(() => {
    if (!active || isNative) return;
    requestPermission().then((ok) => {
      hasPermRef.current = ok;
    });
  }, [active, isNative]);

  // Cache the map tiles the rider's view touches for the duration of the
  // trip, so the route map stays usable through a tunnel or dead signal —
  // this works regardless of whether notification permission was granted.
  // Native-app tile caching isn't wired through the service worker, so this
  // only applies to the web/PWA path.
  useEffect(() => {
    if (isNative) return;
    void sendToSw({ type: 'SET_TILE_CACHING', enabled: active });
  }, [active, isNative]);

  // Show / update notification while trip is active.
  useEffect(() => {
    if (!active) return;

    if (isNative) {
      // The native custom notification is cheap to update (no bitmap
      // painting) and Android already de-dupes identical content via
      // onlyAlertOnce, so it can just be re-shown whenever the relevant
      // fields change rather than throttled to every-5%-progress like the
      // web fallback below.
      shownNativeRef.current = true;
      void showTripNotification({
        from,
        to,
        transportName,
        modeLabel: modeLabel || transportCode || transportName,
        icon,
        color: transportColor,
        language,
      });
      return;
    }

    if (!hasPermRef.current) return;
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
  }, [active, isNative, from, to, transportName, transportColor, transportCode, modeLabel, icon, language, progress]);

  // Dismiss when trip ends.
  useEffect(() => {
    if (active) return;
    lastProgressRef.current = -1;
    if (isNative) {
      if (shownNativeRef.current) {
        shownNativeRef.current = false;
        void clearTripNotification();
      }
      return;
    }
    void sendToSw({ type: 'DISMISS_TRIP_NOTIFICATION' });
  }, [active, isNative]);
}
