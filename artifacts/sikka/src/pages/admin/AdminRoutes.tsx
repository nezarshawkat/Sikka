import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Route, Search } from 'lucide-react';

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
  routePath: { type: 'LineString'; coordinates: [number, number][] } | null;
}

interface TransportType {
  id: string;
  nameEn: string;
  nameAr: string;
  color: string;
}

const AdminRoutes = () => {
  const { language } = useAuth();
  const [routes, setRoutes] = useState<TransitLine[]>([]);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [typeId, setTypeId] = useState('all');
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/transit-lines'), api.get('/transport-types')])
      .then(([lines, types]) => {
        setRoutes(lines || []);
        setTransportTypes(types || []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const filteredRoutes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return routes.filter(route => {
      const typeMatch = typeId === 'all' || route.transportTypeId === typeId;
      const searchMatch = !q ||
        route.lineNumber?.toLowerCase().includes(q) ||
        route.nameEn?.toLowerCase().includes(q) ||
        route.nameAr?.includes(query) ||
        route.fromArea?.toLowerCase().includes(q) ||
        route.toArea?.toLowerCase().includes(q) ||
        route.viaStops?.some((stop: string) => stop.toLowerCase().includes(q));
      return typeMatch && searchMatch;
    });
  }, [query, routes, typeId]);

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  const typeById = new Map(transportTypes.map(t => [t.id, t]));

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-[280px_1fr]">
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
            <Card key={route.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" style={{ borderColor: type?.color, color: type?.color }}>{route.lineNumber || 'Route'}</Badge>
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
                  <span>{route.routePath ? 'Visible on map' : 'Auto-drawn on Admin Map'}</span>
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
