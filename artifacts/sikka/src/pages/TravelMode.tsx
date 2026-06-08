import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Plane, Ship, TrainFront, Car, CheckCircle2, MapPinned } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { t } from '@/lib/i18n';

type Mode = 'flight' | 'train' | 'taxi' | 'nile';

interface ServiceOption {
  titleEn: string;
  titleAr: string;
  detailEn: string;
  detailAr: string;
}

interface ModeData {
  icon: typeof Plane;
  titleEn: string;
  titleAr: string;
  summaryEn: string;
  summaryAr: string;
  stepsEn: string[];
  stepsAr: string[];
  services: ServiceOption[];
  bookingEn: string;
  bookingAr: string;
  bookingUrl?: string;
}

const TRAIN_SERVICES: ServiceOption[] = [
  {
    titleEn: 'Cairo - Alexandria',
    titleAr: 'القاهرة - الإسكندرية',
    detailEn: 'Frequent ENR intercity corridor with express, VIP, and regional trains.',
    detailAr: 'محور متكرر من سكك حديد مصر مع قطارات إكسبريس و VIP وإقليمية.',
  },
  {
    titleEn: 'Cairo - Upper Egypt - Aswan',
    titleAr: 'القاهرة - الصعيد - أسوان',
    detailEn: 'Main Nile Valley line through Beni Suef, Minya, Asyut, Sohag, Qena, Luxor, and Aswan.',
    detailAr: 'خط وادي النيل الرئيسي عبر بني سويف والمنيا وأسيوط وسوهاج وقنا والأقصر وأسوان.',
  },
  {
    titleEn: 'Delta and Canal cities',
    titleAr: 'الدلتا ومدن القناة',
    detailEn: 'Connections toward Tanta, Mansoura, Zagazig, Ismailia, Suez, Port Said, and Damietta.',
    detailAr: 'اتصالات نحو طنطا والمنصورة والزقازيق والإسماعيلية والسويس وبورسعيد ودمياط.',
  },
  {
    titleEn: 'Fayoum and Matrouh branches',
    titleAr: 'فروع الفيوم ومطروح',
    detailEn: 'Lower-frequency branch services; confirm times before leaving.',
    detailAr: 'خدمات فرعية بتكرار أقل؛ تأكد من المواعيد قبل التحرك.',
  },
];

const FLIGHT_SERVICES: ServiceOption[] = [
  {
    titleEn: 'Cairo domestic hub',
    titleAr: 'محور القاهرة الداخلي',
    detailEn: 'Best supported for Luxor, Aswan, Hurghada, Sharm El-Sheikh, Alexandria, and major resort routes.',
    detailAr: 'الأكثر دعما للأقصر وأسوان والغردقة وشرم الشيخ والإسكندرية ومسارات المدن السياحية.',
  },
  {
    titleEn: 'Long-distance recommendation',
    titleAr: 'ترشيح للمسافات الطويلة',
    detailEn: 'Most useful when ground travel is several hours and both cities have practical airport access.',
    detailAr: 'مفيد أكثر عندما تكون الرحلة البرية طويلة ويوجد وصول عملي للمطار في المدينتين.',
  },
  {
    titleEn: 'First and last mile',
    titleAr: 'الوصول من وإلى المطار',
    detailEn: 'Use Sikka for the local ride to the airport and from the arrival airport.',
    detailAr: 'استخدم سكة للوصول المحلي إلى المطار ومن مطار الوصول.',
  },
];

const TAXI_SERVICES: ServiceOption[] = [
  {
    titleEn: 'Taxi app door-to-door',
    titleAr: 'تطبيق تاكسي من الباب للباب',
    detailEn: 'Good for nearby governorates, airport transfers, late-night trips, and when public transport is not practical.',
    detailAr: 'مناسب للمحافظات القريبة، انتقالات المطار، الرحلات المتأخرة، أو عند صعوبة المواصلات العامة.',
  },
  {
    titleEn: 'Fare safety',
    titleAr: 'أمان السعر',
    detailEn: 'Confirm the fare estimate, pickup point, and driver details before starting.',
    detailAr: 'أكد تقدير السعر ونقطة الالتقاء وبيانات السائق قبل بدء الرحلة.',
  },
  {
    titleEn: 'Combine with public transport',
    titleAr: 'ادمجه مع المواصلات العامة',
    detailEn: 'Use it for the short hard parts, then switch to bus, train, or metro when available.',
    detailAr: 'استخدمه للأجزاء القصيرة الصعبة ثم انتقل للأتوبيس أو القطار أو المترو عند توفرها.',
  },
];

const NILE_SERVICES: ServiceOption[] = [
  {
    titleEn: 'Cairo river corridors',
    titleAr: 'مسارات نهرية في القاهرة',
    detailEn: 'Limited river-bus and private Nile bus routes; check the route and operating day before going.',
    detailAr: 'مسارات محدودة للأتوبيس النهري ونيل باص؛ تحقق من المسار ويوم التشغيل قبل الذهاب.',
  },
  {
    titleEn: 'Luxor and Aswan river travel',
    titleAr: 'النقل النهري في الأقصر وأسوان',
    detailEn: 'Common for ferries, local crossings, and tourism boats; booking depends on the operator.',
    detailAr: 'شائع في المعديات والعبور المحلي والمراكب السياحية؛ الحجز حسب المشغل.',
  },
  {
    titleEn: 'Use only near water stops',
    titleAr: 'استخدمه قرب المحطات النهرية',
    detailEn: 'Recommended only when both ends are close to supported Nile stops.',
    detailAr: 'ينصح به فقط عندما تكون البداية والنهاية قريبتين من محطات نيلية مدعومة.',
  },
];

const DOMESTIC_AIRPORTS: Record<string, {
  code: string;
  airport: string;
  city: string;
  notes: string;
}> = {
  cairo: { code: 'CAI', airport: 'Cairo International Airport', city: 'Cairo', notes: 'Main domestic hub for EgyptAir and seasonal operators.' },
  giza: { code: 'CAI/SPX', airport: 'Cairo International or Sphinx International', city: 'Greater Cairo', notes: 'Use Cairo International for most domestic schedules; Sphinx can be useful for west Cairo/Giza when flights are available.' },
  newcairo: { code: 'CAI', airport: 'Cairo International Airport', city: 'New Cairo', notes: 'Closest practical domestic airport is Cairo International.' },
  '6october': { code: 'SPX/CAI', airport: 'Sphinx International or Cairo International', city: '6th of October', notes: 'Check Sphinx availability first, then Cairo International.' },
  '6thofoctober': { code: 'SPX/CAI', airport: 'Sphinx International or Cairo International', city: '6th of October', notes: 'Check Sphinx availability first, then Cairo International.' },
  alexandria: { code: 'HBE', airport: 'Borg El Arab Airport', city: 'Alexandria', notes: 'Domestic availability changes by season; Cairo connection may be required.' },
  luxor: { code: 'LXR', airport: 'Luxor International Airport', city: 'Luxor', notes: 'Regularly supported from Cairo and tourism routes.' },
  aswan: { code: 'ASW', airport: 'Aswan International Airport', city: 'Aswan', notes: 'Regularly supported from Cairo; Abu Simbel is usually a separate tourism leg.' },
  hurghada: { code: 'HRG', airport: 'Hurghada International Airport', city: 'Hurghada', notes: 'Strong domestic and tourism coverage.' },
  sharm: { code: 'SSH', airport: 'Sharm El-Sheikh International Airport', city: 'Sharm El-Sheikh', notes: 'Strong domestic and tourism coverage.' },
  sohag: { code: 'HMB', airport: 'Sohag International Airport', city: 'Sohag', notes: 'Check live schedule; service can vary.' },
  asyut: { code: 'ATZ', airport: 'Assiut Airport', city: 'Asyut', notes: 'Check live schedule; service can vary.' },
  matrouh: { code: 'MUH', airport: 'Marsa Matrouh Airport', city: 'Marsa Matrouh', notes: 'Mostly seasonal; confirm before recommending.' },
};

const normalizeAirportKey = (value: string) => normalizeCity(value).replace(/\s+/g, '');

function airportFor(value: string) {
  const compact = normalizeAirportKey(value);
  const spaced = normalizeCity(value);
  return DOMESTIC_AIRPORTS[compact] ??
    Object.entries(DOMESTIC_AIRPORTS).find(([key, airport]) => compact.includes(key) || spaced.includes(normalizeCity(airport.city)))?.[1] ??
    null;
}

const DATA: Record<Mode, ModeData> = {
  flight: {
    icon: Plane,
    titleEn: 'Domestic Flights',
    titleAr: 'الطيران الداخلي',
    summaryEn: 'Fastest for supported long trips inside Egypt. Availability changes by season and airline schedule, so confirm live inventory before booking.',
    summaryAr: 'الأسرع للرحلات الطويلة المدعومة داخل مصر. التوفر يتغير حسب الموسم وجدول شركة الطيران، لذلك أكد المقاعد الحية قبل الحجز.',
    stepsEn: ['Compare total airport time with bus or train.', 'Check fare, baggage, and airport transfer cost.', 'Book with the airline, then plan first/last-mile travel in Sikka.'],
    stepsAr: ['قارن وقت المطار الكامل مع الأتوبيس أو القطار.', 'راجع السعر والحقائب وتكلفة الوصول للمطار.', 'احجز من شركة الطيران ثم خطط الوصول المحلي داخل سكة.'],
    services: FLIGHT_SERVICES,
    bookingEn: 'Open airline booking',
    bookingAr: 'فتح حجز الطيران',
    bookingUrl: 'https://www.egyptair.com/',
  },
  train: {
    icon: TrainFront,
    titleEn: 'Egypt Trains',
    titleAr: 'قطارات مصر',
    summaryEn: 'The national rail option for the active Cairo-Alexandria, Nile Valley, Delta, Canal, Fayoum, and Matrouh corridors.',
    summaryAr: 'خيار السكك الحديدية الوطنية لمحاور القاهرة-الإسكندرية ووادي النيل والدلتا والقناة والفيوم ومطروح.',
    stepsEn: ['Choose the nearest origin and destination stations.', 'Compare express, VIP, sleeper, and regional trains.', 'Book through ENR when online booking is available, or buy at the station.'],
    stepsAr: ['اختر أقرب محطة بداية ووصول.', 'قارن قطارات الإكسبريس و VIP والنوم والإقليمية.', 'احجز عبر سكك حديد مصر عند توفر الحجز الإلكتروني أو من المحطة.'],
    services: TRAIN_SERVICES,
    bookingEn: 'Open ENR booking',
    bookingAr: 'فتح حجز سكك حديد مصر',
    bookingUrl: 'https://obs.enr.gov.eg/',
  },
  taxi: {
    icon: Car,
    titleEn: 'Taxi App',
    titleAr: 'تطبيق تاكسي',
    summaryEn: 'Direct car travel for nearby governorates, airport and station transfers, or routes where public transport is not verified yet.',
    summaryAr: 'تنقل مباشر بالسيارة للمحافظات القريبة أو انتقالات المطارات والمحطات أو المسارات غير الموثقة بعد.',
    stepsEn: ['Open a taxi app with pickup and destination filled in.', 'Confirm the fare estimate and pickup point.', 'Share the ride details and keep Sikka for public-transport legs.'],
    stepsAr: ['افتح تطبيق تاكسي بالبداية والوجهة.', 'أكد تقدير السعر ونقطة الالتقاء.', 'شارك تفاصيل الرحلة واستخدم سكة لأجزاء المواصلات العامة.'],
    services: TAXI_SERVICES,
    bookingEn: 'Open taxi apps',
    bookingAr: 'فتح تطبيقات التاكسي',
  },
  nile: {
    icon: Ship,
    titleEn: 'Nile Transportation',
    titleAr: 'النقل النيلي',
    summaryEn: 'A limited but useful option around supported river stops. Treat it as a local river leg, not a guaranteed countrywide route.',
    summaryAr: 'خيار محدود لكنه مفيد حول المحطات النهرية المدعومة. اعتبره جزءا نهريا محليا وليس مسارا مضمونا لكل مصر.',
    stepsEn: ['Check whether both points are near active Nile stops.', 'Confirm operating hours and route direction.', 'Combine with bus, metro, train, or taxi app transfers.'],
    stepsAr: ['تحقق أن النقطتين قرب محطات نيلية عاملة.', 'أكد مواعيد التشغيل واتجاه المسار.', 'ادمجه مع الأتوبيس أو المترو أو القطار أو تطبيق التاكسي.'],
    services: NILE_SERVICES,
    bookingEn: 'Open Nile Bus routes',
    bookingAr: 'فتح مسارات نيل باص',
    bookingUrl: 'https://nilebus.com/en/routes/',
  },
};

function normalizeCity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export default function TravelMode() {
  const navigate = useNavigate();
  const { mode = 'train' } = useParams();
  const [params] = useSearchParams();
  const { language } = useAuth();
  const isAr = language === 'ar';
  const item = DATA[(mode as Mode) in DATA ? mode as Mode : 'train'];
  const Icon = item.icon;
  const from = params.get('fromLabel') || params.get('from') || '';
  const to = params.get('toLabel') || params.get('to') || '';
  const routeText = from && to ? `${from} -> ${to}` : '';
  const cityPair = `${normalizeCity(from)} ${normalizeCity(to)}`;
  const fromAirport = airportFor(from);
  const toAirport = airportFor(to);
  const flightAvailable = mode === 'flight' && !!fromAirport && !!toAirport && fromAirport.code !== toAirport.code;
  const flightViaCairo = flightAvailable && !fromAirport.code.includes('CAI') && !toAirport.code.includes('CAI');
  const taxiAppUrl = useMemo(() => {
    const pickup = encodeURIComponent(from);
    const dropoff = encodeURIComponent(to);
    return `uber://?action=setPickup&pickup[formatted_address]=${pickup}&dropoff[formatted_address]=${dropoff}`;
  }, [from, to]);
  const bookingUrl = mode === 'taxi' ? taxiAppUrl : item.bookingUrl;
  const recommended =
    mode === 'taxi' ||
    (mode === 'flight' && flightAvailable) ||
    (mode === 'nile' && /cairo|giza|luxor|aswan/.test(cityPair)) ||
    (mode === 'train' && !/hurghada|sharm|dahab|taba|nuweiba/.test(cityPair));

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/90 p-4 backdrop-blur-xl">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{isAr ? item.titleAr : item.titleEn}</h1>
          {routeText && <p className="truncate text-xs text-muted-foreground">{routeText}</p>}
        </div>
      </div>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <Card className="glass-panel rounded-[2rem] border-primary/15">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.5rem] bg-primary/10">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {isAr ? item.summaryAr : item.summaryEn}
                </p>
                <Badge variant={recommended ? 'secondary' : 'outline'} className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {recommended ? (isAr ? 'مناسب لهذا الاتجاه' : 'Recommended for this direction') : (isAr ? 'تحقق من التوفر أولا' : 'Check availability first')}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {mode === 'flight' && (
          <Card className="rounded-[2rem] border-primary/15 bg-card/80">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {flightAvailable ? t('flightRouteAvailable', language) : t('flightRouteUnavailable', language)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {flightAvailable ? t('flightRouteCheck', language) : t('flightDataNote', language)}
                  </p>
                </div>
                <Plane className="h-6 w-6 shrink-0 text-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[1.5rem] border bg-background/60 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">{isAr ? 'مطار المغادرة' : 'Departure airport'}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{fromAirport?.code ?? 'N/A'}</p>
                  <p className="text-xs leading-snug text-muted-foreground">{(fromAirport?.airport ?? from) || 'Unknown city'}</p>
                </div>
                <div className="rounded-[1.5rem] border bg-background/60 p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">{isAr ? 'مطار الوصول' : 'Arrival airport'}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{toAirport?.code ?? 'N/A'}</p>
                  <p className="text-xs leading-snug text-muted-foreground">{(toAirport?.airport ?? to) || 'Unknown city'}</p>
                </div>
              </div>
              {flightViaCairo && (
                <p className="rounded-[1.5rem] bg-primary/10 p-3 text-xs leading-relaxed text-muted-foreground">
                  {isAr
                    ? 'قد تحتاج الرحلة إلى ترانزيت في القاهرة لأن معظم الرحلات الداخلية تدور حول محور القاهرة.'
                    : 'This pair may require a Cairo connection because most Egyptian domestic flying is hubbed through Cairo.'}
                </p>
              )}
              {(fromAirport?.notes || toAirport?.notes) && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {[fromAirport?.notes, toAirport?.notes].filter(Boolean).join(' ')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="rounded-[2rem]">
          <CardContent className="space-y-3 p-5">
            {(isAr ? item.stepsAr : item.stepsEn).map((step, index) => (
              <div key={step} className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                <p className="text-sm leading-snug text-foreground">{step}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {item.services.map((service) => (
            <Card key={service.titleEn} className="rounded-[2rem]">
              <CardContent className="flex gap-3 p-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[1.25rem] bg-primary/10">
                  <MapPinned className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{isAr ? service.titleAr : service.titleEn}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{isAr ? service.detailAr : service.detailEn}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {bookingUrl ? (
          <Button asChild className="h-12 w-full rounded-[2rem] gap-2">
            <a href={bookingUrl} target={mode === 'taxi' ? undefined : '_blank'} rel={mode === 'taxi' ? undefined : 'noopener noreferrer'}>
              {isAr ? item.bookingAr : item.bookingEn}
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        ) : (
          <Button variant="outline" className="h-12 w-full rounded-[2rem]" disabled>
            {isAr ? item.bookingAr : item.bookingEn}
          </Button>
        )}
      </main>
    </div>
  );
}
