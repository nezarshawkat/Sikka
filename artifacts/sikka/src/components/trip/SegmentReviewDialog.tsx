import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { toast } from 'sonner';

const FACES = ['😞', '😐', '🙂', '😊', '🤩'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewSegment {
  transport_type_id?: string;
  transport_name?: string;
}

interface SegmentReviewDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  segment: ReviewSegment | null;
  /** When true, render the end-of-trip (trip-level) review variant. */
  tripLevel?: boolean;
  tripId?: string | null;
  language: Language;
}

const QUESTION_KEYS = [
  { key: 'routeAccurate', label: 'qRouteAccurate' },
  { key: 'timingAccurate', label: 'qTimingAccurate' },
  { key: 'qualityGood', label: 'qQualityGood' },
  { key: 'stationInfoCorrect', label: 'qStationInfoCorrect' },
] as const;

export default function SegmentReviewDialog({
  open,
  onClose,
  onSubmitted,
  segment,
  tripLevel = false,
  tripId = null,
  language,
}: SegmentReviewDialogProps) {
  const [face, setFace] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [appRating, setAppRating] = useState<number | null>(null);
  const [navRating, setNavRating] = useState<number | null>(null);
  const [accRating, setAccRating] = useState<number | null>(null);

  const reset = () => {
    setFace(null);
    setAnswers({});
    setComment('');
    setAppRating(null);
    setNavRating(null);
    setAccRating(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSkip = () => {
    reset();
    onSubmitted?.();
    onClose();
  };

  const resolveTransportTypeId = (): string | null => {
    const id = segment?.transport_type_id;
    return id && UUID_RE.test(id) ? id : null;
  };

  const handleSubmit = async () => {
    if (face == null) {
      toast.error(t('selectFace', language));
      return;
    }
    setSubmitting(true);
    try {
      const rating = face + 1;
      if (tripLevel) {
        await api.post('/reviews', {
          reviewType: 'trip',
          transportTypeId: null,
          tripSegmentId: null,
          tripId: tripId || null,
          faceReaction: rating,
          rating,
          comment: comment || null,
          meta: { appRating, navigationRating: navRating, accuracyRating: accRating },
        });
      } else {
        await api.post('/reviews', {
          reviewType: 'segment',
          transportTypeId: resolveTransportTypeId(),
          tripSegmentId: null,
          faceReaction: rating,
          rating,
          routeAccurate: answers.routeAccurate ?? null,
          timingAccurate: answers.timingAccurate ?? null,
          qualityGood: answers.qualityGood ?? null,
          stationInfoCorrect: answers.stationInfoCorrect ?? null,
          comment: comment || null,
          meta: {
            transportName: segment?.transport_name ?? null,
            transportSlug: segment?.transport_type_id ?? null,
          },
        });
      }
      toast.success(t('reviewThanks', language));
      reset();
      onSubmitted?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('reviewFailed', language));
    } finally {
      setSubmitting(false);
    }
  };

  const StarRow = ({ value, onPick }: { value: number | null; onPick: (n: number) => void }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          className={`text-xl leading-none ${value != null && n <= value ? 'opacity-100' : 'opacity-30'}`}
        >
          ⭐
        </button>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {tripLevel ? t('tripReviewTitle', language) : t('segmentReviewTitle', language)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!tripLevel && segment?.transport_name && (
            <p className="text-sm text-muted-foreground">{segment.transport_name}</p>
          )}

          <div>
            <p className="text-sm font-medium mb-2">{t('howWasIt', language)}</p>
            <div className="flex justify-between">
              {FACES.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFace(i)}
                  className={`text-3xl transition-transform ${face === i ? 'scale-125' : 'opacity-50 hover:opacity-90'}`}
                  aria-label={`face-${i + 1}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {!tripLevel ? (
            <div className="space-y-2">
              {QUESTION_KEYS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{t(label, language)}</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={answers[key] === true ? 'default' : 'outline'}
                      className="h-7 px-3 text-xs"
                      onClick={() => setAnswers((a) => ({ ...a, [key]: true }))}
                    >
                      {t('yes', language)}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={answers[key] === false ? 'default' : 'outline'}
                      className="h-7 px-3 text-xs"
                      onClick={() => setAnswers((a) => ({ ...a, [key]: false }))}
                    >
                      {t('no', language)}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('appRating', language)}</span>
                <StarRow value={appRating} onPick={setAppRating} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('navigationRating', language)}</span>
                <StarRow value={navRating} onPick={setNavRating} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t('accuracyRating', language)}</span>
                <StarRow value={accRating} onPick={setAccRating} />
              </div>
            </div>
          )}

          <Textarea
            placeholder={t('leaveComment', language)}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11 rounded-[2rem]" onClick={handleSkip} disabled={submitting}>
              {t('skip', language)}
            </Button>
            <Button className="flex-1 h-11 rounded-[2rem]" onClick={handleSubmit} disabled={submitting}>
              {t('submit', language)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
