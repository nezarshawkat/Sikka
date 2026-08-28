import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { requestAppRating } from '@/lib/nativeRating';
import { toast } from 'sonner';

interface RateUsDialogProps {
  open: boolean;
  onClose: () => void;
  language: Language;
  refreshProfile: () => Promise<void>;
}

export default function RateUsDialog({ open, onClose, language, refreshProfile }: RateUsDialogProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleStarTap = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await requestAppRating();
    } finally {
      // Whatever star count was tapped and whatever happened with the
      // native flow, this rider has now gone through the rating prompt --
      // it never appears again for them, same as if they'd tapped any
      // other star count. Only "Later" leaves it eligible to show again.
      await api.put('/profile', { hasRatedApp: true }).catch(() => {});
      await refreshProfile().catch(() => {});
      toast.success(t('rateUsThanks', language));
      setSubmitting(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="text-center">{t('rateUsTitle', language)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pb-1">
          <p className="text-sm text-muted-foreground text-center">{t('rateUsBody', language)}</p>

          <div className="flex justify-center gap-2" onMouseLeave={() => setHovered(null)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                disabled={submitting}
                onClick={() => handleStarTap()}
                onMouseEnter={() => setHovered(n)}
                aria-label={`${n} star`}
                className={`text-4xl leading-none transition-transform ${
                  hovered != null && n <= hovered ? 'scale-110' : ''
                } ${submitting ? 'opacity-50' : 'opacity-90 hover:opacity-100'}`}
              >
                ⭐
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            className="w-full h-10 rounded-[2rem] text-muted-foreground"
            disabled={submitting}
            onClick={onClose}
          >
            {t('rateUsLater', language)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
