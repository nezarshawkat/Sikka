import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIsDark } from '@/hooks/useIsDark';

export type MapMode = 'standard' | 'bright' | 'minimal' | 'dark';

export const MAP_MODES: Record<MapMode, { labelEn: string; labelAr: string; descriptionEn: string; descriptionAr: string; preview: string }> = {
  standard: {
    labelEn: 'Standard',
    labelAr: 'قياسي',
    descriptionEn: 'Balanced roads, stations, and neighborhoods.',
    descriptionAr: 'توازن بين الطرق والمحطات والأحياء.',
    preview: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 42%, #bbf7d0 43%, #86efac 100%)',
  },
  bright: {
    labelEn: 'Bright',
    labelAr: 'فاتح',
    descriptionEn: 'High-contrast daytime view.',
    descriptionAr: 'عرض نهاري واضح وعالي التباين.',
    preview: 'linear-gradient(135deg, #fef3c7 0%, #fff7ed 50%, #bfdbfe 51%, #93c5fd 100%)',
  },
  minimal: {
    labelEn: 'Minimal',
    labelAr: 'بسيط',
    descriptionEn: 'Cleaner map so route lines stand out.',
    descriptionAr: 'خريطة أهدأ لتظهر خطوط الرحلة بوضوح.',
    preview: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 55%, #cbd5e1 56%, #f1f5f9 100%)',
  },
  dark: {
    labelEn: 'Dark',
    labelAr: 'داكن',
    descriptionEn: 'Low-light navigation with bright route colors.',
    descriptionAr: 'مناسب للإضاءة الضعيفة مع ألوان مسارات واضحة.',
    preview: 'linear-gradient(135deg, #020617 0%, #1e293b 55%, #0f766e 56%, #0f172a 100%)',
  },
};

const MAP_STYLE_URLS: Record<MapMode, string> = {
  standard: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/positron',
  minimal: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

const STORAGE_KEY = 'sikka_map_mode';

export function getStoredMapMode(): MapMode | null {
  if (typeof localStorage === 'undefined') return null;
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'standard' || value === 'bright' || value === 'minimal' || value === 'dark' ? value : null;
}

export function setStoredMapMode(mode: MapMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent('sikka-map-mode-change', { detail: mode }));
}

export function useMapStyle() {
  const isDark = useIsDark();
  const [mode, setModeState] = useState<MapMode>(() => getStoredMapMode() ?? (isDark ? 'dark' : 'standard'));

  useEffect(() => {
    if (getStoredMapMode()) return;
    setModeState(isDark ? 'dark' : 'standard');
  }, [isDark]);

  useEffect(() => {
    const handler = () => setModeState(getStoredMapMode() ?? (isDark ? 'dark' : 'standard'));
    window.addEventListener('sikka-map-mode-change', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('sikka-map-mode-change', handler);
      window.removeEventListener('storage', handler);
    };
  }, [isDark]);

  const setMode = useCallback((next: MapMode) => {
    setStoredMapMode(next);
    setModeState(next);
  }, []);

  const style = useMemo(() => MAP_STYLE_URLS[mode] ?? MAP_STYLE_URLS.standard, [mode]);
  return { mode, setMode, style, modes: MAP_MODES };
}

export const MAP_STYLE_LIGHT = MAP_STYLE_URLS.standard;
export const MAP_STYLE_DARK = MAP_STYLE_URLS.dark;
