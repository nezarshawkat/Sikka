import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Map, { Layer, Marker, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, Check, CircleDot, Eye, EyeOff, LocateFixed, MousePointer2, Pencil, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useIsDark, MAP_STYLE_DARK, MAP_STYLE_LIGHT } from '@/hooks/useIsDark';
import { computeBounds, type LngLat } from '@/lib/traceBlend';

type Trace = { reportId?: string; trace: LngLat[]; color: string; roadMatched?: boolean };
type DiscoveryLine = {
  id: string; nameEn: string; nameAr: string; lineNumber: string | null; fromArea: string | null; toArea: string | null;
  priceEgp: number; routeStatus: string; routePath: { type?: string; coordinates: LngLat[] } | null;
  routeQuality?: { metrics?: { contributingTraces?: Trace[]; roadMatched?: boolean; matchedReportCount?: number } } | null;
};
type Tool = 'select' | 'draw' | 'erase';

const finalColor = '#2563eb';

function lineFeature(coordinates: LngLat[], color: string, opacity = 1) {
  return { type: 'Feature' as const, properties: { color, opacity }, geometry: { type: 'LineString' as const, coordinates } };
}

export default function AdminDiscoveryEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isDark = useIsDark();
  const [line, setLine] = useState<DiscoveryLine | null>(null);
  const [draft, setDraft] = useState<LngLat[]>([]);
  const [history, setHistory] = useState<LngLat[][]>([]);
  const [future, setFuture] = useState<LngLat[][]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [selectedTrace, setSelectedTrace] = useState<string>('combined');
  const [nameEn, setNameEn] = useState('');
  const [fromArea, setFromArea] = useState('');
  const [toArea, setToArea] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<DiscoveryLine>(`/transit-lines/${id}`).then((result) => {
      setLine(result); setDraft(result.routePath?.coordinates ?? []); setNameEn(result.nameEn); setFromArea(result.fromArea ?? ''); setToArea(result.toArea ?? '');
      const traces = result.routeQuality?.metrics?.contributingTraces ?? [];
      setVisible(Object.fromEntries(traces.map((trace, index) => [trace.reportId ?? String(index), true])));
    }).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not load this discovery'));
  }, [id]);

  const traces = line?.routeQuality?.metrics?.contributingTraces ?? [];
  const shownTraces = useMemo(() => traces.filter((trace, index) => {
    const key = trace.reportId ?? String(index);
    return selectedTrace === 'combined' ? visible[key] !== false : selectedTrace === key;
  }), [traces, visible, selectedTrace]);
  const allPoints = useMemo(() => [...draft, ...shownTraces.flatMap((trace) => trace.trace)], [draft, shownTraces]);
  const bounds = useMemo(() => computeBounds(allPoints), [allPoints]);
  const evidence = useMemo(() => ({ type: 'FeatureCollection' as const, features: shownTraces.filter((trace) => trace.trace.length > 1).map((trace) => lineFeature(trace.trace, trace.color, selectedTrace === 'combined' ? .74 : 1)) }), [shownTraces, selectedTrace]);
  const finalRoute = useMemo(() => ({ type: 'FeatureCollection' as const, features: draft.length > 1 ? [lineFeature(draft, finalColor)] : [] }), [draft]);

  const commit = (next: LngLat[]) => { setHistory((old) => [...old, draft]); setFuture([]); setDraft(next); };
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((old) => [draft, ...old]); setHistory((old) => old.slice(0, -1)); setDraft(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((old) => [...old, draft]); setFuture((old) => old.slice(1)); setDraft(next); };
  const onMapClick = (event: MapLayerMouseEvent) => {
    if (tool !== 'draw') return;
    commit([...draft, [event.lngLat.lng, event.lngLat.lat]]);
  };
  const publish = async () => {
    if (!line) return;
    if (draft.length < 2) { toast.error('Draw at least two route points before publishing'); return; }
    setSaving(true);
    try {
      const updated = await api.put<DiscoveryLine>(`/transit-lines/${line.id}`, {
        nameEn: nameEn.trim() || line.nameEn, fromArea: fromArea.trim(), toArea: toArea.trim(),
        routePath: { type: 'LineString', coordinates: draft }, routeStatus: 'active',
        needsReviewReason: null, verifiedAt: new Date().toISOString(),
      });
      setLine(updated); setDraft(updated.routePath?.coordinates ?? draft); toast.success('Route published');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Publish failed — your edited points were not saved'); }
    finally { setSaving(false); }
  };

  if (!line) return <div className="p-8 text-sm text-muted-foreground">Loading discovery editor…</div>;
  return <div className="fixed inset-0 z-50 bg-background flex flex-col" data-testid="discovery-editor">
    <header className="h-16 shrink-0 border-b bg-card flex items-center gap-3 px-3 md:px-5">
      <Button variant="ghost" size="icon" aria-label="Back to discovery" onClick={() => navigate('/admin/discovery')}><ArrowLeft className="h-5 w-5" /></Button>
      <div className="min-w-0 flex-1"><p className="font-semibold truncate">{nameEn || line.nameEn}</p><p className="text-xs text-muted-foreground truncate">Discovery editor · {line.fromArea} → {line.toArea}</p></div>
      <Badge variant="outline" className="hidden sm:inline-flex">{draft.length} editable points</Badge>
      <Button className="gap-1" disabled={saving} onClick={() => void publish()}><Check className="h-4 w-4" /> {saving ? 'Publishing…' : 'Publish'}</Button>
    </header>

    <div className="flex min-h-0 flex-1">
      <aside className="hidden lg:flex w-72 shrink-0 border-r bg-card flex-col overflow-auto">
        <div className="p-4 border-b"><p className="font-semibold">Route details</p><p className="text-xs text-muted-foreground mt-1">Edit the route you will publish. Original GPS evidence stays unchanged.</p></div>
        <div className="p-4 space-y-4">
          <label className="block text-xs font-medium">Route name<Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} className="mt-1" /></label>
          <label className="block text-xs font-medium">From area<Input value={fromArea} onChange={(event) => setFromArea(event.target.value)} className="mt-1" /></label>
          <label className="block text-xs font-medium">To area<Input value={toArea} onChange={(event) => setToArea(event.target.value)} className="mt-1" /></label>
          <div className="rounded-xl border bg-muted/30 p-3 text-xs space-y-1"><p className="font-semibold">Review evidence</p><p>{traces.length || line.routeQuality?.metrics?.matchedReportCount || 0} contributor routes</p><p>{line.routeQuality?.metrics?.roadMatched ? 'Road matched' : 'Raw GPS available for review'}</p></div>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <Map key={`${line.id}-${selectedTrace}`} initialViewState={bounds ? { bounds, fitBoundsOptions: { padding: 80 } } : { longitude: 31.2357, latitude: 30.0444, zoom: 11 }} onClick={onMapClick} style={{ width: '100%', height: '100%' }} mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT} cursor={tool === 'draw' ? 'crosshair' : tool === 'erase' ? 'not-allowed' : 'grab'}>
          <Source id="evidence" type="geojson" data={evidence}><Layer id="evidence-line" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': ['get', 'opacity'] }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} /></Source>
          <Source id="final-route" type="geojson" data={finalRoute}><Layer id="final-route-line" type="line" paint={{ 'line-color': finalColor, 'line-width': 6, 'line-opacity': .96 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} /></Source>
          {draft.map((point, index) => <Marker key={`${point.join(',')}-${index}`} longitude={point[0]} latitude={point[1]} draggable={tool === 'select'} onDragEnd={(event) => commit(draft.map((item, itemIndex) => itemIndex === index ? [event.lngLat.lng, event.lngLat.lat] : item))}>
            <button aria-label={`Route point ${index + 1}`} onClick={(event) => { event.stopPropagation(); if (tool === 'erase') commit(draft.filter((_, itemIndex) => itemIndex !== index)); }} className={`h-4 w-4 rounded-full border-2 border-white shadow ${tool === 'erase' ? 'bg-red-500' : 'bg-blue-600'}`} />
          </Marker>)}
        </Map>

        <div className="absolute left-3 top-3 flex flex-col gap-2 rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur">
          <Button size="icon" variant={tool === 'select' ? 'default' : 'ghost'} title="Select and move route points" onClick={() => setTool('select')}><MousePointer2 className="h-4 w-4" /></Button>
          <Button size="icon" variant={tool === 'draw' ? 'default' : 'ghost'} title="Draw route points on the map" onClick={() => setTool('draw')}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant={tool === 'erase' ? 'destructive' : 'ghost'} title="Click a route point to erase it" onClick={() => setTool('erase')}><Trash2 className="h-4 w-4" /></Button>
          <div className="border-t pt-2"><Button size="icon" variant="ghost" disabled={!history.length} title="Undo" onClick={undo}><Undo2 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={!future.length} title="Redo" onClick={redo}><Redo2 className="h-4 w-4" /></Button></div>
        </div>
        <div className="absolute top-3 left-16 rounded-full border bg-card/95 px-3 py-2 text-xs shadow backdrop-blur">{tool === 'draw' ? 'Click map to add a point' : tool === 'erase' ? 'Click a blue point to erase it' : 'Drag blue points to refine route'}</div>
        <div className="absolute right-3 top-3 flex gap-2"><Button size="sm" variant="outline" className="bg-card/95" onClick={() => { if (draft.length) commit(draft.slice(0, -1)); }}><Trash2 className="mr-1 h-3.5 w-3.5" /> Remove last</Button><Button size="sm" variant="outline" className="bg-card/95" onClick={() => setTool('draw')}><Plus className="mr-1 h-3.5 w-3.5" /> Add points</Button></div>

        <section className="absolute bottom-3 right-3 w-[min(22rem,calc(100%-1.5rem))] overflow-hidden rounded-2xl border bg-card/95 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between border-b px-3 py-2"><div><p className="text-sm font-semibold">Route evidence</p><p className="text-[11px] text-muted-foreground">Choose combined or inspect one recording</p></div><LocateFixed className="h-4 w-4 text-muted-foreground" /></div>
          <div className="max-h-56 overflow-auto p-2 space-y-1">
            <button onClick={() => setSelectedTrace('combined')} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${selectedTrace === 'combined' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><CircleDot className="h-4 w-4" />Combined <span className="ml-auto text-xs opacity-75">{traces.length} routes</span></button>
            {traces.map((trace, index) => { const key = trace.reportId ?? String(index); const active = selectedTrace === key; return <div key={key} className={`flex items-center gap-1 rounded-lg ${active ? 'bg-muted' : ''}`}><button onClick={() => setSelectedTrace(key)} className="min-w-0 flex-1 flex items-center gap-2 px-2 py-2 text-left text-sm"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: trace.color }} /> <span className="truncate">Route {index + 1}</span><span className="ml-auto text-[10px] text-muted-foreground">{trace.roadMatched ? 'matched' : 'raw GPS'}</span></button><Button size="icon" variant="ghost" className="h-8 w-8" title={visible[key] === false ? 'Show route' : 'Hide route'} onClick={() => setVisible((current) => ({ ...current, [key]: current[key] === false }))}>{visible[key] === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button></div>; })}
          </div>
        </section>
      </main>
    </div>
  </div>;
}
