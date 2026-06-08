import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Plus, Eye, EyeOff, Pencil, Trash2, Save, Flame, MapPin, Route as RouteIcon } from 'lucide-react';
import Map, { Source, Layer, Marker, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE_DARK } from '@/hooks/useIsDark';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibmV6YXJpc21haWwiLCJhIjoiY21ucTdoZ3gxMDRiNzJxcjRhemY0ejhhbyJ9.fkkcuisxpZP9y0Uaq9HryQ';
const CAIRO = { latitude: 30.0444, longitude: 31.2357, zoom: 11 };
const ROUTE_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1'];

interface TransportType {
  id: string; nameEn: string; nameAr: string; icon: string; color: string; serviceLevel: string;
}
interface TransitLine {
  id: string; transportTypeId: string; lineNumber: string | null; nameEn: string; nameAr: string;
  fromArea: string; toArea: string; viaStops: string[]; routePath: GeoJSONLineString | null;
  stops: { name: string; lat: number; lng: number }[] | null;
  priceEgp: number; frequencyMinutes: number | null; hasFixedStops: boolean; isActive: boolean;
  governorate: string;
}
interface HeatmapPoint {
  id: string; transportTypeId: string; latitude: number; longitude: number; intensity: number; radiusKm: number;
}
interface Mawaqef {
  id: string; nameEn: string; nameAr: string; city: string; latitude: number; longitude: number; transportTypeIds: string[];
}

const ICONS: Record<string, string> = {
  bus: '🚌', train: '🚆', car: '🚕', bike: '🛺', ship: '🚢', plane: '✈️', metro: '🚇', monorail: '🚝', walk: '🚶',
};

async function snapToRoads(points: [number, number][]): Promise<[number, number][]> {
  if (points.length < 2) return points;
  const chunks: [number, number][][] = [];
  for (let i = 0; i < points.length; i += 24) {
    const chunk = points.slice(i, i + 25);
    if (chunk.length >= 2) chunks.push(chunk);
    else if (chunks.length > 0) chunks[chunks.length - 1].push(...chunk);
  }

  let allCoords: [number, number][] = [];
  for (const chunk of chunks) {
    const coordStr = chunk.map(p => `${p[0]},${p[1]}`).join(';');
    try {
      const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`);
      const data = await res.json();
      const coords = data.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined;
      if (coords?.length) allCoords = allCoords.length ? [...allCoords, ...coords.slice(1)] : coords;
      else allCoords.push(...chunk);
    } catch (err) {
      console.error('Road snap error:', err);
      allCoords.push(...chunk);
    }
  }
  return allCoords;
}

const AdminMap = () => {
  const { language } = useAuth();
  const [viewState, setViewState] = useState(CAIRO);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [transitLines, setTransitLines] = useState<TransitLine[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [mawaqef, setMawaqef] = useState<Mawaqef[]>([]);

  const [activeTypeId, setActiveTypeId] = useState('all');
  const [activeGovernorate, setActiveGovernorate] = useState('all');
  const [activeStationId, setActiveStationId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<TransitLine | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isHeatmapEditing, setIsHeatmapEditing] = useState(false);
  const [listVisible, setListVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [isSnapping, setIsSnapping] = useState(false);
  const [generatedPaths, setGeneratedPaths] = useState<Record<string, GeoJSONLineString>>({});
  const generatingRef = useRef(new Set<string>());
  const geocodeCacheRef = useRef<Record<string, [number, number] | null>>({});

  const [showForm, setShowForm] = useState(false);
  const [editingLine, setEditingLine] = useState<TransitLine | null>(null);
  const [formData, setFormData] = useState({
    transportTypeId: '', lineNumber: '', nameEn: '', nameAr: '',
    fromArea: '', toArea: '', viaStops: '', priceEgp: 5,
    frequencyMinutes: 10, hasFixedStops: false,
  });
  const [detailLine, setDetailLine] = useState<TransitLine | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tt, tl, hm, mw] = await Promise.all([
        api.get('/transport-types'),
        api.get('/transit-lines'),
        api.get('/heatmaps'),
        api.get('/mawaqef'),
      ]);
      setTransportTypes((tt || []) as TransportType[]);
      setTransitLines((tl || []) as TransitLine[]);
      setHeatmapData((hm || []) as HeatmapPoint[]);
      setMawaqef((mw || []) as Mawaqef[]);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to load data'); }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tuktukType = transportTypes.find(t => t.nameEn.toLowerCase().includes('tuk'));
  const whiteTaxiType = transportTypes.find(t => t.nameEn.toLowerCase().includes('white taxi'));
  const heatmapOnlyTypes = [tuktukType, whiteTaxiType].filter(Boolean);

  const governorateOptions = useMemo(() => {
    // Always offer Cairo so the selector is usable even before any line carries
    // an explicit governorate value.
    const set = new Set<string>(['Cairo']);
    transitLines.forEach(line => { if (line.governorate) set.add(line.governorate); });
    return Array.from(set).sort();
  }, [transitLines]);

  const stationOptions = useMemo(() => {
    const set = new Set<string>();
    transitLines.forEach(line => {
      if (activeGovernorate !== 'all' && (line.governorate || '').toLowerCase() !== activeGovernorate) return;
      [line.fromArea, line.toArea, ...(line.viaStops || [])].forEach(s => { if (s && s.trim()) set.add(s.trim()); });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, language === 'ar' ? 'ar' : 'en'));
  }, [transitLines, activeGovernorate, language]);

  const geocodeStop = useCallback(async (stop: string): Promise<[number, number] | null> => {
    const key = stop.trim().toLowerCase();
    if (key in geocodeCacheRef.current) return geocodeCacheRef.current[key];
    try {
      // Cairo center for proximity bias: 30.0444, 31.2357
      const query = `${stop.trim()}, Cairo, Egypt`;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
        + `?access_token=${MAPBOX_TOKEN}`
        + `&country=eg`
        + `&language=ar,en`
        + `&limit=3`
        + `&proximity=31.2357,30.0444`
        + `&types=poi,address,neighborhood,locality,place,district`;
      const res = await fetch(url);
      const data = await res.json();
      // Prefer results within ~50km of Cairo center
      const features = data.features as Array<{ center: [number, number]; relevance: number }> | undefined;
      const inCairo = features?.find(f => {
        const [lng, lat] = f.center;
        return Math.abs(lat - 30.0444) < 0.5 && Math.abs(lng - 31.2357) < 0.5;
      });
      const center = (inCairo || features?.[0])?.center;
      geocodeCacheRef.current[key] = center || null;
      return center || null;
    } catch (err) {
      console.error('Stop geocoding error:', err);
      geocodeCacheRef.current[key] = null;
      return null;
    }
  }, []);

  const buildPathFromLineText = useCallback(async (line: Pick<TransitLine, 'fromArea' | 'toArea' | 'viaStops'>) => {
    const stopNames = [line.fromArea, ...(line.viaStops || []), line.toArea]
      .map(s => s?.trim()).filter(Boolean)
      .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i)
      .slice(0, 12);
    const points: [number, number][] = [];
    for (const stop of stopNames) {
      const point = await geocodeStop(stop);
      if (point) points.push(point);
    }
    if (points.length < 2) return null;
    const snapped = await snapToRoads(points);
    return { type: 'LineString', coordinates: snapped };
  }, [geocodeStop]);

  const filteredLines = useMemo(() => {
    return transitLines.filter(line => {
      const typeMatch = activeTypeId === 'all' || line.transportTypeId === activeTypeId;
      const govMatch = activeGovernorate === 'all' || (line.governorate || '').toLowerCase() === activeGovernorate;
      const stationMatch = activeStationId === 'all' || [line.fromArea, line.toArea, ...(line.viaStops || [])].some(s => s.trim() === activeStationId);
      const q = searchQuery.trim().toLowerCase();
      const searchMatch = !q ||
        (line.lineNumber ?? '').toLowerCase().includes(q) ||
        line.nameEn.toLowerCase().includes(q) ||
        line.nameAr.includes(searchQuery) ||
        line.fromArea.toLowerCase().includes(q) ||
        line.toArea.toLowerCase().includes(q) ||
        line.viaStops.some(s => s.toLowerCase().includes(q));
      return typeMatch && govMatch && stationMatch && searchMatch;
    });
  }, [activeTypeId, activeGovernorate, activeStationId, searchQuery, transitLines]);

  useEffect(() => {
    const limit = activeTypeId === 'all' && !searchQuery && activeStationId === 'all' ? 25 : 45;
    const missing = filteredLines
      .filter(line => !line.routePath?.coordinates?.length && !generatedPaths[line.id] && !generatingRef.current.has(line.id))
      .slice(0, limit);
    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      for (const line of missing) {
        if (cancelled) break;
        generatingRef.current.add(line.id);
        const path = await buildPathFromLineText(line);
        generatingRef.current.delete(line.id);
        if (path?.coordinates?.length && !cancelled) {
          setGeneratedPaths(prev => ({ ...prev, [line.id]: path }));
          api.put(`/transit-lines/${line.id}`, { routePath: path }).catch(() => undefined);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeTypeId, buildPathFromLineText, filteredLines, generatedPaths, searchQuery, activeStationId]);

  const getLineGeometry = (line: TransitLine) => line.routePath?.coordinates?.length ? line.routePath : generatedPaths[line.id];
  const visibleLines = filteredLines.filter(line => getLineGeometry(line));

  const getRouteColor = (line: TransitLine, index: number) => {
    if (activeTypeId !== 'all') return ROUTE_COLORS[index % ROUTE_COLORS.length];
    return transportTypes.find(t => t.id === line.transportTypeId)?.color || '#3B82F6';
  };

  const routesGeoJSON = {
    type: 'FeatureCollection' as const,
    features: visibleLines.map((line, idx) => ({
      type: 'Feature' as const,
      properties: { id: line.id, color: getRouteColor(line, idx), name: line.lineNumber || line.fromArea, selected: selectedLine?.id === line.id ? 1 : 0 },
      geometry: getLineGeometry(line),
    })),
  };

  const heatmapTypeIds = heatmapOnlyTypes.map(t => t!.id);
  const heatmapGeoJSON = {
    type: 'FeatureCollection' as const,
    features: heatmapData
      .filter(h => heatmapTypeIds.includes(h.transportTypeId))
      .map(h => ({ type: 'Feature' as const, properties: { intensity: h.intensity }, geometry: { type: 'Point' as const, coordinates: [h.longitude, h.latitude] } })),
  };

  const drawGeoJSON = {
    type: 'FeatureCollection' as const,
    features: drawPoints.length >= 2 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: drawPoints } }] : [],
  };

  const getTypeName = (id: string) => {
    if (id === 'all') return 'All';
    const tt = transportTypes.find(t => t.id === id);
    return language === 'ar' ? tt?.nameAr : tt?.nameEn;
  };

  const addHeatPoint = async (lng: number, lat: number) => {
    const heatTypeId = (whiteTaxiType && activeTypeId === whiteTaxiType.id)
      ? whiteTaxiType.id
      : tuktukType?.id;
    if (!heatTypeId) return;
    try {
      const typeName = transportTypes.find(t => t.id === heatTypeId)?.nameEn || 'Heat point';
      await api.post('/heatmaps', { transportTypeId: heatTypeId, longitude: lng, latitude: lat, intensity: 0.75, radiusKm: 1.5 });
      toast.success(`${typeName} heat point added`);
      fetchData();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to add heat point'); }
  };

  const deleteHeatPoint = async (id: string) => {
    try {
      await api.delete(`/heatmaps/${id}`);
      toast.success('Heat point removed');
      fetchData();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to delete heat point'); }
  };

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    if (isDrawing) {
      setDrawPoints(prev => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
      return;
    }
    if (isHeatmapEditing) {
      addHeatPoint(e.lngLat.lng, e.lngLat.lat);
      return;
    }
    const features = e.target?.queryRenderedFeatures?.(e.point, { layers: ['route-lines'] });
    if (features?.length > 0) {
      const lineId = features[0].properties?.id;
      const line = transitLines.find(l => l.id === lineId);
      if (line) { setSelectedLine(line); setDetailLine(line); }
    }
  }, [isDrawing, isHeatmapEditing, transitLines]);

  const openNewForm = () => {
    if (activeTypeId !== 'all' && heatmapOnlyTypes.some(t => t?.id === activeTypeId)) {
      setShowHeatmap(true);
      setIsHeatmapEditing(true);
      const typeName = transportTypes.find(t => t.id === activeTypeId)?.nameEn || 'This transport';
      toast.info(`${typeName} is managed as editable heatmap zones, not fixed routes`);
      return;
    }
    setEditingLine(null);
    setFormData({
      transportTypeId: activeTypeId !== 'all' ? activeTypeId : '',
      lineNumber: '', nameEn: '', nameAr: '',
      fromArea: '', toArea: '', viaStops: '', priceEgp: 5,
      frequencyMinutes: 10, hasFixedStops: false,
    });
    setDrawPoints([]);
    setShowForm(true);
  };

  const openEditForm = (line: TransitLine) => {
    setEditingLine(line);
    setFormData({
      transportTypeId: line.transportTypeId,
      lineNumber: line.lineNumber ?? '',
      nameEn: line.nameEn,
      nameAr: line.nameAr,
      fromArea: line.fromArea,
      toArea: line.toArea,
      viaStops: line.viaStops.join(', '),
      priceEgp: line.priceEgp,
      frequencyMinutes: line.frequencyMinutes || 10,
      hasFixedStops: line.hasFixedStops,
    });
    const geom = getLineGeometry(line);
    setDrawPoints(geom?.coordinates || []);
    setShowForm(true);
  };

  const saveRoute = async () => {
    if (!formData.transportTypeId || !formData.lineNumber || !formData.fromArea || !formData.toArea) {
      toast.error('Fill required fields');
      return;
    }
    if (heatmapOnlyTypes.some(t => t?.id === formData.transportTypeId)) {
      toast.error('This transport type uses the heatmap editor instead of fixed routes');
      return;
    }

    setIsSnapping(true);
    let routePath = null;
    try {
      if (drawPoints.length >= 2) routePath = { type: 'LineString', coordinates: await snapToRoads(drawPoints) };
      else routePath = await buildPathFromLineText({ fromArea: formData.fromArea, toArea: formData.toArea, viaStops: formData.viaStops ? formData.viaStops.split(',').map(s => s.trim()).filter(Boolean) : [] });
    } finally {
      setIsSnapping(false);
    }

    const payload = {
      transportTypeId: formData.transportTypeId,
      lineNumber: formData.lineNumber,
      nameEn: formData.nameEn || `${formData.lineNumber}: ${formData.fromArea} to ${formData.toArea}`,
      nameAr: formData.nameAr || `${formData.lineNumber}: ${formData.fromArea} - ${formData.toArea}`,
      fromArea: formData.fromArea,
      toArea: formData.toArea,
      viaStops: formData.viaStops ? formData.viaStops.split(',').map(s => s.trim()).filter(Boolean) : [],
      priceEgp: formData.priceEgp,
      frequencyMinutes: formData.frequencyMinutes,
      hasFixedStops: formData.hasFixedStops,
      routePath,
    };

    try {
      if (editingLine) {
        await api.put(`/transit-lines/${editingLine.id}`, payload);
      } else {
        await api.post('/transit-lines', payload);
      }
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to save route'); return; }
    toast.success(editingLine ? 'Route updated and snapped to roads' : 'Route added and snapped to roads');
    setShowForm(false);
    setDrawPoints([]);
    setIsDrawing(false);
    setEditingLine(null);
    fetchData();
  };

  const deleteLine = async (id: string) => {
    try {
      await api.delete(`/transit-lines/${id}`);
      toast.success('Deleted');
      setDetailLine(null);
      setSelectedLine(null);
      fetchData();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to delete route'); }
  };

  if (isLoading) return <div className="flex items-center justify-center h-96"><div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 -m-4 relative">
      <div className={`${listVisible ? 'w-80' : 'w-0'} transition-all duration-300 overflow-hidden bg-card border-r flex flex-col z-10`}>
        <div className="p-3 border-b space-y-1">
          <p className="text-sm font-semibold">{getTypeName(activeTypeId) || 'All'} Routes ({filteredLines.length})</p>
          <p className="text-xs text-muted-foreground">{visibleLines.length} visible on map · text routes auto-snap to streets</p>
        </div>
        {activeStationId !== 'all' && (
          <div className="p-3 border-b bg-muted/40">
            <p className="text-xs text-muted-foreground">Station</p>
            <p className="text-sm font-medium">{activeStationId}</p>
            <p className="text-xs text-muted-foreground">{filteredLines.length} connected routes</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {filteredLines.length === 0 && <p className="text-sm text-muted-foreground p-4 text-center">No routes</p>}
          {filteredLines.map((line, idx) => {
            const tt = transportTypes.find(t => t.id === line.transportTypeId);
            const color = getRouteColor(line, idx);
            const hasPath = Boolean(getLineGeometry(line));
            return (
              <div
                key={line.id}
                className={`p-3 border-b cursor-pointer hover:bg-accent/30 transition-colors ${selectedLine?.id === line.id ? 'bg-accent/50' : ''}`}
                onClick={() => {
                  setSelectedLine(selectedLine?.id === line.id ? null : line);
                  setDetailLine(line);
                  const coords = getLineGeometry(line)?.coordinates;
                  if (coords?.[0]) {
                    const mid = coords[Math.floor(coords.length / 2)];
                    setViewState(v => ({ ...v, latitude: mid[1], longitude: mid[0], zoom: 13 }));
                  }
                }}
              >
                <div className="flex items-start gap-2">
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm shrink-0" style={{ backgroundColor: `${tt?.color || color}20`, border: `2px solid ${tt?.color || color}` }}>
                    {ICONS[tt?.icon || 'bus']}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-1 py-0" style={{ borderColor: color, color }}>{line.lineNumber || 'Route'}</Badge>
                      <span className="text-xs truncate">{line.fromArea} → {line.toArea}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{line.viaStops.slice(0, 4).join(' · ')}</p>
                    <p className="text-[10px] text-muted-foreground">{line.priceEgp} EGP · {hasPath ? 'mapped' : 'drawing from stops...'}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 relative">
        <div className="absolute top-3 left-3 right-3 z-10 space-y-2">
          <div className="grid grid-cols-[auto_1fr_auto] gap-2">
            <Button size="sm" variant="outline" className="h-10 w-10 p-0 bg-card/95 backdrop-blur-sm" onClick={() => setListVisible(!listVisible)}>
              {listVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search route number, station, or road..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-10 text-sm bg-card/95 backdrop-blur-sm" />
            </div>
            <Button size="sm" className="h-10 gap-1 bg-card/95 backdrop-blur-sm text-foreground border border-border hover:bg-accent" onClick={openNewForm}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Select value={activeTypeId} onValueChange={value => { setActiveTypeId(value); setSelectedLine(null); if (value === tuktukType?.id) setShowHeatmap(true); }}>
              <SelectTrigger className="h-10 bg-card/95 backdrop-blur-sm"><SelectValue placeholder="Transport type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All transport types</SelectItem>
                {transportTypes.map(tt => <SelectItem key={tt.id} value={tt.id}>{ICONS[tt.icon] || '🚌'} {tt.nameEn}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={activeGovernorate} onValueChange={value => { setActiveGovernorate(value); setActiveStationId('all'); }}>
              <SelectTrigger className="h-10 bg-card/95 backdrop-blur-sm"><SelectValue placeholder="Governorate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All governorates</SelectItem>
                {governorateOptions.map(g => <SelectItem key={g} value={g.toLowerCase()}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={activeStationId} onValueChange={setActiveStationId}>
              <SelectTrigger className="h-10 bg-card/95 backdrop-blur-sm"><SelectValue placeholder="Stations / المواقف" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stations and terminals</SelectItem>
                {stationOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {heatmapOnlyTypes.some(t => t?.id === activeTypeId) && (
            <div className="flex gap-2">
              <Button size="sm" variant={showHeatmap ? 'default' : 'outline'} className="h-9 gap-1 bg-card/95 backdrop-blur-sm" onClick={() => setShowHeatmap(!showHeatmap)}>
                <Flame className="h-3.5 w-3.5" /> {transportTypes.find(t => t.id === activeTypeId)?.nameEn || 'Heatmap'}
              </Button>
              <Button size="sm" variant={isHeatmapEditing ? 'destructive' : 'outline'} className="h-9 bg-card/95 backdrop-blur-sm" onClick={() => { setShowHeatmap(true); setIsHeatmapEditing(!isHeatmapEditing); }}>
                {isHeatmapEditing ? 'Done editing' : 'Edit heatmap'}
              </Button>
            </div>
          )}
        </div>

        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          onClick={handleMapClick}
          mapStyle={MAP_STYLE_DARK}
          style={{ width: '100%', height: '100%' }}
          cursor={isDrawing || isHeatmapEditing ? 'crosshair' : 'grab'}
          interactiveLayerIds={routesGeoJSON.features.length ? ['route-lines'] : []}
          attributionControl={false}
        >

          {routesGeoJSON.features.length > 0 && (
            <Source id="routes" type="geojson" data={routesGeoJSON}>
              <Layer id="route-lines" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 6, 3], 'line-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.78] }} />
              <Layer id="route-labels" type="symbol"
                layout={{
                  'symbol-placement': 'line',
                  'symbol-spacing': 220,
                  'text-field': ['get', 'name'],
                  'text-size': 14,
                  'text-font': ['Noto Sans Bold'],
                  'text-allow-overlap': false,
                  'text-padding': 4,
                  'text-keep-upright': true,
                }}
                paint={{
                  'text-color': '#ffffff',
                  'text-halo-color': ['get', 'color'],
                  'text-halo-width': 3,
                  'text-halo-blur': 0.5,
                }} />
            </Source>
          )}

          {drawPoints.length >= 2 && (
            <Source id="drawing" type="geojson" data={drawGeoJSON}>
              <Layer id="draw-line" type="line" paint={{ 'line-color': '#FF6B6B', 'line-width': 4, 'line-dasharray': [2, 2] }} />
            </Source>
          )}
          {isDrawing && drawPoints.map((pt, i) => (
            <Marker key={`dp-${i}`} latitude={pt[1]} longitude={pt[0]}><div className="h-3 w-3 rounded-full bg-destructive border border-background" /></Marker>
          ))}

          {showHeatmap && heatmapGeoJSON.features.length > 0 && (
            <Source id="heatmap" type="geojson" data={heatmapGeoJSON}>
              <Layer id="heatmap-layer" type="heatmap" paint={{
                'heatmap-weight': ['get', 'intensity'], 'heatmap-intensity': 1, 'heatmap-radius': 42, 'heatmap-opacity': 0.65,
                'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(255,165,0,0.3)', 0.5, 'rgba(255,140,0,0.5)', 0.8, 'rgba(255,69,0,0.7)', 1, 'rgba(255,0,0,0.9)'],
              }} />
            </Source>
          )}

          {showHeatmap && isHeatmapEditing && heatmapData.filter(h => heatmapTypeIds.includes(h.transportTypeId)).map(h => (
            <Marker key={h.id} latitude={h.latitude} longitude={h.longitude}>
              <button onClick={e => { e.stopPropagation(); deleteHeatPoint(h.id); }} className="h-7 w-7 rounded-full bg-destructive text-destructive-foreground text-xs shadow-lg border border-background">×</button>
            </Marker>
          ))}

          {mawaqef.map(station => (
            <Marker key={station.id} latitude={station.latitude} longitude={station.longitude}>
              <button
                onClick={e => { e.stopPropagation(); setViewState(v => ({ ...v, latitude: station.latitude, longitude: station.longitude, zoom: 13 })); }}
                className="h-2.5 w-2.5 rounded-full bg-primary border-2 border-background shadow"
                title={station.nameEn || station.nameAr || 'Station'}
                aria-label={station.nameEn || station.nameAr || 'Station'}
              />
            </Marker>
          ))}

          {visibleLines.map((line, idx) => {
            const coords = getLineGeometry(line)?.coordinates;
            if (!coords?.length) return null;
            const mid = coords[Math.floor(coords.length / 2)];
            const tt = transportTypes.find(t => t.id === line.transportTypeId);
            const color = getRouteColor(line, idx);
            return (
              <Marker key={`icon-${line.id}`} latitude={mid[1]} longitude={mid[0]}>
                <button onClick={e => { e.stopPropagation(); setDetailLine(line); setSelectedLine(line); }} className="group">
                  <div className="flex items-center px-2 py-1 rounded-full shadow-lg border-2 border-background group-hover:scale-110 transition-transform" style={{ backgroundColor: color }}>
                    <span className="text-[11px] font-bold text-white whitespace-nowrap">{line.lineNumber || tt?.nameEn?.slice(0, 6)}</span>
                  </div>
                </button>
              </Marker>
            );
          })}

          {/* Stops of the selected line — rendered as small ordered markers */}
          {selectedLine?.stops?.map((s, i) => (
            <Marker key={`stop-${selectedLine.id}-${i}`} latitude={s.lat} longitude={s.lng}>
              <div title={s.name} className="h-2.5 w-2.5 rounded-full bg-background border-2 shadow" style={{ borderColor: getRouteColor(selectedLine, 0) }} />
            </Marker>
          ))}
        </Map>

        {isDrawing && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card/95 backdrop-blur-sm rounded-xl shadow-xl p-3 flex items-center gap-3 z-10">
            <span className="text-sm font-medium">Click the real route points ({drawPoints.length})</span>
            {drawPoints.length > 0 && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDrawPoints(prev => prev.slice(0, -1))}>Undo</Button>}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDrawPoints([])}>Clear</Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => { setIsDrawing(false); setShowForm(true); }}>Done</Button>
          </div>
        )}
      </div>

      <Dialog open={!!detailLine} onOpenChange={open => !open && setDetailLine(null)}>
        <DialogContent className="max-w-md">
          {detailLine && (() => {
            const tt = transportTypes.find(t => t.id === detailLine.transportTypeId);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm" style={{ backgroundColor: `${tt?.color || '#3B82F6'}20`, border: `2px solid ${tt?.color || '#3B82F6'}` }}>{ICONS[tt?.icon || 'bus']}</div>
                    <div><span className="text-base">{detailLine.lineNumber || detailLine.fromArea}</span><span className="text-sm text-muted-foreground ml-2">{tt?.nameEn}</span></div>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">From</span><span className="text-right">{detailLine.fromArea}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">To</span><span className="text-right">{detailLine.toArea}</span></div>
                  {detailLine.stops && detailLine.stops.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between mb-1"><span className="text-muted-foreground">Stops ({detailLine.stops.length})</span></div>
                      <ol className="max-h-48 overflow-y-auto rounded-md border divide-y bg-muted/30">
                        {detailLine.stops.map((s, i) => (
                          <li key={i} className="flex items-center gap-2 px-2 py-1 text-xs">
                            <span className="h-4 w-4 shrink-0 rounded-full bg-background border flex items-center justify-center text-[9px] text-muted-foreground">{i + 1}</span>
                            <span className="truncate">{s.name}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : detailLine.viaStops.length > 0 ? (
                    <div><span className="text-muted-foreground">Via: </span><span>{detailLine.viaStops.join(' → ')}</span></div>
                  ) : null}
                  <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span>{detailLine.priceEgp} EGP</span></div>
                  {detailLine.frequencyMinutes && <div className="flex justify-between"><span className="text-muted-foreground">Frequency</span><span>Every {detailLine.frequencyMinutes} min</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">Stops</span><span>{detailLine.hasFixedStops ? 'Fixed stops' : 'Stop anywhere'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Map</span><span>{getLineGeometry(detailLine) ? 'Visible route path' : 'Generating from stops'}</span></div>
                </div>
                <DialogFooter className="gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
                    toast.info('Regenerating path along real streets...');
                    const path = await buildPathFromLineText(detailLine);
                    if (!path) { toast.error('Could not geocode the stops — add more via stops'); return; }
                    try {
                      await api.put(`/transit-lines/${detailLine.id}`, { routePath: path });
                    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to regenerate path'); return; }
                    toast.success('Path regenerated and snapped to roads');
                    setGeneratedPaths(prev => ({ ...prev, [detailLine.id]: path }));
                    fetchData();
                  }}><RouteIcon className="h-3 w-3" /> Regenerate path</Button>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => { setDetailLine(null); openEditForm(detailLine); }}><Pencil className="h-3 w-3" /> Edit</Button>
                  <Button variant="destructive" size="sm" className="gap-1" onClick={() => deleteLine(detailLine.id)}><Trash2 className="h-3 w-3" /> Delete</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={open => { if (!open && !isDrawing) setShowForm(false); }}>
        <DialogContent className="fixed bottom-4 left-4 top-auto translate-x-0 translate-y-0 max-w-sm w-[360px] max-h-[70vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingLine ? 'Edit Route' : 'New Route'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={formData.transportTypeId} onValueChange={value => setFormData(p => ({ ...p, transportTypeId: value }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select transport type..." /></SelectTrigger>
              <SelectContent>{transportTypes.filter(tt => !heatmapOnlyTypes.some(h => h?.id === tt.id)).map(tt => <SelectItem key={tt.id} value={tt.id}>{ICONS[tt.icon]} {tt.nameEn}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="Line number (e.g. 356, M1)" value={formData.lineNumber} onChange={e => setFormData(p => ({ ...p, lineNumber: e.target.value }))} className="h-9 text-sm" />
            <Input placeholder="Name (EN)" value={formData.nameEn} onChange={e => setFormData(p => ({ ...p, nameEn: e.target.value }))} className="h-9 text-sm" />
            <Input placeholder="الاسم (AR)" value={formData.nameAr} onChange={e => setFormData(p => ({ ...p, nameAr: e.target.value }))} className="h-9 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="From" value={formData.fromArea} onChange={e => setFormData(p => ({ ...p, fromArea: e.target.value }))} className="h-9 text-sm" />
              <Input placeholder="To" value={formData.toArea} onChange={e => setFormData(p => ({ ...p, toArea: e.target.value }))} className="h-9 text-sm" />
            </div>
            <Input placeholder="Via stops (comma separated)" value={formData.viaStops} onChange={e => setFormData(p => ({ ...p, viaStops: e.target.value }))} className="h-9 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" placeholder="Price EGP" value={formData.priceEgp} onChange={e => setFormData(p => ({ ...p, priceEgp: +e.target.value }))} className="h-9 text-sm" />
              <Input type="number" placeholder="Freq (min)" value={formData.frequencyMinutes} onChange={e => setFormData(p => ({ ...p, frequencyMinutes: +e.target.value }))} className="h-9 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={formData.hasFixedStops} onChange={e => setFormData(p => ({ ...p, hasFixedStops: e.target.checked }))} /> Fixed stops</label>
            <Button size="sm" variant="outline" className="w-full h-9 text-xs gap-1" onClick={() => { setShowForm(false); setDrawPoints([]); setIsDrawing(true); }}>
              <Pencil className="h-3 w-3" /> Draw on Map
            </Button>
            <p className="text-[10px] text-muted-foreground">If you do not draw manually, the app will geocode the from/via/to stops and snap the route to real streets automatically.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setIsDrawing(false); }}>Cancel</Button>
            <Button onClick={saveRoute} disabled={isSnapping} className="gap-1">
              {isSnapping ? <><div className="h-3 w-3 border border-primary-foreground border-t-transparent rounded-full animate-spin" /> Snapping...</> : <><Save className="h-3 w-3" /> Save</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminMap;
