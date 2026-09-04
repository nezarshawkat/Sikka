import { Capacitor, registerPlugin } from '@capacitor/core';

type AppInfoPlugin = { getBuildNumber(): Promise<{ buildNumber: number }> };
const SikkaAppInfo = registerPlugin<AppInfoPlugin>('SikkaAppInfo');

export async function getInstalledAndroidBuildNumber(): Promise<number | null> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  try {
    const { buildNumber } = await SikkaAppInfo.getBuildNumber();
    return Number.isInteger(buildNumber) ? buildNumber : null;
  } catch {
    return null;
  }
}
