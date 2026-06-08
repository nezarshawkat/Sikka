import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

interface TransportType {
  id: string;
  nameEn: string;
  nameAr: string;
  icon: string;
  averageSpeedKmh: number;
  basePriceEgp: number;
  pricePerKmEgp: number;
  isActive: boolean;
  foreignerAllowed: boolean;
  color: string;
}

const AdminTransport = () => {
  const { language } = useAuth();
  const [types, setTypes] = useState<TransportType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTypes = async () => {
    try {
      const data = await api.get<TransportType[]>('/transport-types');
      setTypes(data ?? []);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to load'); }
    setIsLoading(false);
  };

  useEffect(() => { fetchTypes(); }, []);

  const updateType = async (id: string, updates: Partial<TransportType>) => {
    try {
      await api.put(`/transport-types/${id}`, updates);
      setTypes(prev => prev.map(tt => tt.id === id ? { ...tt, ...updates } : tt));
      toast.success('Updated');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to update'); }
  };

  const addType = async () => {
    try {
      const row = await api.post<TransportType>('/transport-types', {
        nameEn: 'New Transport', nameAr: 'مواصلات جديدة',
        icon: 'bus', averageSpeedKmh: 30, basePriceEgp: 5, pricePerKmEgp: 1, color: '#3B82F6',
      });
      setTypes(prev => [...prev, row]);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to add'); }
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <Button onClick={addType} size="sm" className="gap-1.5">
        <Plus className="h-4 w-4" />
        {t('add', language)}
      </Button>

      {types.map((tt) => (
        <Card key={tt.id}>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Name (EN)</label>
                <Input
                  value={tt.nameEn}
                  onChange={(e) => setTypes(prev => prev.map(t => t.id === tt.id ? { ...t, nameEn: e.target.value } : t))}
                  onBlur={() => updateType(tt.id, { nameEn: tt.nameEn })}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Name (AR)</label>
                <Input
                  value={tt.nameAr}
                  onChange={(e) => setTypes(prev => prev.map(t => t.id === tt.id ? { ...t, nameAr: e.target.value } : t))}
                  onBlur={() => updateType(tt.id, { nameAr: tt.nameAr })}
                  className="text-sm"
                  dir="rtl"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t('speed', language)}</label>
                <Input
                  type="number"
                  value={tt.averageSpeedKmh}
                  onChange={(e) => setTypes(prev => prev.map(t => t.id === tt.id ? { ...t, averageSpeedKmh: +e.target.value } : t))}
                  onBlur={() => updateType(tt.id, { averageSpeedKmh: tt.averageSpeedKmh })}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Base Price</label>
                <Input
                  type="number"
                  value={tt.basePriceEgp}
                  onChange={(e) => setTypes(prev => prev.map(t => t.id === tt.id ? { ...t, basePriceEgp: +e.target.value } : t))}
                  onBlur={() => updateType(tt.id, { basePriceEgp: tt.basePriceEgp })}
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Per KM</label>
                <Input
                  type="number"
                  value={tt.pricePerKmEgp}
                  onChange={(e) => setTypes(prev => prev.map(t => t.id === tt.id ? { ...t, pricePerKmEgp: +e.target.value } : t))}
                  onBlur={() => updateType(tt.id, { pricePerKmEgp: tt.pricePerKmEgp })}
                  className="text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={tt.isActive}
                  onCheckedChange={(checked) => updateType(tt.id, { isActive: checked })}
                />
                {t('active', language)}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={tt.foreignerAllowed}
                  onCheckedChange={(checked) => updateType(tt.id, { foreignerAllowed: checked })}
                />
                Foreigners
              </label>
              <input
                type="color"
                value={tt.color}
                onChange={(e) => updateType(tt.id, { color: e.target.value })}
                className="h-8 w-8 rounded cursor-pointer"
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AdminTransport;
