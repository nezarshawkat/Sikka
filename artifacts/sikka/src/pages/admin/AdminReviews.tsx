import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';;
import { getLocalRouteCatalog } from '@/lib/localRouteStore';
import { Star, Trash2, Check, X, Filter, MapPin, User } from 'lucide-react';

const FACES = ['😞', '😐', '🙂', '😊', '🤩'];

interface TransportType {
  id: string;
  nameEn: string;
  nameAr: string;
  color: string;
}

interface TransitLine {
  id: string;
  nameEn: string;
  nameAr: string;
  lineNumber: string | null;
  fromArea: string;
  toArea: string;
  transportTypeId: string;
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
  transitLineId: string | null;
  transportName?: string;
  transportNumber?: string;
  /** User display name, from the profile */
  userName?: string | null;
  userPhone?: string | null;
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
  const [transitLines, setTransitLines] = useState<TransitLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'trip' | 'segment'>('all');
  const [selectedTransport, setSelectedTransport] = useState<string>('all');

  useEffect(() => {
    Promise.all([
      api.get<Review[]>('/reviews'),
      getLocalRouteCatalog<TransitLine, TransportType>(),
    ])
      .then(([data, catalog]) => {
        setReviews(data ?? []);
        setTransportTypes(catalog.transportTypes);
        setTransitLines(catalog.routes);
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
    if (filterType !== 'all' && review.reviewType !== filterType) return false;
    if (selectedTransport !== 'all' && review.transportTypeId !== selectedTransport) return false;
    return true;
  });

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  const typeById = new Map(transportTypes.map(t => [t.id, t]));
  const lineById = new Map(transitLines.map(l => [l.id, l]));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3 p-4 rounded-[1.5rem] border bg-card/50">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Filters</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Review Type filter */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Review Type</label>
            <div className="flex gap-2">
              {(['all', 'trip', 'segment'] as const).map((type) => (
                <Button
                  key={type}
                  variant={filterType === type ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setFilterType(type); if (type !== 'segment') setSelectedTransport('all'); }}
                  className="flex-1 capitalize"
                >
                  {type === 'all' ? 'All' : type === 'trip' ? 'Trips' : 'Transport'}
                </Button>
              ))}
            </div>
          </div>

          {/* Transportation type filter — always show ALL transport types */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Transportation Type</label>
            <Select value={selectedTransport} onValueChange={setSelectedTransport}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Transportation</SelectItem>
                {transportTypes.map(type => {
                  const name = language === 'ar' ? type.nameAr : type.nameEn;
                  const reviewCount = reviews.filter(r => r.transportTypeId === type.id).length;
                  return (
                    <SelectItem key={type.id} value={type.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: type.color || '#6b7280' }}
                        />
                        {name}
                        {reviewCount > 0 && (
                          <span className="text-xs text-muted-foreground">({reviewCount})</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-3">
        {filteredReviews.length === 0 && (
          <p className="text-muted-foreground text-sm">No reviews match the selected filters.</p>
        )}
        {filteredReviews.map((review) => {
          const transportType = typeById.get(review.transportTypeId ?? '');
          const transitLine = lineById.get(review.transitLineId ?? '');
          const transportLabel = language === 'ar' ? transportType?.nameAr : transportType?.nameEn;
          const displayName = review.userName || review.userPhone || 'Anonymous';

          return (
            <Card key={review.id}>
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  {/* User name */}
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground">{displayName}</span>
                  </div>

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

                  {/* Transportation type details */}
                  {transportType && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: transportType.color || '#6b7280' }}
                      />
                      <Badge
                        className="text-xs"
                        variant="secondary"
                        style={{ borderColor: transportType.color }}
                      >
                        {transportLabel || review.transportTypeId}
                      </Badge>
                      {review.transportNumber && (
                        <Badge variant="outline" className="text-xs">
                          #{review.transportNumber}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Route info (transit line) */}
                  {transitLine && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-lg px-2 py-1.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="font-medium">
                        {transitLine.lineNumber ? `${transitLine.lineNumber} · ` : ''}
                        {language === 'ar' ? transitLine.nameAr : transitLine.nameEn}
                      </span>
                      <span className="text-muted-foreground/70">
                        {transitLine.fromArea} → {transitLine.toArea}
                      </span>
                    </div>
                  )}

                  {review.comment && (
                    <p className="text-sm text-foreground">{review.comment}</p>
                  )}

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
