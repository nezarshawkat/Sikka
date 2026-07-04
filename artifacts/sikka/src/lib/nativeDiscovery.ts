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
  requestPermissions(options: { permissions: string[] }): Promise<Record<string, string>>;
  getPendingTrips(): Promise<{ trips: NativeDiscoveryTrip[] }>;
  acknowledgeTrip(options: { id: string }): Promise<{ removed: boolean }>;
};

const SikkaDiscovery = registerPlugin<NativeDiscoveryPlugin>('SikkaDiscovery');

export async function startNativeDiscovery(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    await SikkaDiscovery.requestPermissions({ permissions: ['notifications'] }).catch(() => ({}));
    return !!(await SikkaDiscovery.startAlwaysOn()).enabled;
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
