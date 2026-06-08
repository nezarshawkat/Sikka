import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';

interface Report {
  id: string;
  reportType: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  createdAt: string;
}

const STATUS_FILTERS = ['all', 'open', 'resolved', 'rejected'];

const AdminReports = () => {
  const { language } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = (status: string) => {
    setIsLoading(true);
    const path = status === 'all' ? '/reports' : `/reports?status=${status}`;
    api.get<Report[]>(path)
      .then((data) => setReports(data ?? []))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed to load reports'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchReports(statusFilter); }, [statusFilter]);

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/reports/${id}`, { status });
      setReports((prev) =>
        statusFilter === 'all'
          ? prev.map((r) => (r.id === id ? { ...r, status } : r))
          : prev.filter((r) => r.id !== id),
      );
      toast.success(t('planUpdated', language));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const statusColor = (s: string) =>
    s === 'resolved' ? 'text-green-500' : s === 'rejected' ? 'text-destructive' : 'text-yellow-500';

  return (
    <div className="space-y-4">
      <div className="w-44">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder={t('filterByStatus', language)} />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? t('allStatuses', language) : t(s, language)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {!isLoading && reports.length === 0 && <p className="text-muted-foreground text-sm">{t('noReports', language)}</p>}

      {reports.map((report) => (
        <Card key={report.id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline">{t(`rt_${report.reportType}`, language)}</Badge>
              <span className={`text-xs font-medium ${statusColor(report.status)}`}>
                {t(report.status, language)}
              </span>
            </div>
            {report.description && <p className="text-sm text-foreground">{report.description}</p>}
            {report.latitude != null && report.longitude != null && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{new Date(report.createdAt).toLocaleString()}</p>
            {report.status === 'open' && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-8" onClick={() => updateStatus(report.id, 'resolved')}>
                  {t('resolve', language)}
                </Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => updateStatus(report.id, 'rejected')}>
                  {t('reject', language)}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AdminReports;
