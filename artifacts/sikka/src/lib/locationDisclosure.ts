export const LOCATION_DISCLOSURE_STORAGE_KEY = 'sikka_location_permission_disclosure';

export function hasAcceptedLocationDisclosure(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(LOCATION_DISCLOSURE_STORAGE_KEY) === 'accepted';
}

export function persistLocationDisclosure(decision: 'accepted' | 'dismissed'): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCATION_DISCLOSURE_STORAGE_KEY, decision);
}
