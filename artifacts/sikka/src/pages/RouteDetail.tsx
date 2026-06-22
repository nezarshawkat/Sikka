import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Map, { Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import {
  ArrowLeft, Trash2, MapPin, DollarSign, CheckCircle2,
  Maximize2, X, Save, ShieldAlert, RefreshCw, ArrowLeftRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { useMapStyle } from '@/hooks/useMapStyle';
import { toast } from 'sonner';
import 'maplibre-gl/dist/maplibre-gl.css';

interface TransitLine {
  id: string;
  transportTypeId: string;
  lineNumber: string | null;
  nameEn: string;
  nameAr: string;
  fromArea: string;
  toArea: string;
  viaStops: string[];
  routePath: { type: string; coordinates: [number, number][] } | null;
  routeDirection: string;
  priceEgp: number;
  frequencyMinutes: number | null;
  hasFixedStops: boolean;
  isActive: boolean;
  governorate: string;
  dataSource?: string;
  sourcePriority?: number;
  confidenceScore?: number;
  routeStatus?: 'active' | 'needs_review' | 'inactive' | 'pending_discovery';
  needsReviewReason?: string | null;
  reviewReportCount?: number;
  verifiedAt?: string | null;
  lastConfirmedAt?: string | null;
}

interface TransportType {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string;
  color: string;
}

const ICONS: Record<string, string> = {
  bus: '🚌', train: '🚆', car: '🚕', bike: '🛺', ship: '🚢', plane: '✈️', metro: '🚇', monorail: '🚝', walk: '🚶',
};

const CAIRO_CENTER = { latitude: 30.0444, longitude: 31.2357, zoom: 12 };

export default function RouteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, language } = useAuth();
  const { style: mapStyle } = useMapStyle();
  const previewMapRef = useRef<MapRef | null>(null);
  const fullMapRef = useRef<MapRef | null>(null);

  const [route, setRoute] = useState<TransitLine | null>(null);
  const [transportType, setTransportType] = useState<TransportType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [viewState, setViewState] = useState(CAIRO_CENTER);

  // Editable fields — all route management controls live in this single form
  const [form, setForm] = useState({
    lineNumber: '', nameEn: '', nameAr: '', fromArea: '', toArea: '',
    priceEgp: 0, frequencyMinutes: 0, hasFixedStops: false, isActive: true,
    routeDirection: 'forward',
  });

  const fitBoundsTo = (mapRef: React.RefObject<MapRef | null>, coords: [number, number][]) => {
    if (!coords.length || !mapRef.current) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    coords.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    });
    if (Number.isFinite(minLng)) {
      try { mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 48, duration: 500 }); } catch {}
    }
  };

  const loadRoute = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await api.get<TransitLine>(`/transit-lines/${id}`);
      setRoute(data);
      setForm({
        lineNumber: data.lineNumber || '',
        nameEn: data.nameEn || '',
        nameAr: data.nameAr || '',
        fromArea: data.fromArea || '',
        toArea: data.toArea || '',
        priceEgp: data.priceEgp ?? 0,
        frequencyMinutes: data.frequencyMinutes ?? 0,
        hasFixedStops: !!data.hasFixedStops,
        isActive: data.isActive !== false,
        routeDirection: data.routeDirection || 'forward',
      });

      const types = await api.get<TransportType[]>('/transport-types');
      setTransportType(types.find((t) => t.id === data.transportTypeId) ?? null);

      const coords = data.routePath?.coordinates;
      if (coords?.length) {
        const mid = coords[Math.floor(coords.length / 2)];
        setViewState((v) => ({ ...v, latitude: mid[1], longitude: mid[0] }));
      }
    } catch (err) {
      console.error('Failed to load route:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load route');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRoute(); }, [id]);

  useEffect(() => {
    const coords = route?.routePath?.coordinates;
    if (coords?.length) fitBoundsTo(previewMapRef, coords);
  }, [route, loading]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    const coords = route?.routePath?.coordinates;
    if (coords?.length) {
      // Give the dialog a tick to mount before measuring the map container
      const timeout = setTimeout(() => fitBoundsTo(fullMapRef, coords), 100);
      return () => clearTimeout(timeout);
    }
  }, [fullscreenOpen, route]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await api.put<TransitLine>(`/transit-lines/${id}`, {
        lineNumber: form.lineNumber || null,
        nameEn: form.nameEn,
        nameAr: form.nameAr,
        fromArea: form.fromArea,
        toArea: form.toArea,
        priceEgp: Number(form.priceEgp) || 0,
        frequencyMinutes: form.frequencyMinutes ? Number(form.frequencyMinutes) : null,
        hasFixedStops: form.hasFixedStops,
        isActive: form.isActive,
        routeDirection: form.routeDirection,
      });
      setRoute(updated);
      toast.success('Route updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: 'active' | 'needs_review' | 'inactive') => {
    if (!id) return;
    try {
      const updated = await api.put<TransitLine>(`/transit-lines/${id}`, {
        routeStatus: status,
        ...(status === 'active' ? { verifiedAt: new Date().toISOString(), needsReviewReason: null } : {}),
      });
      setRoute(updated);
      toast.success(`Route marked as ${status.replace('_', ' ')}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  // Flip the recorded direction: reverses the path geometry and swaps from/to areas.
  const handleFlipDirection = async () => {
    if (!id || !route?.routePath?.coordinates?.length) {
      toast.error('No route geometry to flip');
      return;
    }
    setSaving(true);
    try {
      const reversedCoords = [...route.routePath.coordinates].reverse();
      const updated = await api.put<TransitLine>(`/transit-lines/${id}`, {
        routePath: { type: 'LineString', coordinates: reversedCoords },
        fromArea: form.toArea,
        toArea: form.fromArea,
        routeDirection: form.routeDirection === 'forward' ? 'reverse' : 'forward',
      });
      setRoute(updated);
      setForm((f) => ({ ...f, fromArea: f.toArea, toArea: f.fromArea, routeDirection: updated.routeDirection }));
      toast.success('Direction flipped');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to flip direction');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !route || !user?.isAdmin) return;
    if (!confirm('Are you sure you want to delete this route? This cannot be undone.')) return;
    try {
      await api.delete(`/transit-lines/${id}`);
      toast.success('Route deleted');
      navigate('/admin/routes');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete route');
    }
  };

  const geojsonData = route?.routePath?.coordinates?.length ? {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      geometry: route.routePath as { type: 'LineString'; coordinates: [number, number][] },
      properties: { id: route.id },
    }],
  } : null;

  if (loading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading route...</p>
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">Route not found</p>
          <Button onClick={() => navigate(-1)} variant="outline">Go Back</Button>
        </div>
      </div>
    );
  }

  const renderRouteLine = () => (
    <Layer
      id="route-line"
      type="line"
      paint={{ 'line-color': transportType?.color || '#3B82F6', 'line-width': 4, 'line-opacity': 0.85 }}
    />
  );

  return (
    <div className="w-full min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-card/90 backdrop-blur-xl border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-muted rounded-lg transition">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{ICONS[transportType?.icon?.toLowerCase() || ''] || '🚌'}</span>
                <h1 className="text-lg font-bold">{route.lineNumber || 'Route'} — {route.nameEn}</h1>
              </div>
              <p className="text-xs text-muted-foreground">{route.nameAr}</p>
            </div>
          </div>
          {user?.isAdmin && (
            <Button variant="destructive" size="sm" onClick={handleDelete} className="gap-2">
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Small embedded preview map — clicking it opens the full-screen interactive map */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative rounded-[1.5rem] overflow-hidden shadow-lg h-56 border cursor-pointer group"
            onClick={() => setFullscreenOpen(true)}
          >
            <Map
              ref={previewMapRef}
              {...viewState}
              onMove={(evt) => setViewState(evt.viewState)}
              style={{ width: '100%', height: '100%' }}
              mapStyle={mapStyle}
              interactive={false}
              attributionControl={false}
            >
              {geojsonData && (
                <Source id="route-source-preview" type="geojson" data={geojsonData}>
                  {renderRouteLine()}
                </Source>
              )}
            </Map>
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3 shadow-lg">
                <Maximize2 className="w-5 h-5 text-foreground" />
              </div>
            </div>
            {!geojsonData && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/60">
                <p className="text-sm text-muted-foreground">No route geometry recorded yet</p>
              </div>
            )}
          </motion.div>

          {/* Route management form — all controls in one place */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-[1.5rem] bg-card p-6 shadow-sm border space-y-4"
          >
            <h2 className="text-base font-bold">Route Information</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Line number</Label>
                <Input value={form.lineNumber} onChange={(e) => setForm((f) => ({ ...f, lineNumber: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Price (EGP)</Label>
                <Input
                  type="number"
                  value={form.priceEgp}
                  onChange={(e) => setForm((f) => ({ ...f, priceEgp: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Name (English)</Label>
                <Input value={form.nameEn} onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Name (Arabic)</Label>
                <Input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} dir="rtl" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From area</Label>
                <Input value={form.fromArea} onChange={(e) => setForm((f) => ({ ...f, fromArea: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To area</Label>
                <Input value={form.toArea} onChange={(e) => setForm((f) => ({ ...f, toArea: e.target.value }))} />
              </div>
            </div>

            {/* Direction control */}
            <div className="flex items-center justify-between rounded-xl border p-3 bg-muted/30">
              <div>
                <p className="text-xs font-medium text-foreground">Route direction</p>
                <p className="text-xs text-muted-foreground">
                  Path runs {form.routeDirection === 'forward' ? `${form.fromArea} → ${form.toArea}` : `${form.fromArea} → ${form.toArea} (reversed)`}
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleFlipDirection} disabled={saving}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Flip
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Frequency (minutes)</Label>
                <Input
                  type="number"
                  value={form.frequencyMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, frequencyMinutes: Number(e.target.value) }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">Fixed stops</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch checked={form.hasFixedStops} onCheckedChange={(v) => setForm((f) => ({ ...f, hasFixedStops: v }))} />
                  <span className="text-sm text-muted-foreground">{form.hasFixedStops ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="text-xs font-medium text-foreground">Active / bookable</p>
                <p className="text-xs text-muted-foreground">Whether this route is offered in trip plans</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>

            {route.viaStops?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Via stops</p>
                <p className="text-sm">{route.viaStops.join(', ')}</p>
              </div>
            )}

            <Button className="w-full gap-2" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </motion.div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-[1.5rem] bg-card p-6 shadow-sm border space-y-4"
          >
            <h3 className="font-bold text-base">Status & quality</h3>

            <div className="flex flex-wrap gap-1">
              <Badge variant={route.routeStatus === 'needs_review' ? 'destructive' : 'secondary'}>
                {route.routeStatus ?? 'active'}
              </Badge>
              <Badge variant="outline">{route.dataSource ?? 'seed'} · {route.sourcePriority ?? 10}</Badge>
            </div>

            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
                Confidence: {Math.round((route.confidenceScore ?? 0.6) * 100)}%
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="h-4 w-4" />
                {route.priceEgp} EGP
              </p>
              <p className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {route.routePath ? `${route.routePath.coordinates.length} GPS points` : 'No geometry'}
              </p>
              <p className="text-xs text-muted-foreground">Reports: {route.reviewReportCount ?? 0}</p>
              {route.needsReviewReason && (
                <p className="flex gap-1 text-yellow-600 text-xs">
                  <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
                  {route.needsReviewReason}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {route.routeStatus !== 'active' && (
                <Button size="sm" onClick={() => updateStatus('active')}>Verify active</Button>
              )}
              {route.routeStatus !== 'needs_review' && (
                <Button size="sm" variant="outline" onClick={() => updateStatus('needs_review')}>Mark needs review</Button>
              )}
              {route.routeStatus !== 'inactive' && (
                <Button size="sm" variant="outline" onClick={() => updateStatus('inactive')}>Deactivate</Button>
              )}
              <Button size="sm" variant="ghost" className="gap-2" onClick={() => void loadRoute()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Full-screen interactive map */}
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-none w-screen h-screen p-0 rounded-none border-none">
          <button
            onClick={() => setFullscreenOpen(false)}
            className="absolute top-4 right-4 z-50 bg-white/90 rounded-full p-2 shadow-lg"
          >
            <X className="w-5 h-5" />
          </button>
          <Map
            ref={fullMapRef}
            {...viewState}
            onMove={(evt) => setViewState(evt.viewState)}
            style={{ width: '100%', height: '100%' }}
            mapStyle={mapStyle}
            attributionControl={false}
          >
            {geojsonData && (
              <Source id="route-source-full" type="geojson" data={geojsonData}>
                {renderRouteLine()}
              </Source>
            )}
          </Map>
        </DialogContent>
      </Dialog>
    </div>
  );
}
