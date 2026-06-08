import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Users, ArrowRight, Star, Brain, Route, MapPinned } from 'lucide-react';

interface DiscoveryRow {
  transportName: string;
  transportNumber: string | null;
  reportCount: number;
  sampleFromArea: string | null;
  sampleToArea: string | null;
  avgPrice: number | null;
  gpsTraceCount?: number;
  avgGpsPoints?: number | null;
  confidenceScore?: number;
}

interface TransportReport {
  id: string;
  transportName: string;
  transportNumber: string | null;
  fromArea: string | null;
  toArea: string | null;
  priceEgp: number | null;
  status: string;
  createdAt: string;
}

const AdminDiscovery = () => {
  const { language } = useAuth();
  const [discovery, setDiscovery] = useState<DiscoveryRow[]>([]);
  const [pending, setPending] = useState<TransportReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = () => {
    setIsLoading(true);
    Promise.all([
      api.get<DiscoveryRow[]>('/transport-reports?discovery=true'),
      api.get<TransportReport[]>('/transport-reports?status=pending'),
    ])
      .then(([disc, pend]) => {
        setDiscovery(disc ?? []);
        setPending(pend ?? []);
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/transport-reports/${id}`, { status });
      setPending((prev) => prev.filter((r) => r.id !== id));
      toast.success(t('planUpdated', language));
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-6">

      <Card className="glass-panel rounded-[2rem]">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Discovery learning brain</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Each contributed journey is split into single transport legs, clustered by mode/operator/number and overlapping GPS geometry, converted into GTFS-style stop_times + shapes, then scored from 1–5 by report volume, GPS completeness, route stability, and rider confirmations.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-2xl bg-background/35 border p-3">
              <Route className="h-4 w-4 text-primary mb-1" />
              <p className="text-xs font-semibold">Segment-first storage</p>
              <p className="text-[11px] text-muted-foreground">Bus + microbus in one journey become two scored route candidates.</p>
            </div>
            <div className="rounded-2xl bg-background/35 border p-3">
              <MapPinned className="h-4 w-4 text-primary mb-1" />
              <p className="text-xs font-semibold">GTFS geometry lock</p>
              <p className="text-[11px] text-muted-foreground">A candidate only graduates when repeated traces agree on stops and shape.</p>
            </div>
            <div className="rounded-2xl bg-background/35 border p-3">
              <Star className="h-4 w-4 text-primary mb-1" />
              <p className="text-xs font-semibold">1–5 confidence</p>
              <p className="text-[11px] text-muted-foreground">Scores rise with unique riders, completed GPS, and positive reviews.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('routeDiscovery', language)}</h3>
        {discovery.length === 0 && <p className="text-muted-foreground text-sm">{t('noDiscovery', language)}</p>}
        {discovery.map((d, i) => (
          <Card key={`${d.transportName}-${d.transportNumber}-${i}`}>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {d.transportNumber ? `${d.transportNumber} · ` : ''}{d.transportName}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <Star className="h-3 w-3 fill-current" />
                    {(d.confidenceScore ?? 1).toFixed(1)}/5
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="h-3 w-3" />
                    {d.reportCount}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {d.reportCount} {t('usersReported', language)}
              </p>
              {(d.sampleFromArea || d.sampleToArea) && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {d.sampleFromArea || '?'} <ArrowRight className="h-3 w-3" /> {d.sampleToArea || '?'}
                </p>
              )}
              {d.avgPrice != null && (
                <p className="text-xs text-muted-foreground">
                  {t('avgPrice', language)}: {Math.round(d.avgPrice)} {t('egp', language)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                GPS traces: {d.gpsTraceCount ?? 0} · avg points: {Math.round(d.avgGpsPoints ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('pending', language)}</h3>
        {pending.length === 0 && <p className="text-muted-foreground text-sm">{t('noReports', language)}</p>}
        {pending.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-medium text-foreground">
                {r.transportNumber ? `${r.transportNumber} · ` : ''}{r.transportName}
              </p>
              {(r.fromArea || r.toArea) && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {r.fromArea || '?'} <ArrowRight className="h-3 w-3" /> {r.toArea || '?'}
                </p>
              )}
              {r.priceEgp != null && (
                <p className="text-xs text-muted-foreground">{Math.round(r.priceEgp)} {t('egp', language)}</p>
              )}
              <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-8" onClick={() => updateStatus(r.id, 'approved')}>
                  {t('approve', language)}
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => updateStatus(r.id, 'rejected')}>
                  {t('reject', language)}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminDiscovery;
