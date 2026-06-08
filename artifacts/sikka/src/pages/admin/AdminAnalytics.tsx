import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Users, Route, Star, Train } from 'lucide-react';

interface AnalyticsStats { users: number; trips: number; reviews: number; routes: number }
interface Review { rating: number; transportTypeId: string | null }
interface Report { reportType: string }
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
    { label: 'Users', value: stats.users, icon: Users, color: 'text-primary' },
    { label: 'Trips', value: stats.trips, icon: Route, color: 'text-accent' },
    { label: t('reviews', language), value: stats.reviews, icon: Star, color: 'text-yellow-500' },
    { label: t('routes', language), value: stats.routes, icon: Train, color: 'text-destructive' },
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

  const reportsByType = useMemo(() => {
    const map = new Map<string, number>();
    reports.forEach((r) => map.set(r.reportType, (map.get(r.reportType) ?? 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [reports]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`h-8 w-8 ${color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('mostReviewed', language)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {perType.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
          {perType.map(({ id, count, avg }) => (
            <div key={id} className="flex items-center justify-between text-sm">
              <span className="text-foreground truncate">{typeName(id)}</span>
              <span className="text-muted-foreground flex items-center gap-2">
                <span className="flex items-center gap-0.5">
                  <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                  {avg.toFixed(1)}
                </span>
                <span className="text-xs">({count})</span>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('reportsByType', language)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reportsByType.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
          {reportsByType.map(([type, count]) => (
            <div key={type} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{t(`rt_${type}`, language)}</span>
              <span className="text-muted-foreground text-xs">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAnalytics;
