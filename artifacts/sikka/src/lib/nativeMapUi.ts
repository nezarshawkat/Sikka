import { Capacitor, registerPlugin } from '@capacitor/core';

type SikkaMapUiPlugin = {
  configure(): Promise<{ configured: number }>;
  setTripPipEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
};

const SikkaMapUi = registerPlugin<SikkaMapUiPlugin>('SikkaMapUi');

export async function configureNativeMapUi(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await SikkaMapUi.configure();
  } catch (err) {
    console.warn('[native-map-ui] configure failed', err);
  }
}

export async function setTripPipEnabled(enabled: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await SikkaMapUi.setTripPipEnabled({ enabled });
  } catch (err) {
    console.warn('[native-map-ui] PiP toggle failed', err);
  }
}

export function onTripPipChange(listener: (active: boolean) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail === 'string') {
      try {
        listener(!!JSON.parse(detail).active);
      } catch {
        listener(false);
      }
      return;
    }
    listener(!!detail?.active);
  };
  window.addEventListener('sikka:pipchange', handler);
  return () => window.removeEventListener('sikka:pipchange', handler);
}
