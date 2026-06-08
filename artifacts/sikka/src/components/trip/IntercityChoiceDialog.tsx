import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { Bus, Car, Plane, Ship, TrainFront, UsersRound } from 'lucide-react';

export type TravelChoice = 'serfis' | 'intercity' | 'flight' | 'train' | 'taxi' | 'nile';

interface IntercityChoiceDialogProps {
  open: boolean;
  onClose: () => void;
  onChoose: (choice: TravelChoice) => void;
  fromName?: string;
  toName?: string;
  showSerfis?: boolean;
  showFlight?: boolean;
  showNile?: boolean;
  language: Language;
}

const optionMeta: Record<TravelChoice, { icon: typeof Bus; label: string; desc: string }> = {
  intercity: { icon: Bus, label: 'intercityOption', desc: 'intercityOptionDesc' },
  serfis: { icon: UsersRound, label: 'serfisOption', desc: 'serfisOptionDesc' },
  flight: { icon: Plane, label: 'flightOption', desc: 'flightOptionDesc' },
  train: { icon: TrainFront, label: 'trainOption', desc: 'trainOptionDesc' },
  taxi: { icon: Car, label: 'taxiAppOption', desc: 'taxiAppOptionDesc' },
  nile: { icon: Ship, label: 'nileOption', desc: 'nileOptionDesc' },
};

export default function IntercityChoiceDialog({
  open,
  onClose,
  onChoose,
  fromName,
  toName,
  showSerfis = false,
  showFlight = true,
  showNile = false,
  language,
}: IntercityChoiceDialogProps) {
  const destination = toName || '';
  const choices: TravelChoice[] = [
    'intercity',
    ...(showSerfis ? ['serfis' as const] : []),
    ...(showFlight ? ['flight' as const] : []),
    'train',
    'taxi',
    ...(showNile ? ['nile' as const] : []),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {destination ? t('chooseTravelToDestination', language).replace('{destination}', destination) : t('chooseTravelMode', language)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {fromName && toName && (
            <p className="text-sm text-muted-foreground text-center">
              {fromName} → {toName}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            {choices.map((choice) => {
              const Icon = optionMeta[choice].icon;
              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => onChoose(choice)}
                  className="flex min-h-[8rem] flex-col items-center gap-2 rounded-2xl border-2 border-border p-4 hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <Icon className="h-7 w-7 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{t(optionMeta[choice].label, language)}</span>
                  <span className="text-[11px] text-muted-foreground text-center leading-snug">
                    {t(optionMeta[choice].desc, language)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
