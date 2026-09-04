import { useEffect, useState } from 'react';
import { Save, Smartphone, BadgeAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { DEFAULT_APP_CONFIG, type MobileAppConfig } from '@/lib/appConfig';

export default function AdminAppSettings() {
  const [config, setConfig] = useState<MobileAppConfig>(DEFAULT_APP_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<MobileAppConfig>('/app-config')
      .then((data) => setConfig({ ...DEFAULT_APP_CONFIG, ...data }))
      .catch(() => toast.error('Could not load app settings.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.put<MobileAppConfig>('/app-config', config);
      setConfig({ ...DEFAULT_APP_CONFIG, ...saved });
      toast.success('App settings saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save app settings.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="mx-auto max-w-2xl space-y-5">
    <div>
      <h2 className="text-xl font-semibold">App settings</h2>
      <p className="text-sm text-muted-foreground">Control AdMob placement and mandatory Google Play updates without releasing a new app.</p>
    </div>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" />Advertising</CardTitle><CardDescription>Ads stay disabled until the AdMob SDK and ad-unit IDs are installed.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <SettingSwitch label="Enable interstitial ads" checked={config.adsEnabled} onChange={(adsEnabled) => setConfig({ ...config, adsEnabled })} />
        <SettingSwitch label="Show after current location loads" checked={config.showAdAfterLocation} onChange={(showAdAfterLocation) => setConfig({ ...config, showAdAfterLocation })} />
        <SettingSwitch label="Show after a trip review" checked={config.showAdAfterTripReview} onChange={(showAdAfterTripReview) => setConfig({ ...config, showAdAfterTripReview })} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BadgeAlert className="h-5 w-5" />Required update</CardTitle><CardDescription>Leave the minimum build empty to disable the update gate. Users below this Android build cannot dismiss it.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="minimum-build">Minimum Android build number</Label><Input id="minimum-build" type="number" min="1" value={config.minimumAndroidVersion ?? ''} onChange={(event) => setConfig({ ...config, minimumAndroidVersion: event.target.value ? Number(event.target.value) : null })} /></div>
        <div className="space-y-2"><Label htmlFor="play-store-url">Google Play Store URL</Label><Input id="play-store-url" type="url" placeholder="https://play.google.com/store/apps/details?id=…" value={config.playStoreUrl} onChange={(event) => setConfig({ ...config, playStoreUrl: event.target.value })} /></div>
      </CardContent>
    </Card>

    <Button className="gap-2" onClick={() => void save()} disabled={loading || saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save settings'}</Button>
  </div>;
}

function SettingSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onChange} /></div>;
}
