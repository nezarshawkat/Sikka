import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { toast } from 'sonner';

type Operator = 'nta' | 'cta';

interface TransportType {
  id: string;
  nameEn: string;
}

const OPERATOR_TYPE_NAME: Record<Operator, string> = {
  nta: 'NTA Bus',
  cta: 'CTA Bus',
};

interface BusUsedDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the user submits or skips, so the trip can continue. */
  onDone: () => void;
  transportName?: string;
  fromArea?: string;
  toArea?: string;
  language: Language;
}

export default function BusUsedDialog({
  open,
  onClose,
  onDone,
  transportName,
  fromArea,
  toArea,
  language,
}: BusUsedDialogProps) {
  const [busNumber, setBusNumber] = useState('');
  const [operator, setOperator] = useState<Operator>('nta');
  const [submitting, setSubmitting] = useState(false);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);

  useEffect(() => {
    if (!open) return;
    setBusNumber('');
    setOperator('nta');
    let cancelled = false;
    api
      .get('/transport-types')
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setTransportTypes(data as TransportType[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const finish = () => {
    onClose();
    onDone();
  };

  const handleSubmit = async () => {
    if (!busNumber.trim()) {
      toast.error(t('busNumberRequired', language));
      return;
    }
    setSubmitting(true);
    try {
      const transportTypeId =
        transportTypes.find((tt) => tt.nameEn === OPERATOR_TYPE_NAME[operator])?.id ?? null;
      await api.post('/transport-reports', {
        transportName: transportName || OPERATOR_TYPE_NAME[operator],
        transportNumber: busNumber.trim(),
        transportTypeId,
        fromArea: fromArea || null,
        toArea: toArea || null,
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
    <Dialog open={open} onOpenChange={(o) => !o && finish()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('busUsedTitle', language)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('busUsedQuestion', language)}</p>

          <div>
            <label className="text-xs text-muted-foreground">{t('operatorLabel', language)}</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(['nta', 'cta'] as Operator[]).map((op) => (
                <Button
                  key={op}
                  type="button"
                  variant={operator === op ? 'default' : 'outline'}
                  className="w-full text-xs"
                  onClick={() => setOperator(op)}
                >
                  {t(op === 'nta' ? 'operatorNta' : 'operatorCta', language)}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">{t('busNumber', language)}</label>
            <Input
              value={busNumber}
              onChange={(e) => setBusNumber(e.target.value)}
              placeholder={t('busNumberPlaceholder', language)}
              className="text-sm"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={finish} disabled={submitting}>
              {t('skip', language)}
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
