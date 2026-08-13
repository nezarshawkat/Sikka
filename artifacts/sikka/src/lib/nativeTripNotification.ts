import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Language } from '@/lib/i18n';

type TripNotificationPayload = {
  from: string;
  to: string;
  transportName: string;
  /** Short, already-localized mode word shown in the colored badge, e.g. "Bus" / "أتوبيس". */
  modeLabel: string;
  /** Mode key ('bus' | 'metro' | 'train' | 'monorail' | 'lrt' | 'brt' | 'car' |
   *  'bike'/'tuktuk' | 'walk' | 'ship' | 'plane') used to pick the notification
   *  badge glyph. Same keys the web UI's own ICONS maps already use. */
  icon?: string;
  color: string;
  language: Language;
};

type SikkaTripNotificationPlugin = {
  show(payload: TripNotificationPayload): Promise<{ shown?: boolean; permissionRequested?: boolean } | void>;
  clear(): Promise<void>;
};

const SikkaTripNotification = registerPlugin<SikkaTripNotificationPlugin>('SikkaTripNotification');

export async function showTripNotification(payload: TripNotificationPayload) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const result = await SikkaTripNotification.show(payload);
    if (result?.permissionRequested) {
      window.setTimeout(() => {
        void SikkaTripNotification.show(payload).catch((err) => {
          console.warn('[trip-notification] failed to show native notification after permission request', err);
        });
      }, 1800);
    }
  } catch (err) {
    console.warn('[trip-notification] failed to show native notification', err);
  }
}

export async function clearTripNotification() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SikkaTripNotification.clear();
  } catch (err) {
    console.warn('[trip-notification] failed to clear native notification', err);
  }
}
