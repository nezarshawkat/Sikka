import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Map, { Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  ArrowLeft, Search, ShieldAlert, CheckCircle2, XCircle,
  Trash2, RotateCcw, MapPin, Sparkles,
} from 'lucide-react';
import { useIsDark, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from '@/hooks/useIsDark';
import { buildBlendedSegments, computeBounds, type LngLat } from '@/lib/traceBlend';
import { saveLocalTransitLine, deleteLocalTransitLines } from '@/lib/localRouteStore';

interface ContributingTrace {
  reportId?: string;
  trace: LngLat[];
  color: string;
  roadMatched?: boolean;
}

interface RouteQualityMetrics {
  roadMatched?: boolean;
  contributingTraces?: ContributingTrace[];
  blendedColor?: string;
  matchedReportCount?: number;
  rejectionReason?: string;
  recoverabilityScore?: number;
  pointCount?: number;
}

interface DiscoveryLine {
  id: string;
  transportTypeId: string | null;
  lineNumber: string | null;
  nameEn: string;
  nameAr: string;
  fromArea: string | null;
  toArea: string | null;
  routePath: { coordinates: LngLat[] } | null;
  priceEgp: number;
  confidenceScore: number | null;
  reviewReportCount?: number;
  routeStatus: string;
  needsReviewReason: string | null;
  routeQuality: { source?: string; metrics?: RouteQualityMetrics } | null;
  createdAt: string;
  updatedAt: string;
}

interface TransportType {
  id: string;
  nameEn: string;
  nameAr: string;
}

const REASON_LABELS: Record<string, string> = {
  no_gps_points: 'No GPS points were recorded',
  too_few_valid_gps_points: 'Too few valid GPS points',
  outside_supported_region: 'Trip appears to be outside Egypt',
  missing_route_direction: 'Start/destination area missing',
  same_start_and_destination: 'Start and destination were the same',
  direction_not_confirmed: 'Direction not confirmed',
  trace_too_short: 'Recorded trip was too short',
  snapped_route_too_short: 'Matched route was too short',
  snapped_route_too_sparse: 'Matched route had too few points',
  start_and_end_too_close: 'Start and end points too close together',
  stationary_trace: "Device didn't appear to move",
  recording_too_short: 'Recording under 90 seconds',
  recording_too_long: 'Recording over 3 hours',
  impossible_gps_jump: 'GPS recorded an impossibly fast jump',
  snap_failed: 'Road-matching service unavailable',
  snap_too_far_from_trace: "Matched road didn't follow the GPS trace closely enough",
  snap_endpoint_mismatch: 'Matched road endpoints too far from the real start/end',
  snap_distance_ratio_bad: 'Matched road length was very different from the recorded trip',
  valhalla_not_configured: 'Valhalla is not configured on this server',
  admin_rejected: 'Rejected by admin',
};

function reasonLabel(reason?: string | null): string {
  if (!reason) return 'Unknown reason';
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

function DiscoveryMap({ line }: { line: DiscoveryLine }) {
  const isDark = useIsDark();
  const traces = useMemo(
    () => (line.routeQuality?.metrics?.contributingTraces ?? []).filter((t) => t.trace?.length >= 2),
    [line.id, line.routeQuality],
  );
  const hasMultiple = traces.length >= 2;
  const segments = useMemo(() => (hasMultiple ? buildBlendedSegments(traces) : []), [line.id, hasMultiple]);
  const allPoints: LngLat[] = hasMultiple ? traces.flatMap((t) => t.trace) : (line.routePath?.coordinates ?? []);
  const bounds = useMemo(() => computeBounds(allPoints), [line.id]);

  if (!allPoints.length || !bounds) {
    return (
      <div className="h-40 rounded-xl bg-muted/50 flex items-center justify-center text-xs text-muted-foreground gap-1">
        <MapPin className="h-3.5 w-3.5" /> No GPS data recorded
      </div>
    );
  }

  const soloColor = line.routeQuality?.metrics?.blendedColor || '#3B82F6';
  const geojson = {
    type: 'FeatureCollection' as const,
    features: hasMultiple
      ? segments.map((s) => ({
          type: 'Feature' as const,
          properties: { color: s.color },
          geometry: { type: 'LineString' as const, coordinates: s.coordinates },
        }))
      : line.routePath
        ? [{
            type: 'Feature' as const,
            properties: { color: soloColor },
            geometry: { type: 'LineString' as const, coordinates: line.routePath.coordinates },
          }]
        : [],
  };

  return (
    <div className="h-40 rounded-xl overflow-hidden border">
      <Map
        key={line.id}
        initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        interactive={false}
        attributionControl={false}
      >
        <Source id={`trace-${line.id}`} type="geojson" data={geojson}>
          <Layer
            id={`trace-line-${line.id}`}
            type="line"
            paint={{ 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.92 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>
      </Map>
    </div>
  );
}

export default function AdminDiscovery() {
  const navigate = useNavigate();
  const [lines, setLines] = useState<DiscoveryLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'rejected'>('pending');
  const [typeFilter, setTypeFilter] = useState<'all' | 'bus' | 'microbus'>('all');
  const [query, setQuery] = useState('');
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [providerDialogFor, setProviderDialogFor] = useState<DiscoveryLine | null>(null);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<TransportType[]>('/transport-types').then((data) => setTransportTypes(data ?? [])).catch(() => {});
  }, []);

  const busTypeId = transportTypes.find((t) => t.nameEn.toLowerCase() === 'bus')?.id;
  const microbusTypeId = transportTypes.find((t) => t.nameEn.toLowerCase() === 'microbus')?.id;

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('routeStatus', statusFilter === 'pending' ? 'needs_review' : 'rejected');
    params.set('dataSource', 'discovery');
    if (typeFilter === 'bus' && busTypeId) params.set('transportTypeId', busTypeId);
    if (typeFilter === 'microbus' && microbusTypeId) params.set('transportTypeId', microbusTypeId);
    if (query.trim()) params.set('q', query.trim());
    api.get<DiscoveryLine[]>(`/transit-lines?${params.toString()}`)
      .then((data) => setLines(data ?? []))
      .catch(() => toast.error('Failed to load discovery routes'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, busTypeId, microbusTypeId]);

  useEffect(() => {
    const timer = setTimeout(load, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortedLines = useMemo(() => {
    if (statusFilter !== 'rejected') {
      return [...lines].sort((a, b) => (b.reviewReportCount ?? 0) - (a.reviewReportCount ?? 0));
    }
    // Least recoverable first, most recoverable (highest chance of being
    // fixed by a re-attempt or "Improve route quality") last.
    return [...lines].sort((a, b) => {
      const scoreA = a.routeQuality?.metrics?.recoverabilityScore ?? 3;
      const scoreB = b.routeQuality?.metrics?.recoverabilityScore ?? 3;
      return scoreA - scoreB;
    });
  }, [lines, statusFilter]);

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const acceptRoute = (line: DiscoveryLine) => withBusy(line.id, async () => {
    try {
      const updated = await api.put<DiscoveryLine>(`/transit-lines/${line.id}`, {
        routeStatus: 'active',
        needsReviewReason: null,
        verifiedAt: new Date().toISOString(),
      });
      await saveLocalTransitLine(updated as unknown as Record<string, unknown>);
      setLines((prev) => prev.filter((l) => l.id !== line.id));
      toast.success('Route accepted — now live on the Routes page');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to accept route');
    }
  });

  const rejectRoute = (line: DiscoveryLine) => withBusy(line.id, async () => {
    try {
      const nextQuality = {
        ...(line.routeQuality ?? {}),
        metrics: {
          ...(line.routeQuality?.metrics ?? {}),
          rejectionReason: line.routeQuality?.metrics?.rejectionReason ?? 'admin_rejected',
          recoverabilityScore: line.routeQuality?.metrics?.recoverabilityScore ?? 3,
        },
      };
      const updated = await api.put<DiscoveryLine>(`/transit-lines/${line.id}`, {
        routeStatus: 'rejected',
        needsReviewReason: 'Rejected by admin',
        routeQuality: nextQuality,
      });
      await saveLocalTransitLine(updated as unknown as Record<string, unknown>);
      setLines((prev) => prev.filter((l) => l.id !== line.id));
      toast.success('Route rejected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject route');
    }
  });

  const moveToPending = (line: DiscoveryLine) => withBusy(line.id, async () => {
    try {
      const updated = await api.put<DiscoveryLine>(`/transit-lines/${line.id}`, {
        routeStatus: 'needs_review',
        needsReviewReason: 'Recovered from rejected for another look',
      });
      await saveLocalTransitLine(updated as unknown as Record<string, unknown>);
      setLines((prev) => prev.filter((l) => l.id !== line.id));
      toast.success('Moved back to pending');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move route');
    }
  });

  const deleteRoute = (line: DiscoveryLine) => withBusy(line.id, async () => {
    try {
      await api.delete(`/transit-lines/${line.id}`);
      await deleteLocalTransitLines([line.id]);
      setLines((prev) => prev.filter((l) => l.id !== line.id));
      toast.success('Route deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete route');
    }
  });

  const retrySnap = async (line: DiscoveryLine, provider: 'valhalla' | 'osrm') => {
    setProviderDialogFor(null);
    setRetrying((prev) => new Set(prev).add(line.id));
    setRetryErrors((prev) => { const next = { ...prev }; delete next[line.id]; return next; });
    try {
      const result = await api.post<{ success: boolean; roadMatched: boolean; route?: DiscoveryLine; reason?: string }>(
        `/transit-lines/${line.id}/resnap`,
        { provider },
      );
      if (result.success && result.route) {
        await saveLocalTransitLine(result.route as unknown as Record<string, unknown>);
        setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...result.route } : l)));
        toast.success('Route successfully matched to real roads');
      } else {
        setRetryErrors((prev) => ({ ...prev, [line.id]: reasonLabel(result.reason) }));
        toast.error('Still could not match this route to real roads.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retry failed';
      setRetryErrors((prev) => ({ ...prev, [line.id]: message }));
      toast.error(message);
    } finally {
      setRetrying((prev) => { const next = new Set(prev); next.delete(line.id); return next; });
    }
  };

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-10 glass-panel border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Discovery</h1>
      </div>

      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search area, name, or line number…"
            className="pl-9 rounded-[2rem]"
          />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'pending' | 'rejected')}>
            <SelectTrigger className="rounded-[2rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | 'bus' | 'microbus')}>
            <SelectTrigger className="rounded-[2rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="bus">Bus</SelectItem>
              <SelectItem value="microbus">Microbus</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {statusFilter === 'rejected' && (
          <p className="text-xs text-muted-foreground">
            Sorted from least to most likely to be recoverable — rejected routes are deleted automatically after 7 days.
          </p>
        )}
      </div>

      <div className="px-4 space-y-3">
        {loading && <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>}
        {!loading && sortedLines.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {statusFilter === 'pending' ? 'No pending discoveries.' : 'No rejected routes.'}
          </p>
        )}

        {sortedLines.map((line) => {
          const roadMatched = line.routeQuality?.metrics?.roadMatched;
          const isRejected = line.routeStatus === 'rejected';
          const rejectionReason = line.routeQuality?.metrics?.rejectionReason;
          const recoverability = line.routeQuality?.metrics?.recoverabilityScore ?? 3;
          const busy = busyIds.has(line.id);
          const isRetrying = retrying.has(line.id);
          const retryError = retryErrors[line.id];

          return (
            <Card key={line.id} className="glass-panel rounded-[2rem] overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{line.nameEn}</p>
                    {line.nameAr && line.nameAr !== line.nameEn && (
                      <p className="text-sm text-muted-foreground truncate" dir="rtl">{line.nameAr}</p>
                    )}
                  </div>
                  {line.lineNumber && <Badge variant="secondary" className="shrink-0">#{line.lineNumber}</Badge>}
                </div>

                <DiscoveryMap line={line} />

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{line.fromArea} → {line.toArea}</span>
                  <span>{line.priceEgp} EGP</span>
                </div>

                <p className="text-xs text-muted-foreground">
                  Confidence: {Math.round((line.confidenceScore ?? 0) * 100)}% · Reports: {line.reviewReportCount ?? line.routeQuality?.metrics?.matchedReportCount ?? 0}
                </p>

                {roadMatched === false && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="w-fit gap-1 border-yellow-500 text-yellow-600">
                      <ShieldAlert className="h-3 w-3" /> Raw GPS · not road-matched
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={isRetrying}
                      onClick={() => setProviderDialogFor(line)}
                    >
                      <Sparkles className={`h-3 w-3 ${isRetrying ? 'animate-pulse' : ''}`} />
                      {isRetrying ? 'Improving…' : 'Improve route quality'}
                    </Button>
                  </div>
                )}
                {retryError && (
                  <p className="text-[11px] text-red-500">Failed: {retryError}</p>
                )}

                {isRejected && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 space-y-1">
                    <p className="text-xs font-medium text-red-600 flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5" /> {reasonLabel(rejectionReason)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Recovery chance: {['', 'very low', 'low', 'medium', 'high', 'very high'][recoverability] ?? 'medium'}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {!isRejected ? (
                    <>
                      <Button size="sm" className="flex-1 gap-1" disabled={busy} onClick={() => acceptRoute(line)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                      </Button>
                      <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={busy} onClick={() => rejectRoute(line)}>
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={busy} onClick={() => moveToPending(line)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Move to pending
                      </Button>
                      <Button size="sm" variant="destructive" className="flex-1 gap-1" disabled={busy} onClick={() => deleteRoute(line)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!providerDialogFor} onOpenChange={(open) => !open && setProviderDialogFor(null)}>
        <DialogContent className="rounded-[2rem]">
          <DialogHeader>
            <DialogTitle>Improve route quality</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Choose which road-matching service to try for this route.
          </p>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={() => providerDialogFor && retrySnap(providerDialogFor, 'valhalla')}>
              Valhalla
            </Button>
            <Button className="flex-1" variant="outline" onClick={() => providerDialogFor && retrySnap(providerDialogFor, 'osrm')}>
              OSRM
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
