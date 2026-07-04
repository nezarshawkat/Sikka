import { useEffect, useRef, useState } from 'react';
import { GoogleMap, LatLngBounds, type Marker, type Polyline } from '@capacitor/google-maps';
import { registerPlugin } from '@capacitor/core';
import type { MapMode } from '@/hooks/useMapStyle';

type LngLat = [number, number];

type NativeGoogleHomeMapProps = {
  center: { latitude: number; longitude: number; zoom: number };
  routes: { id: string; color: string; coordinates: LngLat[] }[];
  contribution?: LngLat[];
  start?: { lat: number; lng: number } | null;
  destination?: { lat: number; lng: number } | null;
  pickedDestination?: { lat: number; lng: number } | null;
  userLocation?: { lat: number; lng: number } | null;
  onMapClick: (coordinate: { lat: number; lng: number }) => void;
  mapMode: MapMode;
};

const MAP_ID = 'sikka-home-native-google-map';
const SikkaMapUi = registerPlugin<{ configure(): Promise<{ configured: number }> }>('SikkaMapUi');

const GOOGLE_MAP_STYLES: Record<MapMode, Array<{
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string | number>>;
}>> = {
  standard: [],
  bright: [
    { elementType: 'geometry', stylers: [{ saturation: 8 }, { lightness: 8 }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ lightness: 12 }] },
    { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  ],
  minimal: [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit.station', elementType: 'labels', stylers: [{ visibility: 'on' }] },
    { elementType: 'geometry', stylers: [{ saturation: -35 }, { lightness: 18 }] },
  ],
  dark: [
    { elementType: 'geometry', stylers: [{ color: '#172033' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#172033' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#334155' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#475569' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f3b58' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#202b3c' }] },
    { featureType: 'transit.station', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
  ],
};

export default function NativeGoogleHomeMap({
  center,
  routes,
  contribution,
  start,
  destination,
  pickedDestination,
  userLocation,
  onMapClick,
  mapMode,
}: NativeGoogleHomeMapProps) {
  const elementRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerIdsRef = useRef<string[]>([]);
  const polylineIdsRef = useRef<string[]>([]);
  const clickHandlerRef = useRef(onMapClick);
  const [mapReady, setMapReady] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_ANDROID_API_KEY?.trim() || '';

  useEffect(() => { clickHandlerRef.current = onMapClick; }, [onMapClick]);

  useEffect(() => {
    document.documentElement.classList.add('native-google-map-active');
    document.body.classList.add('native-google-map-active');
    let cancelled = false;

    const create = async () => {
      if (!elementRef.current || !apiKey) return;
      const map = await GoogleMap.create({
        id: MAP_ID,
        element: elementRef.current,
        apiKey,
        forceCreate: true,
        config: {
          center: { lat: center.latitude, lng: center.longitude },
          zoom: center.zoom,
          androidLiteMode: false,
          mapTypeId: 'roadmap',
          styles: GOOGLE_MAP_STYLES[mapMode],
        },
      });
      if (cancelled) {
        await map.destroy();
        return;
      }
      mapRef.current = map;
      setMapReady(true);
      await SikkaMapUi.configure().catch(() => ({ configured: 0 }));
      await map.setOnMapClickListener((event) => clickHandlerRef.current({ lat: event.latitude, lng: event.longitude }));
    };

    void create().catch((error) => console.error('[native-google-map] create failed', error));
    return () => {
      cancelled = true;
      document.documentElement.classList.remove('native-google-map-active');
      document.body.classList.remove('native-google-map-active');
      const map = mapRef.current;
      mapRef.current = null;
      setMapReady(false);
      if (map) void map.destroy();
    };
    // A map is created exactly once for this mounted homepage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, mapMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void map.setCamera({ coordinate: { lat: center.latitude, lng: center.longitude }, zoom: center.zoom, animate: true });
  }, [center.latitude, center.longitude, center.zoom, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const redraw = async () => {
      if (polylineIdsRef.current.length) await map.removePolylines(polylineIdsRef.current);
      const polylines: Array<Polyline & { path: { lat: number; lng: number }[] }> = routes
        .filter((route) => route.coordinates.length >= 2)
        .map((route) => ({
          path: route.coordinates.map(([lng, lat]) => ({ lat, lng })),
          strokeColor: route.color,
          strokeOpacity: 0.95,
          strokeWeight: 6,
          geodesic: false,
          clickable: false,
          tag: route.id,
        }));
      if (contribution && contribution.length >= 2) {
        polylines.push({
          path: contribution.map(([lng, lat]) => ({ lat, lng })),
          strokeColor: '#258DFF',
          strokeOpacity: 0.95,
          strokeWeight: 6,
          geodesic: false,
          clickable: false,
          tag: 'discovery-recording',
        });
      }
      polylineIdsRef.current = polylines.length ? await map.addPolylines(polylines) : [];

      const allPoints = routes.flatMap((route) => route.coordinates);
      if (allPoints.length >= 2) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (const [lng, lat] of allPoints) {
          minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        }
        const bounds = new LatLngBounds({
          southwest: { lat: minLat, lng: minLng },
          northeast: { lat: maxLat, lng: maxLng },
          center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
        });
        await map.fitBounds(bounds, 80);
      }
    };
    void redraw().catch((error) => console.error('[native-google-map] polyline redraw failed', error));
  }, [routes, contribution, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const redraw = async () => {
      if (markerIdsRef.current.length) await map.removeMarkers(markerIdsRef.current);
      const markers: Marker[] = [];
      if (start) markers.push({ coordinate: start, title: 'Trip start', tintColor: { r: 37, g: 141, b: 255, a: 255 } });
      if (destination) markers.push({ coordinate: destination, title: 'Destination', tintColor: { r: 220, g: 38, b: 38, a: 255 } });
      if (pickedDestination) markers.push({ coordinate: pickedDestination, title: 'Chosen destination', tintColor: { r: 220, g: 38, b: 38, a: 255 } });
      if (userLocation) markers.push({ coordinate: userLocation, title: 'Your location', tintColor: { r: 59, g: 130, b: 246, a: 255 } });
      markerIdsRef.current = markers.length ? await map.addMarkers(markers) : [];
    };
    void redraw().catch((error) => console.error('[native-google-map] marker redraw failed', error));
  }, [start, destination, pickedDestination, userLocation, mapReady]);

  return (
    <div className="absolute inset-0 native-google-map-shell" aria-label="Sikka map">
      {!apiKey && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background p-6 text-center text-sm text-muted-foreground">
          Set VITE_GOOGLE_MAPS_ANDROID_API_KEY before building the Android app.
        </div>
      )}
      <capacitor-google-map
        ref={(element) => { elementRef.current = element; }}
        className="absolute inset-x-0 top-0 bottom-[-7rem] block w-full"
      />
    </div>
  );
}
