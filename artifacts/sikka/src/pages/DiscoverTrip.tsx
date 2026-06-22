import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bus, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';

type ModeKey = 'microbus' | 'bus';

const DiscoverTrip = () => {
  const { language } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<ModeKey>('microbus');

  const destination = params.get('destination') || '';

  const startHomeRecording = () => {
    sessionStorage.setItem('sikkaDiscoveryRecord', '1');
    sessionStorage.setItem('sikkaDiscoveryMode', mode);
    navigate('/', { replace: true });
  };

  const modeMeta: Record<ModeKey, { labelKey: string; hintKey: string }> = {
    microbus: { labelKey: 'microbus', hintKey: 'discoverMicrobusHint' },
    bus: { labelKey: 'bus', hintKey: 'discoverBusHint' },
  };

  const instructionKeys: Array<{ key: string }> = [
    { key: 'discoverInstructionChoose' },
    { key: 'discoverInstructionBusNumber' },
    { key: 'discoverInstructionStart' },
    { key: 'discoverInstructionStop' },
    { key: 'discoverInstructionSave' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-card/[0.92] backdrop-blur-2xl border-b z-10 p-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-semibold text-lg">{t('discoverJourneyTitle', language)}</h1>
          {destination ? (
            <p className="text-xs text-muted-foreground truncate max-w-[280px]">{destination}</p>
          ) : null}
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <div className="grid grid-cols-2 gap-3">
          {(['microbus', 'bus'] as ModeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`glass-panel rounded-[1.75rem] p-4 text-left border transition-all ${
                mode === key ? '!border-primary bg-primary/10' : 'border-white/20 bg-card/70'
              }`}
            >
              <Bus className="h-5 w-5 text-primary mb-2" />
              <p className="text-sm font-semibold text-foreground">{t(modeMeta[key].labelKey, language)}</p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                {t(modeMeta[key].hintKey, language)}
              </p>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <Button className="w-full h-16 rounded-[2rem] gap-2 text-base" onClick={startHomeRecording}>
            <Navigation className="h-5 w-5" />
            {t('recordGps', language)}
          </Button>
          <ol className="rounded-[1.5rem] border border-primary/15 bg-primary/[0.08] p-4 space-y-2">
            {instructionKeys.map(({ key }, index) => (
              <li key={key} className="flex gap-2 text-xs leading-relaxed text-foreground/85">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                <span>{t(key, language)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};

export default DiscoverTrip;
