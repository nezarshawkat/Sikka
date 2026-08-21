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
  getStatus(): Promise<{ enabled: boolean; pendingCount: number }>;
  getPendingTrips(): Promise<{ trips: NativeDiscoveryTrip[] }>;
  acknowledgeTrip(options: { id: string }): Promise<{ removed: boolean }>;
};

const SikkaDiscovery = registerPlugin<NativeDiscoveryPlugin>('SikkaDiscovery');

/**
 * Starts the native durable discovery recorder. Android keeps this as a
 * foreground location service so detected bus/microbus traces survive offline
 * periods, app backgrounding, and process restarts.
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

/** Turns off the always-on background discovery service. */
export async function stopNativeDiscovery(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return true;
  try {
    await SikkaDiscovery.stopAlwaysOn();
    return true;
  } catch {
    return false;
  }
}

/** Whether the native durable recorder is currently running, independent of
 *  who turned it on -- used so a feature that needs it running temporarily
 *  (e.g. a manual "Contribute a route" recording) can restore the prior
 *  state afterward instead of always leaving it on or always turning it off. */
export async function isNativeDiscoveryEnabled(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    return !!(await SikkaDiscovery.getStatus()).enabled;
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
