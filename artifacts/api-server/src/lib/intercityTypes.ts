export interface InterTrip {
  operator: string;
  operatorSlug: string;
  operatorLogo: string | null;
  departure: string;
  arrival: string;
  durationMinutes: number;
  priceEgp: number;
  fromStation: string;
  toStation: string;
  bookingMethod: "online" | "office" | "hotline" | "onboard";
  bookingUrl: string | null;
  availableSeats: number | null;
  distanceKm: number | null;
  distanceScore: number | null;
  busType: string | null;
}

export interface InterCityRecord {
  id: string;
  nameEn: string;
  nameAr: string;
  normalizedName: string;
  governorate: string;
  lat?: number | null;
  lng?: number | null;
}

export const EGYPT_CITIES: InterCityRecord[] = [
  { id: "cairo", nameEn: "Cairo", nameAr: "القاهرة", normalizedName: "cairo", governorate: "Cairo", lat: 30.0444, lng: 31.2357 },
  { id: "alexandria", nameEn: "Alexandria", nameAr: "الإسكندرية", normalizedName: "alexandria", governorate: "Alexandria", lat: 31.2001, lng: 29.9187 },
  { id: "giza", nameEn: "Giza", nameAr: "الجيزة", normalizedName: "giza", governorate: "Giza", lat: 30.0131, lng: 31.2089 },
  { id: "hurghada", nameEn: "Hurghada", nameAr: "الغردقة", normalizedName: "hurghada", governorate: "Red Sea", lat: 27.2578, lng: 33.8116 },
  { id: "sharm", nameEn: "Sharm El-Sheikh", nameAr: "شرم الشيخ", normalizedName: "sharm el sheikh", governorate: "South Sinai", lat: 27.9158, lng: 34.3300 },
  { id: "luxor", nameEn: "Luxor", nameAr: "الأقصر", normalizedName: "luxor", governorate: "Luxor", lat: 25.6872, lng: 32.6396 },
  { id: "aswan", nameEn: "Aswan", nameAr: "أسوان", normalizedName: "aswan", governorate: "Aswan", lat: 24.0889, lng: 32.8998 },
  { id: "portSaid", nameEn: "Port Said", nameAr: "بورسعيد", normalizedName: "port said", governorate: "Port Said", lat: 31.2653, lng: 32.3019 },
  { id: "ismailia", nameEn: "Ismailia", nameAr: "الإسماعيلية", normalizedName: "ismailia", governorate: "Ismailia", lat: 30.5965, lng: 32.2715 },
  { id: "suez", nameEn: "Suez", nameAr: "السويس", normalizedName: "suez", governorate: "Suez", lat: 29.9737, lng: 32.5265 },
  { id: "mansoura", nameEn: "Mansoura", nameAr: "المنصورة", normalizedName: "mansoura", governorate: "Dakahlia", lat: 31.0364, lng: 31.3807 },
  { id: "tanta", nameEn: "Tanta", nameAr: "طنطا", normalizedName: "tanta", governorate: "Gharbia", lat: 30.7865, lng: 31.0004 },
  { id: "zagazig", nameEn: "Zagazig", nameAr: "الزقازيق", normalizedName: "zagazig", governorate: "Sharkia", lat: 30.5877, lng: 31.5021 },
  { id: "matrouh", nameEn: "Marsa Matrouh", nameAr: "مرسى مطروح", normalizedName: "marsa matrouh", governorate: "Matrouh", lat: 31.3543, lng: 27.2373 },
  { id: "sohag", nameEn: "Sohag", nameAr: "سوهاج", normalizedName: "sohag", governorate: "Sohag", lat: 26.5591, lng: 31.6967 },
  { id: "minya", nameEn: "Minya", nameAr: "المنيا", normalizedName: "minya", governorate: "Minya", lat: 28.1099, lng: 30.7503 },
  { id: "beniSuef", nameEn: "Beni Suef", nameAr: "بني سويف", normalizedName: "beni suef", governorate: "Beni Suef", lat: 29.0661, lng: 31.0994 },
  { id: "asyut", nameEn: "Asyut", nameAr: "أسيوط", normalizedName: "asyut", governorate: "Asyut", lat: 27.1809, lng: 31.1837 },
  { id: "qena", nameEn: "Qena", nameAr: "قنا", normalizedName: "qena", governorate: "Qena", lat: 26.1551, lng: 32.7160 },
  { id: "fayoum", nameEn: "Fayoum", nameAr: "الفيوم", normalizedName: "fayoum", governorate: "Fayoum", lat: 29.3084, lng: 30.8428 },
  { id: "damanhour", nameEn: "Damanhour", nameAr: "دمنهور", normalizedName: "damanhour", governorate: "Beheira", lat: 31.0341, lng: 30.4714 },
  { id: "damietta", nameEn: "Damietta", nameAr: "دمياط", normalizedName: "damietta", governorate: "Damietta", lat: 31.4165, lng: 31.8133 },
  { id: "kafr", nameEn: "Kafr El-Sheikh", nameAr: "كفر الشيخ", normalizedName: "kafr el sheikh", governorate: "Kafr El-Sheikh", lat: 31.1107, lng: 30.9388 },
  { id: "shibin", nameEn: "Shibin El-Kom", nameAr: "شبين الكوم", normalizedName: "shibin el kom", governorate: "Menofia", lat: 30.5588, lng: 30.9971 },
  { id: "newCairo", nameEn: "New Cairo", nameAr: "القاهرة الجديدة", normalizedName: "new cairo", governorate: "Cairo", lat: 30.0300, lng: 31.4700 },
  { id: "6october", nameEn: "6th of October", nameAr: "السادس من أكتوبر", normalizedName: "6th of october", governorate: "Giza", lat: 29.9602, lng: 30.9261 },
  { id: "namaaBay", nameEn: "Naama Bay", nameAr: "نعمة باي", normalizedName: "naama bay", governorate: "South Sinai", lat: 27.9283, lng: 34.3358 },
  { id: "dahab", nameEn: "Dahab", nameAr: "دهب", normalizedName: "dahab", governorate: "South Sinai", lat: 28.4934, lng: 34.5121 },
  { id: "nuweiba", nameEn: "Nuweiba", nameAr: "نويبع", normalizedName: "nuweiba", governorate: "South Sinai", lat: 29.0544, lng: 34.6602 },
  { id: "taba", nameEn: "Taba", nameAr: "طابا", normalizedName: "taba", governorate: "South Sinai", lat: 29.5003, lng: 34.9035 },
];

export interface GovernorateOption {
  /** The governorate's English name, used as the stable id/key. */
  governorate: string;
  nameEn: string;
  nameAr: string;
  /** The city used to represent this governorate in operator searches —
   *  intercity bus/train data is keyed by city/terminal, not governorate, so
   *  picking a governorate has to resolve to one concrete place under the
   *  hood. Defaults to the first city listed for that governorate. */
  hubCity: InterCityRecord;
  /** Every city in this governorate, in case a hub needs to be swapped later. */
  cities: InterCityRecord[];
}

/**
 * Groups EGYPT_CITIES by governorate for governorate-to-governorate pickers.
 * Egypt has 27 governorates; this covers the ones intercity travel data
 * exists for. There's no separate "governorate name" field on InterCityRecord,
 * so the hub city's own bilingual name doubles as the governorate's label —
 * a reasonable stand-in since Egyptians commonly call a governorate by its
 * capital city's name anyway (e.g. "Aswan" the city and "Aswan" the governorate).
 */
export function getGovernorates(): GovernorateOption[] {
  const byGovernorate = new Map<string, InterCityRecord[]>();
  for (const city of EGYPT_CITIES) {
    const list = byGovernorate.get(city.governorate) ?? [];
    list.push(city);
    byGovernorate.set(city.governorate, list);
  }
  return Array.from(byGovernorate.entries())
    .map(([governorate, cities]) => ({
      governorate,
      nameEn: cities[0].nameEn,
      nameAr: cities[0].nameAr,
      hubCity: cities[0],
      cities,
    }))
    .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}
