import { searchSuperJet, getSuperJetCities } from "../adapters/superjet.js";
import { searchGoBus } from "../adapters/gobus.js";
import { searchBlueBus } from "../adapters/bluebus.js";
import { EGYPT_CITIES, type InterTrip } from "./intercityTypes.js";

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").trim().replace(/\s+/g, " ");
}

function findCity(query: string) {
  const q = normalize(query);
  return EGYPT_CITIES.find(
    (c) =>
      normalize(c.nameEn) === q ||
      normalize(c.normalizedName) === q ||
      normalize(c.nameEn).includes(q) ||
      q.includes(normalize(c.nameEn))
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

export { EGYPT_CITIES, getSuperJetCities };
