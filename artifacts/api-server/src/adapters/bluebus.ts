import axios from "axios";
import type { InterTrip } from "../lib/intercityTypes.js";

const GQL_URL = "https://api.bluebus.com.eg/graphql";
const TIMEOUT = 10000;

const SEARCH_QUERY = `
  query SearchTrips($from: String!, $to: String!, $date: String!) {
    trips(from: $from, to: $to, date: $date) {
      id
      departureTime
      arrivalTime
      duration
      price
      currency
      fromStation { name address }
      toStation { name address }
      availableSeats
      busClass
      busType
    }
  }
`;

export async function searchBlueBus(
  fromCity: string,
  toCity: string,
  date: string,
  bookingUrl: string
): Promise<InterTrip[]> {
  try {
    const res = await axios.post(
      GQL_URL,
      {
        query: SEARCH_QUERY,
        variables: { from: fromCity, to: toCity, date },
      },
      {
        timeout: TIMEOUT,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; EgyptTransit/1.0)",
        },
      }
    );

    const trips = res.data?.data?.trips ?? [];
    if (!Array.isArray(trips) || trips.length === 0) {
      // No trips for this route/date -- report that honestly instead of
      // inventing schedule/price data that would look real to a rider.
      return [];
    }

    return trips.map((t: any) => ({
      operator: "BlueBus",
      operatorSlug: "bluebus",
      operatorLogo: null,
      departure: t.departureTime ?? "",
      arrival: t.arrivalTime ?? "",
      durationMinutes: t.duration ?? estimateDuration(t.departureTime, t.arrivalTime),
      priceEgp: parseFloat(String(t.price ?? 0)) || 0,
      fromStation: t.fromStation?.name ?? fromCity,
      toStation: t.toStation?.name ?? toCity,
      bookingMethod: "online" as const,
      bookingUrl,
      availableSeats: t.availableSeats ?? null,
      distanceKm: null,
      distanceScore: null,
      busType: t.busClass ?? t.busType ?? null,
    }));
  } catch (err) {
    console.warn("[bluebus] search failed", (err as Error)?.message ?? err);
    return [];
  }
}

function estimateDuration(dep?: string, arr?: string): number {
  if (!dep || !arr) return 200;
  try {
    const [dh, dm] = dep.split(":").map(Number);
    const [ah, am] = arr.split(":").map(Number);
    const diff = ah * 60 + am - (dh * 60 + dm);
    return diff > 0 ? diff : diff + 1440;
  } catch {
    return 200;
  }
}
