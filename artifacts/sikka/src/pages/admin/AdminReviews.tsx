import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Star, Trash2, Check, X, Filter } from 'lucide-react';

const FACES = ['😞', '😐', '🙂', '😊', '🤩'];

interface TransportType {
  id: string;
  nameEn: string;
  nameAr: string;
}

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
  transportName?: string;
  transportNumber?: string;
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
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'trip' | 'transportation'>('all');
  const [selectedTransport, setSelectedTransport] = useState<string>('all');

  useEffect(() => {
    Promise.all([
      api.get<Review[]>('/reviews'),
      api.get<TransportType[]>('/transport-types'),
    ])
      .then(([data, types]) => {
        setReviews(data ?? []);
        setTransportTypes(types ?? []);
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed to load reviews'))
      .finally(() => setIsLoading(false));
  }, []);

  const deleteReview = async (id: string) => {
    try {
      await api.delete(`/reviews/${id}`);
      setReviews(prev => prev.filter(r => r.id !== id));
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed to delete review'); }
  };

  const filteredReviews = reviews.filter(review => {
    // Filter by review type
    if (filterType !== 'all' && review.reviewType !== filterType) return false;
    
    // Filter by transportation (only for transportation reviews)
    if (selectedTransport !== 'all' && review.transportTypeId !== selectedTransport) return false;
    
    return true;
  });

  const transportNames = new Set(reviews
    .filter(r => r.reviewType === 'transportation' && r.transportTypeId)
    .map(r => r.transportTypeId)
  );

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3 p-4 rounded-[1.5rem] border bg-card/50">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Filters</h3>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Review Type</label>
            <div className="flex gap-2">
              <Button
                variant={filterType === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('all')}
                className="flex-1"
              >
                All
              </Button>
              <Button
                variant={filterType === 'trip' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setFilterType('trip'); setSelectedTransport('all'); }}
                className="flex-1"
              >
                Trips
              </Button>
              <Button
                variant={filterType === 'transportation' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('transportation')}
                className="flex-1"
              >
                Transportation
              </Button>
            </div>
          </div>

          {filterType === 'transportation' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Transportation</label>
              <Select value={selectedTransport} onValueChange={setSelectedTransport}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select transportation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Transportation</SelectItem>
                  {Array.from(transportNames).map(typeId => {
                    const type = transportTypes.find(t => t.id === typeId);
                    const name = language === 'ar' ? type?.nameAr : type?.nameEn;
                    return (
                      <SelectItem key={typeId} value={typeId}>
                        {name || typeId}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-3">
        {filteredReviews.length === 0 && <p className="text-muted-foreground text-sm">No reviews match the selected filters.</p>}
        {filteredReviews.map((review) => {
          const transportType = transportTypes.find(t => t.id === review.transportTypeId);
          const transportLabel = language === 'ar' ? transportType?.nameAr : transportType?.nameEn;

          return (
            <Card key={review.id}>
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
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

                  {/* Transportation details for transportation reviews */}
                  {review.reviewType === 'transportation' && (
                    <div className="flex items-center gap-2 text-sm">
                      <Badge className="text-xs" variant="secondary">
                        {transportLabel || review.transportTypeId}
                      </Badge>
                      {review.transportNumber && (
                        <Badge variant="outline" className="text-xs">
                          #{review.transportNumber}
                        </Badge>
                      )}
                    </div>
                  )}

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
          );
        })}
      </div>
    </div>
  );
};

export default AdminReviews;
