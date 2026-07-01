import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocationSettingsPlugin {
  openAppSettings(): Promise<{ opened: boolean }>;
}

const LocationSettings = registerPlugin<LocationSettingsPlugin>('SikkaLocationSettings');

/** Opens Sikka's OS settings page after native location permission is denied. */
export async function openNativeLocationSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await LocationSettings.openAppSettings();
    return result.opened;
  } catch {
    return false;
  }
}
