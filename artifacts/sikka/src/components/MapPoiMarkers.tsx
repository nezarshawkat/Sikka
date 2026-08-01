import { useEffect, useRef, useState, type RefObject } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import {
  Building2,
  Coffee,
  Fuel,
  Hotel,
  Landmark,
  MapPin,
  Pill,
  ShoppingBag,
  Trees,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

type ViewState = {
  latitude: number;
  longitude: number;
  zoom: number;
};

type OsmPoi = {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type PoiMarker = {
  id: number;
  lat: number;
  lng: number;
  name: string;
  kind: string;
};

type MapPoiMarkersProps = {
  mapRef: RefObject<MapRef | null>;
  viewState: ViewState;
  hidden?: boolean;
};

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MIN_POI_ZOOM = 15;
const MAX_POIS = 80;

const POI_COLOR: Record<string, string> = {
  food: '#F97316',
  cafe: '#A16207',
  pharmacy: '#16A34A',
  hospital: '#DC2626',
  fuel: '#2563EB',
  shopping: '#DB2777',
  hotel: '#7C3AED',
  landmark: '#0891B2',
  park: '#15803D',
  place: '#475569',
};

const POI_ICON: Record<string, LucideIcon> = {
  food: Utensils,
  cafe: Coffee,
  pharmacy: Pill,
  hospital: Building2,
  fuel: Fuel,
  shopping: ShoppingBag,
  hotel: Hotel,
  landmark: Landmark,
  park: Trees,
  place: MapPin,
};

function getKind(tags: Record<string, string> | undefined): string {
  const amenity = tags?.amenity;
  if (amenity === 'restaurant' || amenity === 'fast_food') return 'food';
  if (amenity === 'cafe') return 'cafe';
  if (amenity === 'pharmacy') return 'pharmacy';
  if (amenity === 'hospital' || amenity === 'clinic' || amenity === 'doctors') return 'hospital';
  if (amenity === 'fuel') return 'fuel';
  if (tags?.shop) return 'shopping';
  if (tags?.tourism === 'hotel') return 'hotel';
  if (tags?.tourism || amenity === 'bank' || amenity === 'atm') return 'landmark';
  if (tags?.leisure === 'park' || tags?.leisure === 'sports_centre') return 'park';
  return 'place';
}

function bboxKey(south: number, west: number, north: number, east: number) {
  return [
    Math.floor(south * 50) / 50,
    Math.floor(west * 50) / 50,
    Math.ceil(north * 50) / 50,
    Math.ceil(east * 50) / 50,
  ].join(',');
}

function buildOverpassQuery(south: number, west: number, north: number, east: number) {
  const bbox = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:8];
(
  node["amenity"~"restaurant|cafe|fast_food|pharmacy|hospital|clinic|doctors|bank|atm|fuel"]["name"](${bbox});
  node["shop"]["name"](${bbox});
  node["tourism"~"hotel|attraction|museum|gallery"]["name"](${bbox});
  node["leisure"~"park|sports_centre"]["name"](${bbox});
);
out body qt;
`;
}

function toPoiMarkers(elements: unknown): PoiMarker[] {
  if (!Array.isArray(elements)) return [];
  return (elements as OsmPoi[])
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon) && item.tags?.name)
    .slice(0, MAX_POIS)
    .map((item) => ({
      id: item.id,
      lat: item.lat,
      lng: item.lon,
      name: item.tags!.name,
      kind: getKind(item.tags),
    }));
}

export default function MapPoiMarkers({ mapRef, viewState, hidden = false }: MapPoiMarkersProps) {
  const [pois, setPois] = useState<PoiMarker[]>([]);
  const cacheRef = useRef(new Map<string, PoiMarker[]>());

  useEffect(() => {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (hidden || viewState.zoom < MIN_POI_ZOOM || offline) {
      setPois([]);
      return;
    }

    let controller: AbortController | null = null;
    const timeout = window.setTimeout(() => {
      const bounds = mapRef.current?.getMap().getBounds();
      if (!bounds) return;

      const south = bounds.getSouth();
      const west = bounds.getWest();
      const north = bounds.getNorth();
      const east = bounds.getEast();
      const key = bboxKey(south, west, north, east);
      const cached = cacheRef.current.get(key);
      if (cached) {
        setPois(cached);
        return;
      }

      controller = new AbortController();
      const query = buildOverpassQuery(south, west, north, east);
      fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json,text/plain,*/*',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          const next = toPoiMarkers(data?.elements);
          cacheRef.current.set(key, next);
          setPois(next);
        })
        .catch(() => {});
    }, 700);

    return () => {
      window.clearTimeout(timeout);
      controller?.abort();
    };
  }, [hidden, mapRef, viewState.latitude, viewState.longitude, viewState.zoom]);

  if (hidden || viewState.zoom < MIN_POI_ZOOM || pois.length === 0) return null;

  return (
    <>
      {pois.map((poi) => {
        const Icon = POI_ICON[poi.kind] ?? MapPin;
        const color = POI_COLOR[poi.kind] ?? POI_COLOR.place;
        return (
          <Marker key={`${poi.id}-${poi.kind}`} latitude={poi.lat} longitude={poi.lng} anchor="bottom">
            <div className="group flex flex-col items-center gap-1 pointer-events-auto" title={poi.name}>
              <div
                className="h-7 w-7 rounded-full border border-white/80 bg-background/95 shadow-md flex items-center justify-center"
                style={{ color }}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              {viewState.zoom >= 16 && (
                <span className="max-w-[7rem] rounded-full border border-white/70 bg-background/95 px-2 py-0.5 text-[10px] font-medium leading-tight text-foreground shadow-sm truncate">
                  {poi.name}
                </span>
              )}
            </div>
          </Marker>
        );
      })}
    </>
  );
}
