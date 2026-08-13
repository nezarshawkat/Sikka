import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import {
  ChevronUp, ChevronDown, Clock, Wallet, Check, MapPin, ArrowLeft, ArrowRight, Flag, ExternalLink,
  AlertTriangle, Volume2, VolumeX,
} from 'lucide-react';
import { useVoiceInstructions } from '@/hooks/useVoiceInstructions';
import TaxiAppButton from '@/components/trip/TaxiAppButton';

const ICONS: Record<string, string> = {
  bus: '🚌', train: '🚆', car: '🚕', bike: '🛺', tuktuk: '🛺', ship: '🚢', plane: '✈️', metro: '🚇', monorail: '🚝', lrt: '🚈', brt: '🚐', walk: '🚶',
};

export interface GuideAlternative {
  transport_type_id: string; transport_name: string; cost_egp: number; duration_minutes: number;
  color: string; icon: string; line_id?: string | null; line_number?: string | null; info?: string; instructions?: string[]; route_geometry?: [number, number][] | null;
}
export interface GuideSegment {
  transport_type_id?: string; transport_name: string; start_name: string; end_name: string;
  cost_egp: number; duration_minutes: number; color: string; icon: string;
  line_number?: string; info?: string; instructions?: string[]; alternatives?: GuideAlternative[];
}
export interface GuidePlan {
  segments: GuideSegment[]; total_cost_egp: number; total_duration_minutes: number; destination?: string;
}

interface TripGuideSheetProps {
  plan: GuidePlan;
  currentSegIdx: number;
  progress: number;
  remainingMinutes: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onNext: () => void;
  onBack: () => void;
  onDone: () => void;
  onClose?: () => void;
  onSwap: (segIdx: number, alt: GuideAlternative) => void;
  onReport?: () => void;
  language: Language;
  onHeightChange?: (height: number) => void;
  /** True when the rider's GPS has drifted meaningfully off the expected
   *  path for the current segment — wrong vehicle, missed turn, etc. */
  isOffRoute?: boolean;
}

const isTaxiLike = (seg: Pick<GuideSegment, 'icon' | 'transport_name'>) =>
  seg.icon === 'car' || /taxi|app|uber|careem|توك|تاكسي|أوبر|كريم/i.test(seg.transport_name);

function getIcon(icon: string) {
  return ICONS[icon] || '🚌';
}

function formatClock(minsFromNow: number, lang: Language): string {
  const d = new Date(Date.now() + minsFromNow * 60000);
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, '0');
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) || `${hh}:${mm}`;
}

export default function TripGuideSheet({
  plan, currentSegIdx, progress, remainingMinutes, expanded, onToggleExpand,
  onNext, onBack, onDone, onClose, onSwap, onReport, language,
  onHeightChange,
  isOffRoute,
}: TripGuideSheetProps) {
  const voice = useVoiceInstructions(language);
  const seg = plan.segments[currentSegIdx];
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Reads the new segment's instructions aloud the moment the rider moves
  // onto it — this is the whole point of voice guidance: it works even when
  // the sheet is minimized and nobody's looking at the screen. Off-route and
  // service-alert warnings take priority and interrupt if they fire instead.
  useEffect(() => {
    if (!seg?.instructions?.length) return;
    if (isOffRoute) {
      voice.speak(t('offRouteWarning', language));
      return;
    }
    voice.speak(seg.instructions.join('. '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSegIdx, isOffRoute, language]);

  useEffect(() => {
    if (!onHeightChange || !sheetRef.current) return;
    const node = sheetRef.current;
    const measure = () => onHeightChange(Math.ceil(node.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeightChange, expanded, currentSegIdx]);

  if (!seg) return null;
  const isLast = currentSegIdx >= plan.segments.length - 1;
  const arrival = formatClock(remainingMinutes, language);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 px-3 pb-3">
      <motion.div
        ref={sheetRef}
        layout
        initial={{ y: 140, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_e, info) => {
          if (info.offset.y < -60 && !expanded) onToggleExpand();
          if (info.offset.y > 60 && expanded) onToggleExpand();
        }}
        className="glass-panel rounded-[2rem] shadow-2xl border border-white/20 overflow-hidden flex flex-col max-h-[calc(100vh-7rem)]"
      >
        {/* drag handle / expand toggle */}
        <button
          onClick={onToggleExpand}
          className="w-full flex flex-col items-center pt-2 pb-1 shrink-0"
          aria-label="toggle"
        >
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </button>

        {/* Off-route warning — sustained GPS drift from the expected path */}
        {isOffRoute && (
          <div className="mx-3 mb-2 rounded-xl bg-destructive/10 border border-destructive/25 px-3 py-2 flex items-center gap-2 shrink-0">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive font-medium">{t('offRouteWarning', language)}</p>
          </div>
        )}

        {/* ===== MINIMIZED BAR ===== */}
        <div className="px-4 pb-3">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center text-xl shrink-0"
              style={{ backgroundColor: seg.color + '22' }}
            >
              {getIcon(seg.icon)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {seg.line_number && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1" style={{ borderColor: seg.color, color: seg.color }}>
                    {seg.line_number}
                  </Badge>
                )}
                <p className="text-sm font-semibold text-foreground truncate">{seg.transport_name}</p>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {Math.round(remainingMinutes)} {t('minLeft', language)} · {t('arrivalAt', language)} {arrival}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground">{currentSegIdx + 1}/{plan.segments.length}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleExpand}>
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <Progress value={progress} className="h-1.5 mt-2" />
        </div>

        {/* ===== EXPANDED CONTENT ===== */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <div className="px-4 pb-4 space-y-4">
                {/* overall ETA + cost */}
                <div className="flex items-center justify-between rounded-[2rem] bg-muted/45 backdrop-blur px-3 py-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{t('arrivalAt', language)} {arrival}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{Math.round(plan.total_cost_egp)} {t('egp', language)}</span>
                  </div>
                </div>

                {/* current segment route + instructions */}
                <div className="rounded-[2rem] border bg-background/35 backdrop-blur p-3" style={{ borderLeftWidth: 4, borderLeftColor: seg.color }}>
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium text-foreground truncate">{seg.start_name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground truncate">{seg.end_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                    <span>{Math.round(seg.duration_minutes)} {t('minutes', language)}</span>
                    <span>{Math.round(seg.cost_egp)} {t('egp', language)}</span>
                  </div>

                  {isTaxiLike(seg) ? (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-foreground">{seg.start_name} → {seg.end_name}</p>
                      <TaxiAppButton fromName={seg.start_name} toName={seg.end_name} label={t('openTaxiApps', language)} />
                    </div>
                  ) : seg.instructions && seg.instructions.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-foreground">{t('instructionsHeader', language)}</p>
                        {voice.supported && (
                          <button
                            onClick={() => {
                              if (voice.enabled) {
                                voice.setVoiceEnabled(false);
                              } else {
                                voice.setVoiceEnabled(true);
                                voice.speak(seg.instructions!.join('. '));
                              }
                            }}
                            className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center shrink-0"
                            title={voice.enabled ? t('voiceMute', language) : t('voiceEnable', language)}
                          >
                            {voice.enabled
                              ? <Volume2 className={`h-3.5 w-3.5 text-primary ${voice.speaking ? 'animate-pulse' : ''}`} />
                              : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
                          </button>
                        )}
                      </div>
                      <ol className="space-y-0.5">
                        {seg.instructions.map((ins, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground/85 rounded-[1.25rem] bg-card/45 px-3 py-1">
                            <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <span className="leading-snug">{ins}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {seg.info && !seg.instructions?.length && (
                    <p className="text-xs text-muted-foreground leading-snug">{seg.info}</p>
                  )}
                </div>

                {/* all segments overview */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">{t('allSteps', language)}</p>
                  {plan.segments.map((s, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded-[2rem] px-3 py-2 ${i === currentSegIdx ? 'bg-primary/10' : ''}`}
                    >
                      <span className="text-base">{getIcon(s.icon)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {s.line_number ? `${s.line_number} · ` : ''}{s.transport_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">{s.start_name} → {s.end_name}</p>
                      </div>
                      {i < currentSegIdx && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                    </div>
                  ))}
                </div>

                {onReport && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full gap-2 text-muted-foreground"
                    onClick={onReport}
                  >
                    <Flag className="h-4 w-4" /> {t('reportProblem', language)}
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ===== ACTION BAR ===== */}
        <div className="px-4 py-3 border-t flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-11 rounded-[2rem] gap-1"
            onClick={onBack}
            disabled={currentSegIdx === 0}
          >
            <ArrowLeft className="h-4 w-4" /> {t('back', language)}
          </Button>
          {!isLast ? (
            <>
              <Button size="sm" className="h-11 flex-1 rounded-[2rem] gap-1" onClick={onDone}>
                <Check className="h-4 w-4" /> {t('iArrived', language)}
              </Button>
              <Button variant="secondary" size="sm" className="h-11 rounded-[2rem] gap-1" onClick={onNext}>
                {t('next', language)} <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-11 flex-1 rounded-[2rem] gap-1" onClick={onDone}>
              <Check className="h-4 w-4" /> {t('finishTrip', language)}
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
