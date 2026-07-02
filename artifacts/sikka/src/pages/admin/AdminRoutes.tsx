import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Route, Search, ShieldAlert } from 'lucide-react';
import { deleteLocalTransitLines, getLocalRouteCatalog, saveLocalTransitLine } from '@/lib/localRouteStore';

interface TransitLine {
  id: string;
  transportTypeId: string;
  lineNumber: string | null;
  nameEn: string;
  nameAr: string;
  fromArea: string;
  toArea: string;
  viaStops: string[];
  priceEgp: number;
  governorate?: string;
  routePath: { type: 'LineString'; coordinates: [number, number][] } | null;
  isActive?: boolean;
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
  color: string;
}

const AdminRoutes = () => {
  const { language } = useAuth();
  const navigate = useNavigate();
  const [routes, setRoutes] = useState<TransitLine[]>([]);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [typeId, setTypeId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [governorateFilter, setGovernorateFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [dedupeResult, setDedupeResult] = useState<{ groupsFound: number; duplicateLinesRemoved: number; groups: { keptLabel: string; removedLabels: string[] }[] } | null>(null);
  const [dedupeRunning, setDedupeRunning] = useState(false);
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [enrichStop, setEnrichStop] = useState(false);
  const enrichStopRef = useRef(false);
  const [enrichProgress, setEnrichProgress] = useState<{ processed: number; total: number; updated: number; skipped: number; failed: number } | null>(null);
  const [enrichLog, setEnrichLog] = useState<{ line: string | null; status: string; coords?: number }[]>([]);
  const [seedingDataset, setSeedingDataset] = useState<string | null>(null);
  const [seedLog, setSeedLog] = useState<Record<string, { line: string; status: string; coords?: number; geocodedStations?: number; totalStations?: number }[]>>({});
  const [trainSeedRunning, setTrainSeedRunning] = useState(false);
  const [trainSeedResult, setTrainSeedResult] = useState<{ count: number } | null>(null);

  const fetchRoutes = async () => {
    setIsLoading(true);
    try {
      const catalog = await getLocalRouteCatalog<TransitLine, TransportType>();
      setRoutes(catalog.routes);
      setTransportTypes(catalog.transportTypes);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  const filteredRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes.filter(route => {
      const typeMatch = typeId === 'all' || route.transportTypeId === typeId;
      const statusMatch = statusFilter === 'all' || (route.routeStatus ?? (route.isActive ? 'active' : 'inactive')) === statusFilter;
      const sourceMatch = sourceFilter === 'all' || (route.dataSource ?? 'seed') === sourceFilter;
      const governorateMatch = governorateFilter === 'all' || (route.governorate ?? 'Cairo') === governorateFilter;
      const searchMatch = !q ||
        route.lineNumber?.toLowerCase().includes(q) ||
        route.nameEn?.toLowerCase().includes(q) ||
        route.nameAr?.includes(query) ||
        route.fromArea?.toLowerCase().includes(q) ||
        route.toArea?.toLowerCase().includes(q) ||
        route.viaStops?.some((stop: string) => stop.toLowerCase().includes(q));
      return typeMatch && statusMatch && sourceMatch && governorateMatch && searchMatch;
    });
  }, [query, routes, sourceFilter, statusFilter, typeId, governorateFilter]);

  const qualitySummary = useMemo(() => {
    const byStatus = new Map<string, number>();
    const bySource = new Map<string, number>();
    let suspect = 0;
    let needsReview = 0;
    for (const route of routes) {
      const status = route.routeStatus ?? (route.isActive ? 'active' : 'inactive');
      const source = route.dataSource ?? 'seed';
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
      const pointCount = route.routePath?.coordinates?.length ?? 0;
      if (!route.routePath || pointCount < 3 || (route.confidenceScore ?? 0.6) < 0.45) suspect++;
      if (status === 'needs_review') needsReview++;
    }
    return { byStatus, bySource, suspect, needsReview };
  }, [routes]);

  const updateRouteStatus = async (route: TransitLine, status: TransitLine['routeStatus']) => {
    try {
      const payload = status === 'active'
        ? { routeStatus: status, needsReviewReason: null, verifiedAt: new Date().toISOString(), reviewReportCount: 0 }
        : { routeStatus: status, needsReviewReason: status === 'needs_review' ? 'admin review requested' : route.needsReviewReason };
      const updated = await api.put<TransitLine>(`/transit-lines/${route.id}`, payload);
      await saveLocalTransitLine(updated as unknown as Record<string, unknown>);
      setRoutes((prev) => prev.map((item) => (item.id === route.id ? { ...item, ...updated } : item)));
      toast.success('Route quality updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update route');
    }
  };

  const runDedupe = async (apply: boolean) => {
    setDedupeRunning(true);
    try {
      const result = await api.post<{ groupsFound: number; duplicateLinesRemoved: number; groups: { keptLabel: string; removedIds: string[]; removedLabels: string[] }[] }>(
        `/transit-lines/dedupe?apply=${apply}`,
        {},
      );
      setDedupeResult(result);
      if (apply) {
        const removedIds = result.groups.flatMap((group) => group.removedIds);
        await deleteLocalTransitLines(removedIds);
        setRoutes((previous) => previous.filter((route) => !removedIds.includes(route.id)));
        toast.success(`Merged ${result.duplicateLinesRemoved} duplicate route${result.duplicateLinesRemoved === 1 ? '' : 's'}`);
      } else {
        toast(result.groupsFound > 0 ? `Found ${result.groupsFound} duplicate group(s) — review below before applying` : 'No duplicates found');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dedupe check failed');
    } finally {
      setDedupeRunning(false);
    }
  };

  interface ReEnrichBatchResult {
    totalMatching: number;
    processed: number;
    updated: number;
    skipped: number;
    failed: number;
    nextOffset: number;
    done: boolean;
    results: { id: string; line: string | null; status: string; coords?: number; route?: TransitLine }[];
  }

  // Walks every batch automatically (the endpoint is deliberately small-batch
  // to dodge proxy timeouts — each Nominatim geocode is rate-limited to
  // ~1/sec, so a route with many breadcrumbs can take a while). "Stop" just
  // sets a flag the loop checks between batches, so a run in progress can be
  // halted without losing the batches already applied.
  const runReEnrich = async (dataSource: string) => {
    setEnrichRunning(true);
    setEnrichStop(false);
    enrichStopRef.current = false;
    setEnrichLog([]);
    let offset = 0;
    let totals = { processed: 0, updated: 0, skipped: 0, failed: 0, total: 0 };
    try {
      while (true) {
        if (enrichStopRef.current) break;
        const result = await api.post<ReEnrichBatchResult>(
          `/admin/re-enrich-routes?dataSource=${encodeURIComponent(dataSource)}&limit=5&offset=${offset}`,
          {},
        );
        totals = {
          processed: totals.processed + result.processed,
          updated: totals.updated + result.updated,
          skipped: totals.skipped + result.skipped,
          failed: totals.failed + result.failed,
          total: result.totalMatching,
        };
        setEnrichProgress(totals);
        setEnrichLog((prev) => [...prev, ...result.results.map((r) => ({ line: r.line, status: r.status, coords: r.coords }))]);
        for (const item of result.results) {
          if (item.route) await saveLocalTransitLine(item.route as unknown as Record<string, unknown>);
        }
        if (result.done || result.processed === 0) break;
        offset = result.nextOffset;
      }
      toast.success(`Re-enrichment finished: ${totals.updated} updated, ${totals.skipped} flagged for review, ${totals.failed} failed`);
      await fetchRoutes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-enrichment failed partway through — you can re-run it, already-processed routes will just be redone');
    } finally {
      setEnrichRunning(false);
    }
  };

  interface SeedTransitBatchResult {
    done: boolean;
    totalLines: number;
    nextOffset?: number;
    results: { line: string; status: string; coords?: number; geocodedStations?: number; totalStations?: number }[];
  }

  // Same auto-batching loop shape as runReEnrich — one LINE per call, since
  // each station in it needs its own rate-limited geocode lookup.
  const seedTransitSystem = async (dataset: 'lrt' | 'brt' | 'tram') => {
    setSeedingDataset(dataset);
    setSeedLog((prev) => ({ ...prev, [dataset]: [] }));
    let offset = 0;
    try {
      while (true) {
        const result = await api.post<SeedTransitBatchResult>(
          `/admin/seed-egypt-transit?dataset=${dataset}&offset=${offset}`,
          {},
        );
        setSeedLog((prev) => ({ ...prev, [dataset]: [...(prev[dataset] || []), ...result.results] }));
        if (result.done) break;
        offset = result.nextOffset ?? offset + 1;
      }
      toast.success(`${dataset.toUpperCase()} seeding finished`);
      fetchRoutes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${dataset.toUpperCase()} seeding failed partway through`);
    } finally {
      setSeedingDataset(null);
    }
  };

  const seedTrains = async () => {
    setTrainSeedRunning(true);
    try {
      const result = await api.post<{ count: number }>('/trains/seed', {});
      setTrainSeedResult(result);
      toast.success(`Seeded/updated ${result.count} train entries`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Train seeding failed');
    } finally {
      setTrainSeedRunning(false);
    }
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  const typeById = new Map(transportTypes.map(t => [t.id, t]));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-2xl font-semibold">{qualitySummary.byStatus.get('active') ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Needs review</p>
            <p className="text-2xl font-semibold text-yellow-500">{qualitySummary.needsReview}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Suspect geometry</p>
            <p className="text-2xl font-semibold text-destructive">{qualitySummary.suspect}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Discovery / GTFS</p>
            <p className="text-2xl font-semibold">{qualitySummary.bySource.get('discovery') ?? 0} / {qualitySummary.bySource.get('gtfs') ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Duplicate-route cleanup: catches CSV/AI placeholders that ended up as
          separate rows from a later GPS-verified line for the same corridor. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">Duplicate route cleanup</h3>
              <p className="text-xs text-muted-foreground">Finds routes describing the same corridor that ended up as separate entries.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={dedupeRunning} onClick={() => runDedupe(false)}>
                Check for duplicates
              </Button>
              {dedupeResult && dedupeResult.groupsFound > 0 && (
                <Button size="sm" variant="destructive" disabled={dedupeRunning} onClick={() => runDedupe(true)}>
                  Merge {dedupeResult.groupsFound} group{dedupeResult.groupsFound === 1 ? '' : 's'}
                </Button>
              )}
            </div>
          </div>
          {dedupeResult && dedupeResult.groupsFound > 0 && (
            <div className="space-y-2 pt-1">
              {dedupeResult.groups.map((g, i) => (
                <div key={i} className="text-xs rounded-lg bg-muted/40 p-2">
                  <p className="font-medium text-foreground">Keeps: {g.keptLabel}</p>
                  <p className="text-muted-foreground">Removes: {g.removedLabels.join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Re-run the route-generation pipeline (Nominatim + OSRM, with the
          backtrack-rejection + loop-detection fixes) over CSV-imported
          ("seed") routes — the fix for routes that loop/zigzag. Discovery
          (GPS-verified) lines are never touched by the default button. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">Re-enrich CSV routes</h3>
              <p className="text-xs text-muted-foreground">
                Re-runs the latest routing pipeline over CSV-imported routes only — GPS-verified routes are never touched.
              </p>
            </div>
            <div className="flex gap-2">
              {!enrichRunning ? (
                <Button size="sm" onClick={() => runReEnrich('seed')}>
                  Re-route all CSV routes
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { enrichStopRef.current = true; setEnrichStop(true); }}
                  disabled={enrichStop}
                >
                  {enrichStop ? 'Stopping…' : 'Stop'}
                </Button>
              )}
            </div>
          </div>

          {enrichProgress && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{enrichProgress.processed} / {enrichProgress.total} processed</span>
                <span>{enrichProgress.updated} updated · {enrichProgress.skipped} flagged for review · {enrichProgress.failed} failed</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${enrichProgress.total ? Math.min(100, (enrichProgress.processed / enrichProgress.total) * 100) : 0}%` }}
                />
              </div>
              {enrichLog.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1 pt-1">
                  {enrichLog.slice(-20).map((r, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">
                      {r.line || '(unnumbered)'} — <span className={r.status === 'updated' ? 'text-green-600' : r.status === 'failed' ? 'text-destructive' : 'text-yellow-600'}>{r.status}</span>
                      {r.coords ? ` (${r.coords} pts)` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cairo LRT / BRT / Alexandria Tram — real station lists, geocoded
          and road/rail-snapped at seed time. Each runs in its own governorate
          and plan tier automatically (LRT: premium, BRT: comfortable, Tram:
          economic) per the underlying transport type configuration. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Seed Cairo LRT / BRT / Alexandria Tram</h3>
            <p className="text-xs text-muted-foreground">
              Geocodes each real station and snaps the line to road/rail geometry — no manual drawing. Safe to re-run.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['lrt', 'brt', 'tram'] as const).map((ds) => (
              <Button
                key={ds}
                size="sm"
                variant={seedingDataset === ds ? 'secondary' : 'outline'}
                disabled={seedingDataset !== null}
                onClick={() => seedTransitSystem(ds)}
              >
                {seedingDataset === ds ? `Seeding ${ds.toUpperCase()}…` : `Seed ${ds.toUpperCase()}`}
              </Button>
            ))}
          </div>
          {Object.entries(seedLog).map(([ds, entries]) => entries.length > 0 && (
            <div key={ds} className="space-y-1 pt-1">
              <p className="text-xs font-medium text-foreground">{ds.toUpperCase()}</p>
              {entries.map((r, i) => (
                <p key={i} className="text-[11px] text-muted-foreground">
                  {r.line} — <span className={r.status === 'seeded' ? 'text-green-600' : r.status.startsWith('failed') ? 'text-destructive' : 'text-yellow-600'}>{r.status}</span>
                  {r.coords ? ` (${r.coords} pts, ${r.geocodedStations}/${r.totalStations} stations geocoded)` : ''}
                </p>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Intercity train timetables — two fully-detailed real schedules plus
          route-level summaries for the other major lines. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">Seed train timetables</h3>
              <p className="text-xs text-muted-foreground">Populates the train search page with real schedule data.</p>
            </div>
            <Button size="sm" onClick={seedTrains} disabled={trainSeedRunning}>
              {trainSeedRunning ? 'Seeding…' : 'Seed trains'}
            </Button>
          </div>
          {trainSeedResult && (
            <p className="text-xs text-muted-foreground">Seeded/updated {trainSeedResult.count} train entries.</p>
          )}
        </CardContent>
      </Card>


      <div className="grid gap-2 md:grid-cols-[180px_220px_180px_180px_1fr]">
        <Select value={governorateFilter} onValueChange={setGovernorateFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Governorate" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All governorates</SelectItem>
            <SelectItem value="Cairo">Cairo</SelectItem>
            <SelectItem value="Alexandria">Alexandria</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeId} onValueChange={setTypeId}>
          <SelectTrigger>
            <SelectValue placeholder="Transport type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All transport types</SelectItem>
            {transportTypes.map(type => (
              <SelectItem key={type.id} value={type.id}>{language === 'ar' ? type.nameAr : type.nameEn}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Route status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="pending_discovery">Pending discovery</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Data source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="discovery">Discovery</SelectItem>
            <SelectItem value="gtfs">GTFS</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="csv">CSV</SelectItem>
            <SelectItem value="seed">Seed</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search route number, station, or road" className="pl-9" />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filteredRoutes.length} imported mapped routes</p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredRoutes.map(route => {
          const type = typeById.get(route.transportTypeId);
          return (
            <Card
              key={route.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/route/${route.id}`)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" style={{ borderColor: type?.color, color: type?.color }}>{route.lineNumber || 'Route'}</Badge>
                    <Badge variant={route.routeStatus === 'needs_review' ? 'destructive' : 'secondary'}>
                      {route.routeStatus ?? 'active'}
                    </Badge>
                    <Badge variant="outline">{route.dataSource ?? 'seed'} · {route.sourcePriority ?? 10}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{type ? (language === 'ar' ? type.nameAr : type.nameEn) : 'Transport'}</span>
                </div>
                <div className="flex gap-2">
                  <Route className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{route.fromArea} → {route.toArea}</p>
                    {route.viaStops?.length > 0 && <p className="text-xs text-muted-foreground line-clamp-2">{route.viaStops.join(' · ')}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{route.priceEgp} EGP</span>
                  <span>{route.routePath ? `${route.routePath.coordinates.length} pts` : 'No geometry'}</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Confidence: {Math.round((route.confidenceScore ?? 0.6) * 100)}% · Reports: {route.reviewReportCount ?? 0}</p>
                  {route.needsReviewReason && (
                    <p className="flex gap-1 text-yellow-600">
                      <ShieldAlert className="h-3 w-3 mt-0.5" />
                      {route.needsReviewReason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {route.routeStatus !== 'active' && (
                    <Button size="sm" className="h-8" onClick={() => updateRouteStatus(route, 'active')}>
                      Verify active
                    </Button>
                  )}
                  {route.routeStatus !== 'needs_review' && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => updateRouteStatus(route, 'needs_review')}>
                      Needs review
                    </Button>
                  )}
                  {route.routeStatus !== 'inactive' && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => updateRouteStatus(route, 'inactive')}>
                      Deactivate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default AdminRoutes;
