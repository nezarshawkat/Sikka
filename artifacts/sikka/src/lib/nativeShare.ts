import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeSharePayload = {
  title?: string;
  text?: string;
  url?: string;
};

type NativeDestinationPayload = {
  /** Omit both lat/lng when only a name/address is known -- Android's geo
   *  intent can still resolve a text query without precise coordinates. */
  latitude?: number;
  longitude?: number;
  name?: string;
};

type NativeSharePlugin = {
  share(payload: NativeSharePayload): Promise<{ opened?: boolean }>;
  openDestination(payload: NativeDestinationPayload): Promise<{ opened?: boolean }>;
};

const SikkaShare = registerPlugin<NativeSharePlugin>('SikkaShare');

export async function openNativeShareSheet(payload: NativeSharePayload): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await SikkaShare.share(payload);
    return !!result?.opened;
  } catch (err) {
    console.warn('[native-share] failed to open share sheet', err);
    return false;
  }
}

/**
 * Android-only: passes a destination (lat/lng and/or name) through Android's
 * native `geo:` intent so the OS shows a chooser of every installed app that
 * can handle a location -- Google Maps, and any ride/taxi app that has
 * registered itself as a geo intent handler (this is the standard mechanism
 * apps like Uber use to support "get a ride" integrations from other apps).
 * Nothing here hardcodes a specific taxi app or package name.
 */
export async function openNativeDestinationChooser(payload: NativeDestinationPayload): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (payload.latitude == null && payload.longitude == null && !payload.name) return false;
  try {
    const result = await SikkaShare.openDestination(payload);
    return !!result?.opened;
  } catch (err) {
    console.warn('[native-share] failed to open destination chooser', err);
    return false;
  }
}
