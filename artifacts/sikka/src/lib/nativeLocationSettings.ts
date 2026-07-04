import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocationSettingsPlugin {
  openAppSettings(): Promise<{ opened: boolean }>;
  openLocationSettings(): Promise<{ opened: boolean }>;
  promptEnableLocation(): Promise<{ enabled: boolean; prompted: boolean }>;
  isLocationEnabled(): Promise<{ enabled: boolean }>;
}

const LocationSettings = registerPlugin<LocationSettingsPlugin>('SikkaLocationSettings');

/** Shows Android's official high-accuracy location resolution dialog. */
export async function openNativeLocationSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await LocationSettings.promptEnableLocation();
    return result.enabled || result.prompted;
  } catch {
    try {
      return (await LocationSettings.openLocationSettings()).opened;
    } catch {
      return false;
    }
  }
}

export async function nativeLocationIsEnabled(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try { return (await LocationSettings.isLocationEnabled()).enabled; }
  catch { return null; }
}

export async function openNativeAppSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try { return (await LocationSettings.openAppSettings()).opened; }
  catch { return false; }
}
