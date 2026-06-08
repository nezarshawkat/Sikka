import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Star, Trash2, Check, X } from 'lucide-react';

const FACES = ['😞', '😐', '🙂', '😊', '🤩'];

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  reviewType: string;
  faceReaction: number | null;
  routeAccurate: boolean | null;
  timingAccurate: boolean | null;
  qualityGood: boolean | null;
  stationInfoCorrect: boolean | null;
  transportTypeId: string | null;
  createdAt: string;
}

const QUESTION_KEYS = [
  { key: 'routeAccurate', label: 'qRouteAccurate' },
  { key: 'timingAccurate', label: 'qTimingAccurate' },
  { key: 'qualityGood', label: 'qQualityGood' },
  { key: 'stationInfoCorrect', label: 'qStationInfoCorrect' },
] as const;

const AdminReviews = () => {
  const { language } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.get<Review[]>('/reviews')
      .then((data) => setReviews(data ?? []))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed to load reviews'))
      .finally(() => setIsLoading(false));
  }, []);

  const deleteReview = async (id: string) => {
    try {
      await api.delete(`/reviews/${id}`);
      setReviews(prev => prev.filter(r => r.id !== id));
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to delete review'); }
  };

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      {reviews.length === 0 && <p className="text-muted-foreground text-sm">No reviews yet.</p>}
      {reviews.map((review) => (
        <Card key={review.id}>
          <CardContent className="p-4 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                {review.faceReaction != null && (
                  <span className="text-xl leading-none">{FACES[review.faceReaction - 1] ?? '🙂'}</span>
                )}
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-4 w-4 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-muted'}`} />
                  ))}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {review.reviewType === 'trip' ? t('tripReviewTitle', language) : t('segmentReviewTitle', language)}
                </Badge>
              </div>

              {review.comment && <p className="text-sm text-foreground">{review.comment}</p>}

              {review.reviewType !== 'trip' && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {QUESTION_KEYS.map(({ key, label }) => {
                    const val = review[key as keyof Review] as boolean | null;
                    if (val == null) return null;
                    return (
                      <span key={key} className="text-[11px] text-muted-foreground flex items-center gap-1">
                        {val ? <Check className="h-3 w-3 text-green-500" /> : <X className="h-3 w-3 text-destructive" />}
                        {t(label, language)}
                      </span>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {new Date(review.createdAt).toLocaleDateString()}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => deleteReview(review.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AdminReviews;
