import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

interface Location {
  id: string;
  nameEn: string;
  nameAr: string;
  latitude: number;
  longitude: number;
  city: string;
  isStation: boolean;
}

const AdminLocations = () => {
  const { language } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLocations = async () => {
    try {
      const data = await api.get<Location[]>('/locations');
      setLocations(data ?? []);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to load'); }
    setIsLoading(false);
  };

  useEffect(() => { fetchLocations(); }, []);

  const addLocation = async () => {
    try {
      const row = await api.post<Location>('/locations', {
        nameEn: 'New Location', nameAr: 'موقع جديد',
        latitude: 30.0444, longitude: 31.2357, city: 'cairo',
      });
      setLocations(prev => [...prev, row]);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to add'); }
  };

  const updateLocation = async (id: string, updates: Partial<Location>) => {
    try {
      await api.put(`/locations/${id}`, updates);
      toast.success('Updated');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to update'); }
  };

  const deleteLocation = async (id: string) => {
    try {
      await api.delete(`/locations/${id}`);
      setLocations(prev => prev.filter(l => l.id !== id));
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to delete'); }
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      <Button onClick={addLocation} size="sm" className="gap-1.5">
        <Plus className="h-4 w-4" />
        {t('add', language)}
      </Button>

      {locations.map((loc) => (
        <Card key={loc.id}>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={loc.nameEn}
                onChange={(e) => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, nameEn: e.target.value } : l))}
                onBlur={() => updateLocation(loc.id, { nameEn: loc.nameEn })}
                placeholder="Name (EN)"
                className="text-sm"
              />
              <Input
                value={loc.nameAr}
                onChange={(e) => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, nameAr: e.target.value } : l))}
                onBlur={() => updateLocation(loc.id, { nameAr: loc.nameAr })}
                placeholder="Name (AR)"
                dir="rtl"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input
                type="number"
                value={loc.latitude}
                onChange={(e) => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, latitude: +e.target.value } : l))}
                onBlur={() => updateLocation(loc.id, { latitude: loc.latitude })}
                placeholder="Lat"
                className="text-sm"
              />
              <Input
                type="number"
                value={loc.longitude}
                onChange={(e) => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, longitude: +e.target.value } : l))}
                onBlur={() => updateLocation(loc.id, { longitude: loc.longitude })}
                placeholder="Lng"
                className="text-sm"
              />
              <Input
                value={loc.city}
                onChange={(e) => setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, city: e.target.value } : l))}
                onBlur={() => updateLocation(loc.id, { city: loc.city })}
                placeholder="City"
                className="text-sm"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={loc.isStation}
                  onCheckedChange={(checked) => {
                    setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, isStation: checked } : l));
                    updateLocation(loc.id, { isStation: checked });
                  }}
                />
                Station
              </label>
              <Button variant="ghost" size="icon" onClick={() => deleteLocation(loc.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AdminLocations;
