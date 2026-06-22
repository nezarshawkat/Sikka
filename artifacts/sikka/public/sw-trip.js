/* Sikka Trip Notification Service Worker
 *
 * Platform note: the standard Web Notification API only exposes a handful of
 * customizable slots — icon, badge, image, title, body (plain text), and
 * actions. It does NOT support a fully custom OS-chrome layout. To get as
 * close as possible to a Google-Maps-style nav card while staying on-brand,
 * the "transport circle + route + progress" block is drawn as a single
 * composite SVG card and passed as the notification `image` (the one slot
 * that renders a full custom graphic). `icon` is Sikka's actual logo mark
 * shown when the notification is opened; `badge` is the small mark Android
 * shows in the status bar next to the clock — Android re-tints badge icons
 * to a single color automatically, it does not preserve uploaded artwork
 * colors there by OS design, so a simplified silhouette is used there.
 */

const BRAND = {
  primary: '#24A7FF',     // app's --primary token
  gradientFrom: '#258DFF', // sikka-logo.svg gradient
  gradientTo: '#02F6FC',
  ink: '#14181F',          // app's --foreground (light) token
  cardBg: '#FFFFFF',
  track: '#E7EBF0',
};

function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function truncateMiddle(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

/** Sikka's real wordmark — blue rounded square + "سكة" — used for the
 *  notification icon (the "opened" state). Matches public/logo.svg. */
function logoIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
        <stop stop-color="${BRAND.gradientFrom}"/>
        <stop offset="1" stop-color="${BRAND.gradientTo}"/>
      </linearGradient>
    </defs>
    <rect width="96" height="96" rx="22" fill="url(#g)"/>
    <text x="48" y="63" font-family="Cairo, Tahoma, sans-serif" font-size="40" font-weight="700"
          fill="#FFFFFF" text-anchor="middle">سكة</text>
  </svg>`;
}

/** Simplified mark for the status-bar badge — Android recolors this to a
 *  single tint automatically, so a clean bold silhouette reads best. */
function badgeIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="22" fill="${BRAND.primary}"/>
    <text x="48" y="66" font-family="Cairo, Tahoma, sans-serif" font-size="48" font-weight="700"
          fill="#FFFFFF" text-anchor="middle">س</text>
  </svg>`;
}

/**
 * The Google-Maps-nav-card-style composite: transport indicator circle with
 * the line's color and a short code, the route name, the shortened from/to
 * with an ellipsis when it's too long, and the same kind of slim progress
 * line used in the in-app trip popup — all on a clean card that picks up
 * Sikka's own brand gradient for the accents instead of generic colors.
 */
function buildTripCardSvg({ from, to, transportName, transportColor, transportCode, progress }) {
  const W = 440, H = 176;
  const fromShort = truncateMiddle(from, 16) || '?';
  const toShort = truncateMiddle(to, 16) || '?';
  const nameShort = truncateMiddle(transportName, 22) || '';
  const code = (transportCode || nameShort || '?').slice(0, 3).toUpperCase();
  const color = transportColor || BRAND.primary;
  const filled = Math.max(0, Math.min(100, Math.round(progress)));
  const barW = W - 48;
  const fillW = Math.max(10, (barW * filled) / 100);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="brandStripe" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
        <stop stop-color="${BRAND.gradientFrom}"/>
        <stop offset="1" stop-color="${BRAND.gradientTo}"/>
      </linearGradient>
    </defs>

    <rect width="${W}" height="${H}" rx="24" fill="${BRAND.cardBg}"/>
    <!-- Brand stripe along the top edge, like a map app's accent bar -->
    <rect width="${W}" height="6" rx="3" fill="url(#brandStripe)"/>

    <!-- Transport indicator: colored circle with a short code -->
    <circle cx="40" cy="56" r="26" fill="${escapeXml(color)}"/>
    <text x="40" y="64" font-size="17" font-weight="700" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif">${escapeXml(code)}</text>

    <!-- Transport full name, beside the circle -->
    <text x="80" y="50" font-size="21" font-weight="700" fill="${BRAND.ink}" font-family="sans-serif">${escapeXml(nameShort)}</text>
    <!-- From -> To, shortened with an ellipsis if too long -->
    <text x="80" y="76" font-size="17" fill="#5B6472" font-family="sans-serif">${escapeXml(fromShort)} → ${escapeXml(toShort)}</text>

    <!-- Loading / progress line, same idea as the in-app trip popup -->
    <rect x="24" y="132" width="${barW}" height="10" rx="5" fill="${BRAND.track}"/>
    <rect x="24" y="132" width="${fillW}" height="10" rx="5" fill="url(#brandStripe)"/>
    <text x="24" y="160" font-size="14" fill="#8A93A3" font-family="sans-serif">${filled}%</text>
  </svg>`;
}

function toDataUrl(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Offline tile caching for the active trip's map ─────────────────────────
// While a trip is on, map tiles the rider's view touches get cached so the
// route map stays usable through a tunnel or a dead patch of signal — not
// just the trip data, the actual map tiles. Caching is OFF by default and
// only turns on for the duration of a trip (toggled by the page via
// postMessage) so a casual map-browsing session never grows the cache.
const TILE_CACHE_NAME = 'sikka-tiles-v1';
const TILE_CACHE_MAX_ENTRIES = 400; // ~enough for a full route corridor at a couple of zoom levels
const TILE_HOST_PATTERNS = [/tiles\.openfreemap\.org/, /\.openfreemap\.org/];

let tileCachingEnabled = false;

function isTileRequest(url) {
  return TILE_HOST_PATTERNS.some((re) => re.test(url));
}

async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length <= TILE_CACHE_MAX_ENTRIES) return;
  // Cache.keys() returns insertion order in every engine that matters here,
  // so the oldest entries are simply the first ones — trim from the front.
  const excess = keys.length - TILE_CACHE_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (event.request.method !== 'GET' || !isTileRequest(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(TILE_CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const fresh = await fetch(event.request);
        if (fresh.ok && tileCachingEnabled) {
          cache.put(event.request, fresh.clone());
          trimTileCache();
        }
        return fresh;
      } catch (err) {
        // Offline and nothing cached for this tile — let it fail through to
        // MapLibre's own handling rather than throwing inside the SW.
        return cached || Response.error();
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        return clients.openWindow('/');
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_TRIP_NOTIFICATION') {
    const { from, to, transportName, transportColor, transportCode, progress } = event.data;

    const iconUrl = toDataUrl(logoIconSvg());
    const badgeUrl = toDataUrl(badgeIconSvg());
    const imageUrl = toDataUrl(buildTripCardSvg({ from, to, transportName, transportColor, transportCode, progress }));

    const fromShort = truncateMiddle(from, 18) || '?';
    const toShort = truncateMiddle(to, 18) || '?';

    self.registration.showNotification('Sikka', {
      tag: 'sikka-active-trip',
      renotify: false,
      silent: true,
      icon: iconUrl,
      badge: badgeUrl,
      image: imageUrl,
      // Plain-text fallback for platforms/screen readers that don't render `image`.
      body: `${fromShort} → ${toShort} · ${transportName || ''}`,
      data: { url: '/' },
      actions: [{ action: 'open', title: 'Open app' }],
      requireInteraction: true,
    });
  }

  if (event.data?.type === 'DISMISS_TRIP_NOTIFICATION') {
    self.registration.getNotifications({ tag: 'sikka-active-trip' }).then((notifs) => {
      notifs.forEach((n) => n.close());
    });
  }

  if (event.data?.type === 'SET_TILE_CACHING') {
    tileCachingEnabled = !!event.data.enabled;
  }
});
