import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { toast } from 'sonner';

interface MicrobusUsedDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the user submits or skips so the trip can continue. */
  onDone: () => void;
  transportName?: string;
  fromArea?: string;
  toArea?: string;
  language: Language;
}

interface TransportType {
  id: string;
  nameEn: string;
}

export default function MicrobusUsedDialog({
  open,
  onClose,
  onDone,
  transportName,
  fromArea,
  toArea,
  language,
}: MicrobusUsedDialogProps) {
  const [boardingArea, setBoardingArea] = useState('');
  const [routeEnd, setRouteEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);

  useEffect(() => {
    if (!open) return;
    setBoardingArea(fromArea || '');
    setRouteEnd(toArea || '');
    let cancelled = false;
    api
      .get('/transport-types')
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setTransportTypes(data as TransportType[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, fromArea, toArea]);

  const finish = () => {
    onClose();
    onDone();
  };

  const handleSubmit = async () => {
    if (!boardingArea.trim() || !routeEnd.trim()) {
      toast.error(t('microbusRouteDetailsRequired', language));
      return;
    }
    setSubmitting(true);
    try {
      const transportTypeId =
        transportTypes.find((tt) =>
          tt.nameEn.toLowerCase().includes('microbus') ||
          tt.nameEn.toLowerCase().includes('micro')
        )?.id ?? null;

      await api.post('/transport-reports', {
        transportName: transportName || 'Microbus',
        transportNumber: null,
        transportTypeId,
        fromArea: boardingArea.trim(),
        toArea: routeEnd.trim(),
        priceEgp: null,
        gpsTrace: null,
      });
      toast.success(t('busUsedThanks', language));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('contributeFailed', language));
    } finally {
      setSubmitting(false);
      finish();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t('microbus', language)} — {t('busUsedTitle', language)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t('busUsedQuestion', language)}
          </p>

          <div>
            <label className="text-xs text-muted-foreground">
              {t('microbusBoardingArea', language)}
            </label>
            <Input
              value={boardingArea}
              onChange={(e) => setBoardingArea(e.target.value)}
              placeholder={fromArea || t('microbusBoardingArea', language)}
              className="text-sm mt-1"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">
              {t('microbusRouteEnd', language)}
            </label>
            <Input
              value={routeEnd}
              onChange={(e) => setRouteEnd(e.target.value)}
              placeholder={toArea || t('microbusRouteEnd', language)}
              className="text-sm mt-1"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={finish} disabled={submitting}>
              {t('skip', language) || 'Skip'}
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
              {t('submit', language)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
