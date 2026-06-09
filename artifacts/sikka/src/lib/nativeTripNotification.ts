import { Capacitor, registerPlugin } from '@capacitor/core';

type TripNotificationPayload = {
  from: string;
  to: string;
  transportName: string;
  icon: string;
  color: string;
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
