import { searchSuperJet, getSuperJetCities } from "../adapters/superjet.js";
import { searchGoBus } from "../adapters/gobus.js";
import { searchBlueBus } from "../adapters/bluebus.js";
import { EGYPT_CITIES, getGovernorates, type InterTrip } from "./intercityTypes.js";

// Was `s.toLowerCase().replace(/[^a-z0-9]/g, " ")`, which strips every
// character outside a-z0-9 — for an Arabic query that's *every* character,
// so it always normalized to an empty string and could never match anything.
// This keeps Arabic letters, unifies common alef/ta-marbuta/alef-maqsura
// variants and diacritics (mirroring how Egyptian users actually type),
// lowercases Latin, and collapses whitespace — for both scripts.
function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, "") // strip Arabic diacritics (tashkeel)
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findCity(query: string) {
  const q = normalize(query);
  if (!q) return undefined;
  return EGYPT_CITIES.find(
    (c) =>
      normalize(c.nameEn) === q ||
      normalize(c.nameAr) === q ||
      normalize(c.normalizedName) === q ||
      normalize(c.governorate) === q ||
      normalize(c.nameEn).includes(q) ||
      normalize(c.nameAr).includes(q) ||
      q.includes(normalize(c.nameEn)) ||
      q.includes(normalize(c.nameAr))
  );
}

export async function runIntercitySearch(
  fromQuery: string,
  toQuery: string,
  date: string,
  userLat?: number | null,
  userLng?: number | null
): Promise<{ trips: InterTrip[]; fromCity: string; toCity: string; date: string }> {
  const fromCity = findCity(fromQuery) ?? { nameEn: fromQuery, nameAr: fromQuery, id: fromQuery };
  const toCity = findCity(toQuery) ?? { nameEn: toQuery, nameAr: toQuery, id: toQuery };

  const fromEn = fromCity.nameEn;
  const toEn = toCity.nameEn;

  const [superjetTrips, gobusTrips, bluebusTrips] = await Promise.allSettled([
    searchSuperJet(fromCity.id ?? fromEn, toCity.id ?? toEn, date),
    searchGoBus(fromEn, toEn, date),
    searchBlueBus(fromEn, toEn, date),
  ]);

  const allTrips: InterTrip[] = [
    ...(superjetTrips.status === "fulfilled" ? superjetTrips.value : []),
    ...(gobusTrips.status === "fulfilled" ? gobusTrips.value : []),
    ...(bluebusTrips.status === "fulfilled" ? bluebusTrips.value : []),
  ];

  // Sort by departure time, then price
  allTrips.sort((a, b) => {
    const timeCmp = a.departure.localeCompare(b.departure);
    if (timeCmp !== 0) return timeCmp;
    return a.priceEgp - b.priceEgp;
  });

  return {
    trips: allTrips,
    fromCity: fromEn,
    toCity: toEn,
    date,
  };
}

export { EGYPT_CITIES, getGovernorates, getSuperJetCities };
