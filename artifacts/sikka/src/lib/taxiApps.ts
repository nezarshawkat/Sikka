/**
 * Deep links for ride-hailing apps operating in Egypt, used to let the rider
 * pick which app to open instead of hardcoding Uber.
 *
 * Uber's `uber://` scheme and parameters are Uber's own documented deep-link
 * format (developer.uber.com/docs/deep-linking) so pickup/dropoff addresses
 * are passed through directly. Careem doesn't publish an equivalent public
 * deep-link parameter spec, so rather than guess at query parameter names
 * that might silently fail inside the Careem app, this only opens the app
 * itself (`careem://`) — still solves letting the rider choose Careem, just
 * without pre-filled pickup/dropoff for that one.
 */
export interface TaxiAppOption {
  id: 'uber' | 'careem';
  name: string;
  /** Deep link to try first (opens the installed app). */
  appUrl: string;
  /** Web fallback if the app isn't installed. */
  webUrl: string;
}

export function getTaxiAppOptions(fromName: string, toName: string): TaxiAppOption[] {
  const pickup = encodeURIComponent(fromName || '');
  const dropoff = encodeURIComponent(toName || '');
  return [
    {
      id: 'uber',
      name: 'Uber',
      appUrl: `uber://?action=setPickup&pickup[formatted_address]=${pickup}&dropoff[formatted_address]=${dropoff}`,
      webUrl: `https://m.uber.com/ul/?action=setPickup&pickup[formatted_address]=${pickup}&dropoff[formatted_address]=${dropoff}`,
    },
    {
      id: 'careem',
      name: 'Careem',
      appUrl: 'careem://',
      webUrl: 'https://www.careem.com/',
    },
  ];
}

/** Opens an app link, falling back to its web URL if the app doesn't pick it
 *  up (best-effort — there's no reliable way to detect this from a web
 *  context, so this is a timed fallback rather than a guaranteed one). */
export function openTaxiApp(option: TaxiAppOption) {
  const fallbackTimer = window.setTimeout(() => {
    window.open(option.webUrl, '_blank', 'noopener,noreferrer');
  }, 1500);
  window.addEventListener('blur', () => window.clearTimeout(fallbackTimer), { once: true });
  window.location.href = option.appUrl;
}
