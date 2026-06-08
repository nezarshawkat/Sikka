import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';

type RouteFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { color: string; name?: string | null };
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
};

interface RouteLayersProps {
  /** Unique source id; layers are derived as `${id}-line` and `${id}-labels`. */
  id: string;
  data: RouteFeatureCollection;
}

/**
 * Renders a trip route (line + line-number labels) by adding the maplibre
 * source/layers imperatively rather than via react-map-gl's <Source>/<Layer>
 * JSX. Some dev tooling injects metadata attributes onto JSX elements; react-map-gl forwards
 * those unknown props into the maplibre source/layer spec, which fails strict
 * validation ("unknown property") and silently drops the whole route. Building
 * the spec from plain object literals here sidesteps that entirely.
 */
export default function RouteLayers({ id, data }: RouteLayersProps) {
  const { current: mapInstance } = useMap();
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;

    const lineId = `${id}-line`;
    const labelId = `${id}-labels`;

    const ensure = () => {
      // styledata fires repeatedly while a style is still settling; guard against
      // transient "style not done loading" races so they don't surface as errors.
      if (!map.isStyleLoaded()) return;
      try {
        if (!map.getSource(id)) {
          map.addSource(id, { type: 'geojson', data: dataRef.current });
        }
        if (!map.getLayer(lineId)) {
          map.addLayer({
            id: lineId,
            type: 'line',
            source: id,
            paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.85 },
          });
        }
        if (!map.getLayer(labelId)) {
          map.addLayer({
            id: labelId,
            type: 'symbol',
            source: id,
            layout: {
              'symbol-placement': 'line',
              'symbol-spacing': 200,
              'text-field': ['get', 'name'],
              'text-size': 13,
              'text-font': ['Noto Sans Bold'],
            },
            paint: { 'text-color': '#fff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 3 },
          });
        }
      } catch {
        /* style mid-reload; the next styledata tick will retry */
      }
    };

    if (map.isStyleLoaded()) ensure();
    const retry = window.setTimeout(ensure, 150);
    // Re-add after any style (re)load, e.g. light/dark toggle wipes custom layers.
    map.on('load', ensure);
    map.on('idle', ensure);
    map.on('styledata', ensure);

    return () => {
      window.clearTimeout(retry);
      map.off('load', ensure);
      map.off('idle', ensure);
      map.off('styledata', ensure);
      try {
        if (map.getLayer(labelId)) map.removeLayer(labelId);
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        /* map already torn down */
      }
    };
  }, [mapInstance, id]);

  useEffect(() => {
    const map = mapInstance?.getMap();
    if (!map) return;
    const src = map.getSource(id) as { setData?: (d: RouteFeatureCollection) => void } | undefined;
    if (src?.setData) {
      src.setData(data);
    } else {
      // If React delivers data before MapLibre has finished loading the style,
      // nudge the mount effect by emitting on the next idle/style tick instead of
      // silently losing the route.
      window.setTimeout(() => {
        const late = map.getSource(id) as { setData?: (d: RouteFeatureCollection) => void } | undefined;
        late?.setData?.(data);
      }, 100);
    }
  }, [mapInstance, id, data]);

  return null;
}
