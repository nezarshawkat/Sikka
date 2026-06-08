import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import {
  ChevronUp, ChevronDown, Clock, Wallet, Check, MapPin, ArrowLeft, ArrowRight, Flag, ExternalLink,
} from 'lucide-react';

const ICONS: Record<string, string> = {
  bus: '🚌', train: '🚆', car: '🚕', bike: '🛺', ship: '🚢', plane: '✈️', metro: '🚇', monorail: '🚝', walk: '🚶',
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
}

const isTaxiLike = (seg: Pick<GuideSegment, 'icon' | 'transport_name'>) =>
  seg.icon === 'car' || /taxi|app|uber|careem|توك|تاكسي|أوبر|كريم/i.test(seg.transport_name);

function taxiAppUrlForSegment(seg: Pick<GuideSegment, 'start_name' | 'end_name'>) {
  const pickup = encodeURIComponent(seg.start_name);
  const dropoff = encodeURIComponent(seg.end_name);
  return `uber://?action=setPickup&pickup[formatted_address]=${pickup}&dropoff[formatted_address]=${dropoff}`;
}

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
}: TripGuideSheetProps) {
  const seg = plan.segments[currentSegIdx];
  if (!seg) return null;
  const isLast = currentSegIdx >= plan.segments.length - 1;
  const arrival = formatClock(remainingMinutes, language);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 px-3 pb-3">
      <motion.div
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
                      <Button asChild className="w-full h-11 rounded-[2rem] gap-2">
                        <a href={taxiAppUrlForSegment(seg)}>
                          <ExternalLink className="h-4 w-4" /> {t('openTaxiApps', language)}
                        </a>
                      </Button>
                    </div>
                  ) : seg.instructions && seg.instructions.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2">{t('instructionsHeader', language)}</p>
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
