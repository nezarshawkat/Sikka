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
import { Route, Search, ShieldAlert, RefreshCw } from 'lucide-react';
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
  routeQualityDetails?: { metrics?: { roadMatched?: boolean } } | null;
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

  const [resnappingIds, setResnappingIds] = useState<Set<string>>(new Set());

  const retrySnapping = async (route: TransitLine) => {
    setResnappingIds((prev) => new Set(prev).add(route.id));
    try {
      const result = await api.post<{ success: boolean; roadMatched: boolean; route?: TransitLine; reason?: string }>(
        `/transit-lines/${route.id}/resnap`,
        {},
      );
      if (result.success && result.route) {
        await saveLocalTransitLine(result.route as unknown as Record<string, unknown>);
        setRoutes((prev) => prev.map((item) => (item.id === route.id ? { ...item, ...result.route } : item)));
        toast.success('Route successfully matched to real roads');
      } else {
        // Still not snapped -- button stays available below (its condition
        // is roadMatched === false, which hasn't changed) so it can be
        // tried again once the road-matching service is back.
        toast.error('Still could not match this route to real roads. Try again shortly.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setResnappingIds((prev) => {
        const next = new Set(prev);
        next.delete(route.id);
        return next;
      });
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
                {route.routeQualityDetails?.metrics?.roadMatched === false && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="w-fit gap-1 border-yellow-500 text-yellow-600">
                      <ShieldAlert className="h-3 w-3" /> Raw GPS · not road-matched
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={resnappingIds.has(route.id)}
                      onClick={(e) => { e.stopPropagation(); retrySnapping(route); }}
                    >
                      <RefreshCw className={`h-3 w-3 ${resnappingIds.has(route.id) ? 'animate-spin' : ''}`} />
                      {resnappingIds.has(route.id) ? 'Retrying…' : 'Retry snapping'}
                    </Button>
                  </div>
                )}
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
