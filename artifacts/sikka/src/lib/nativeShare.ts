import { Capacitor, registerPlugin } from '@capacitor/core';

type NativeSharePayload = {
  title?: string;
  text?: string;
  url?: string;
};

type NativeSharePlugin = {
  share(payload: NativeSharePayload): Promise<{ opened?: boolean }>;
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
