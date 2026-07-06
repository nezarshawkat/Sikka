import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativeDiscoveryTrip = {
  id: string;
  detectedAt: number;
  startedAt: number;
  endedAt: number;
  distanceMeters: number;
  trace: [number, number][];
  timestamps: number[];
};

type NativeDiscoveryPlugin = {
  startAlwaysOn(): Promise<{ enabled: boolean; notificationPermission: boolean }>;
  stopAlwaysOn(): Promise<{ enabled: boolean }>;
  requestPermissions(options: { permissions: string[] }): Promise<Record<string, string>>;
  getPendingTrips(): Promise<{ trips: NativeDiscoveryTrip[] }>;
  acknowledgeTrip(options: { id: string }): Promise<{ removed: boolean }>;
};

const SikkaDiscovery = registerPlugin<NativeDiscoveryPlugin>('SikkaDiscovery');

/**
 * @deprecated No longer called anywhere in the app. This started a native
 * Android foreground service that kept watching for rides even with Sikka
 * closed — which Android requires to show a persistent "Sikka is collecting
 * trip data" notification for as long as it runs, with no way to hide it.
 * Replaced by stopNativeDiscovery() so that notification doesn't show up
 * unprompted. Kept only so old callers/tests don't hard-fail; safe to delete
 * once nothing references it.
 */
export async function startNativeDiscovery(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    await SikkaDiscovery.requestPermissions({ permissions: ['notifications'] }).catch(() => ({}));
    return !!(await SikkaDiscovery.startAlwaysOn()).enabled;
  } catch {
    return false;
  }
}

/**
 * Turns off the always-on background discovery service, including for
 * installs where a previous app version already started it. This is what
 * makes the persistent "Sikka is collecting trip data" notification go away
 * — Android has no way to keep that service running without showing some
 * notification, so the only way to remove it is to stop the service itself.
 * Ride discovery still works while Sikka is open in the foreground; it just
 * no longer keeps recording after the app is closed or backgrounded.
 */
export async function stopNativeDiscovery(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return true;
  try {
    await SikkaDiscovery.stopAlwaysOn();
    return true;
  } catch {
    return false;
  }
}

export async function getPendingNativeDiscoveryTrips(): Promise<NativeDiscoveryTrip[]> {
  if (Capacitor.getPlatform() !== 'android') return [];
  try {
    const result = await SikkaDiscovery.getPendingTrips();
    return Array.isArray(result.trips) ? result.trips.filter((trip) =>
      !!trip?.id && Array.isArray(trip.trace) && trip.trace.length >= 2,
    ) : [];
  } catch {
    return [];
  }
}

export async function acknowledgeNativeDiscoveryTrip(id: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android' || !id) return;
  await SikkaDiscovery.acknowledgeTrip({ id });
}
