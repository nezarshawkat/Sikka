import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Users, Route, Star, Train, TrendingUp, MessageSquare, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AnalyticsStats { users: number; trips: number; reviews: number; routes: number }
interface Review { rating: number; transportTypeId: string | null; createdAt: string }
interface Report { reportType: string; createdAt: string }
interface TransportType { id: string; nameEn: string; nameAr: string }

const AdminAnalytics = () => {
  const { language } = useAuth();
  const [stats, setStats] = useState<AnalyticsStats>({ users: 0, trips: 0, reviews: 0, routes: 0 });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [types, setTypes] = useState<TransportType[]>([]);

  useEffect(() => {
    api.get<AnalyticsStats>('/analytics')
      .then((data) => setStats(data ?? { users: 0, trips: 0, reviews: 0, routes: 0 }))
      .catch(() => {});
    api.get<Review[]>('/reviews').then((d) => setReviews(d ?? [])).catch(() => {});
    api.get<Report[]>('/reports').then((d) => setReports(d ?? [])).catch(() => {});
    api.get<TransportType[]>('/transport-types').then((d) => setTypes(d ?? [])).catch(() => {});
  }, []);

  const cards = [
    { label: 'Users', value: stats.users, icon: Users, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
    { label: 'Trips', value: stats.trips, icon: Route, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
    { label: t('reviews', language), value: stats.reviews, icon: Star, color: 'text-yellow-500', bgColor: 'bg-yellow-500/10' },
    { label: t('routes', language), value: stats.routes, icon: Train, color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
  ];

  const typeName = (id: string) => {
    const tt = types.find((x) => x.id === id);
    if (!tt) return id;
    return language === 'ar' ? tt.nameAr : tt.nameEn;
  };

  const perType = useMemo(() => {
    const map = new Map<string, { count: number; sum: number }>();
    reviews.forEach((r) => {
      if (!r.transportTypeId) return;
      const e = map.get(r.transportTypeId) ?? { count: 0, sum: 0 };
      e.count += 1;
      e.sum += r.rating;
      map.set(r.transportTypeId, e);
    });
    return Array.from(map.entries())
      .map(([id, { count, sum }]) => ({ id, count, avg: sum / count }))
      .sort((a, b) => b.count - a.count);
  }, [reviews]);

  const topRatedTransport = useMemo(() => {
    return perType.filter(p => p.avg >= 4).sort((a, b) => b.avg - a.avg).slice(0, 5);
  }, [perType]);

  const reportsByType = useMemo(() => {
    const map = new Map<string, number>();
    reports.forEach((r) => map.set(r.reportType, (map.get(r.reportType) ?? 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [reports]);

  const reportStats = useMemo(() => {
    const resolved = reports.filter(r => r.reportType === 'resolved').length;
    const unresolved = reports.filter(r => r.reportType === 'unresolved').length;
    const pending = reports.filter(r => r.reportType === 'pending').length;
    return { resolved, unresolved, pending };
  }, [reports]);

  const avgRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    return (sum / reviews.length).toFixed(1);
  }, [reviews]);

  const tripsPerDay = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return stats.trips; // This is a simplified metric
  }, [stats.trips]);

  return (
    <div className="space-y-6">
      {/* Main Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(({ label, value, icon: Icon, color, bgColor }) => (
          <Card key={label} className="glass-panel rounded-[2rem]">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className={`text-3xl font-bold ${color}`}>{value.toLocaleString()}</p>
                </div>
                <div className={`h-12 w-12 rounded-full ${bgColor} flex items-center justify-center shrink-0`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="glass-panel rounded-[2rem]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              <p className="text-xs text-muted-foreground">Average Rating</p>
            </div>
            <p className="text-2xl font-bold">{avgRating}</p>
            <p className="text-xs text-muted-foreground mt-2">from {reviews.length} reviews</p>
          </CardContent>
        </Card>

        <Card className="glass-panel rounded-[2rem]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <p className="text-xs text-muted-foreground">Unique Routes</p>
            </div>
            <p className="text-2xl font-bold">{stats.routes}</p>
            <p className="text-xs text-muted-foreground mt-2">in the system</p>
          </CardContent>
        </Card>

        <Card className="glass-panel rounded-[2rem]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-blue-500" />
              <p className="text-xs text-muted-foreground">Total Reports</p>
            </div>
            <p className="text-2xl font-bold">{reports.length}</p>
            <p className="text-xs text-muted-foreground mt-2">from community</p>
          </CardContent>
        </Card>
      </div>

      {/* Report Status */}
      <Card className="glass-panel rounded-[2rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Report Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <p className="text-xs text-muted-foreground">Resolved</p>
              </div>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{reportStats.resolved}</p>
            </div>
            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400">{reportStats.pending}</p>
            </div>
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <p className="text-xs text-muted-foreground">Unresolved</p>
              </div>
              <p className="text-lg font-bold text-destructive">{reportStats.unresolved}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top-Rated Transportations */}
      <Card className="glass-panel rounded-[2rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
            Top-Rated Transportations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {topRatedTransport.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No highly-rated transports yet</p>
          )}
          {topRatedTransport.map(({ id, count, avg }, idx) => (
            <div key={id} className="flex items-center justify-between p-3 rounded-lg bg-background/30 hover:bg-background/50 transition-colors">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="h-8 w-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-sm font-bold text-yellow-600 dark:text-yellow-400 shrink-0">
                  {idx + 1}
                </div>
                <p className="text-sm font-medium truncate">{typeName(id)}</p>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: Math.round(avg) }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400">{avg.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground">({count})</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Most Reviewed Transportations */}
      <Card className="glass-panel rounded-[2rem]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Most Reviewed Transportations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {perType.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
          {perType.slice(0, 10).map(({ id, count, avg }) => {
            const percentage = (count / Math.max(...perType.map(p => p.count))) * 100;
            return (
              <div key={id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate">{typeName(id)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground text-xs">{count} reviews</span>
                    <span className="flex items-center gap-0.5">
                      <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                      <span className="text-xs font-semibold">{avg.toFixed(1)}</span>
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Report Types Distribution */}
      {reportsByType.length > 0 && (
        <Card className="glass-panel rounded-[2rem]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Report Types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reportsByType.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-sm p-2 rounded-lg bg-background/30">
                <span className="text-foreground">{t(`rt_${type}`, language) || type}</span>
                <span className="text-muted-foreground text-xs font-bold">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminAnalytics;
