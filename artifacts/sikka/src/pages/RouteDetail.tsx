import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Map, { Source, Layer, type MapRef, type GeoJSONSource } from 'react-map-gl/maplibre';
import { ArrowLeft, Edit2, Trash2, MapPin, Clock, DollarSign, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import 'maplibre-gl/dist/maplibre-gl.css';

interface TransitLine {
  id: string; transportTypeId: string; lineNumber: string | null; nameEn: string; nameAr: string;
  fromArea: string; toArea: string; viaStops: string[]; routePath: { type: string; coordinates: [number, number][] } | null;
  stops: { name: string; lat: number; lng: number }[] | null;
  priceEgp: number; frequencyMinutes: number | null; hasFixedStops: boolean; isActive: boolean;
  governorate: string;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ';
const ICONS: Record<string, string> = {
  bus: '🚌', train: '🚆', car: '🚕', bike: '🛺', ship: '🚢', plane: '✈️', metro: '🚇', monorail: '🚝', walk: '🚶',
};

export default function RouteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mapRef = useRef<MapRef>(null);
  
  const [route, setRoute] = useState<TransitLine | null>(null);
  const [loading, setLoading] = useState(true);
  const [transportName, setTransportName] = useState('');
  const [viewState, setViewState] = useState({ latitude: 30.0444, longitude: 31.2357, zoom: 12 });

  useEffect(() => {
    async function loadRoute() {
      if (!id) return;
      try {
        const response = await api(`/transit-lines/${id}`);
        setRoute(response);
        
        // Get transport type name
        const types = await api('/transit-types');
        const type = types.find((t: any) => t.id === response.transportTypeId);
        setTransportName(type?.nameEn || '');
        
        // Fit map to route
        if (response.routePath?.coordinates?.length) {
          const coords = response.routePath.coordinates;
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          coords.forEach(([lng, lat]) => {
            minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
          });
          if (Number.isFinite(minLng)) {
            setViewState(v => ({ ...v, latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2 }));
          }
        }
      } catch (err) {
        console.error('Failed to load route:', err);
        toast.error('Failed to load route');
      } finally {
        setLoading(false);
      }
    }
    loadRoute();
  }, [id]);

  const handleDelete = async () => {
    if (!id || !route || !user?.isAdmin) return;
    if (!confirm('Are you sure you want to delete this route?')) return;
    
    try {
      await api(`/transit-lines/${id}`, { method: 'DELETE' });
      toast.success('Route deleted');
      navigate('/admin/map');
    } catch (err) {
      toast.error('Failed to delete route');
    }
  };

  const geojsonData = route?.routePath ? {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: route.routePath,
      properties: { id: route.id }
    }]
  } : null;

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-300">Loading route...</p>
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="text-center">
          <p className="text-slate-600 dark:text-slate-300 mb-4">Route not found</p>
          <Button onClick={() => navigate(-1)} variant="outline">Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{ICONS[transportName.toLowerCase()] || '🚌'}</span>
                <h1 className="text-xl font-bold">{route.lineNumber || 'Route'} - {route.nameEn}</h1>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">{route.nameAr}</p>
            </div>
          </div>
          {user?.isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <Edit2 className="w-4 h-4" />
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Map */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[2rem] overflow-hidden shadow-lg h-[400px]"
          >
            <Map
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={viewState}
              style={{ width: '100%', height: '100%' }}
              mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
            >
              {geojsonData && (
                <Source id="route-source" type="geojson" data={geojsonData}>
                  <Layer
                    id="route-layer"
                    type="line"
                    paint={{
                      'line-color': '#3B82F6',
                      'line-width': 3,
                      'line-opacity': 0.8,
                    }}
                  />
                </Source>
              )}
              
              {/* Route stops */}
              {route.stops && route.stops.length > 0 && (
                <Source
                  id="stops-source"
                  type="geojson"
                  data={{
                    type: 'FeatureCollection',
                    features: route.stops.map(stop => ({
                      type: 'Feature',
                      geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] },
                      properties: { name: stop.name }
                    }))
                  }}
                >
                  <Layer
                    id="stops-layer"
                    type="circle"
                    paint={{
                      'circle-radius': 6,
                      'circle-color': '#EC4899',
                      'circle-opacity': 0.9,
                      'circle-stroke-width': 2,
                      'circle-stroke-color': '#fff',
                    }}
                  />
                </Source>
              )}
            </Map>
          </motion.div>

          {/* Route Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-[2rem] bg-white dark:bg-slate-800 p-6 shadow-lg space-y-4"
          >
            <h2 className="text-lg font-bold">Route Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">From</p>
                <p className="font-semibold">{route.fromArea}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">To</p>
                <p className="font-semibold">{route.toArea}</p>
              </div>
            </div>
            {route.viaStops.length > 0 && (
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Via Stops</p>
                <p className="text-sm">{route.viaStops.join(', ')}</p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Key Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="rounded-[2rem] bg-white dark:bg-slate-800 p-6 shadow-lg space-y-4"
          >
            <h3 className="font-bold text-lg">Details</h3>
            
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-green-500" />
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Fare</p>
                  <p className="font-semibold">{route.priceEgp} EGP</p>
                </div>
              </div>

              {route.frequencyMinutes && (
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-blue-500" />
                  <div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">Frequency</p>
                    <p className="font-semibold">Every {route.frequencyMinutes} min</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <CheckCircle2 className={`w-5 h-5 ${route.isActive ? 'text-green-500' : 'text-red-500'}`} />
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Status</p>
                  <p className="font-semibold">{route.isActive ? 'Active' : 'Inactive'}</p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Fixed Stops</span>
                <span className="font-semibold">{route.hasFixedStops ? 'Yes' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Governorate</span>
                <span className="font-semibold">{route.governorate}</span>
              </div>
            </div>
          </motion.div>

          {/* Stops List */}
          {route.stops && route.stops.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="rounded-[2rem] bg-white dark:bg-slate-800 p-6 shadow-lg"
            >
              <h3 className="font-bold text-lg mb-4">Stops ({route.stops.length})</h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {route.stops.map((stop, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-slate-700 last:border-0"
                  >
                    <div className="flex-shrink-0 mt-1">
                      <MapPin className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{stop.name}</p>
                      <p className="text-xs text-slate-500">{stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
