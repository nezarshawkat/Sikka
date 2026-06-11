const CACHE_VERSION = "sikka-offline-v1";
const APP_CACHE = `${CACHE_VERSION}-app`;
const MAP_CACHE = `${CACHE_VERSION}-maps`;

const APP_ASSETS = [
  "/",
  "/offline-snapshot.json",
  "/offline-road-graph.json",
  "/sikka-logo.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("sikka-offline-") && !key.startsWith(CACHE_VERSION))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isMapRequest(url) {
  return [
    "tiles.openfreemap.org",
    "api.mapbox.com",
    "a.tile.openstreetmap.org",
    "b.tile.openstreetmap.org",
    "c.tile.openstreetmap.org",
  ].some((host) => url.hostname === host);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (isMapRequest(url)) {
    event.respondWith(
      caches.open(MAP_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          event.waitUntil(fetch(request).then((res) => {
            if (res.ok) cache.put(request, res.clone());
          }).catch(() => undefined));
          return cached;
        }
        const res = await fetch(request);
        if (res.ok) await cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })),
    );
  }
});
