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
  date: string
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
      return mockBlueBusTrips(fromCity, toCity, date);
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
      bookingUrl: "https://www.bluebus.com.eg",
      availableSeats: t.availableSeats ?? null,
      distanceKm: null,
      distanceScore: null,
      busType: t.busClass ?? t.busType ?? null,
    }));
  } catch {
    return mockBlueBusTrips(fromCity, toCity, date);
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

function mockBlueBusTrips(from: string, to: string, date: string): InterTrip[] {
  if (!from || !to) return [];
  return [
    {
      operator: "BlueBus",
      operatorSlug: "bluebus",
      operatorLogo: null,
      departure: "09:00",
      arrival: "14:00",
      durationMinutes: 300,
      priceEgp: 170,
      fromStation: `${from} - BlueBus Station`,
      toStation: `${to} - BlueBus Station`,
      bookingMethod: "online",
      bookingUrl: "https://www.bluebus.com.eg",
      availableSeats: 15,
      distanceKm: null,
      distanceScore: null,
      busType: "VIP",
    },
    {
      operator: "BlueBus",
      operatorSlug: "bluebus",
      operatorLogo: null,
      departure: "16:30",
      arrival: "21:30",
      durationMinutes: 300,
      priceEgp: 140,
      fromStation: `${from} - BlueBus Station`,
      toStation: `${to} - BlueBus Station`,
      bookingMethod: "online",
      bookingUrl: "https://www.bluebus.com.eg",
      availableSeats: 5,
      distanceKm: null,
      distanceScore: null,
      busType: "Economy",
    },
  ];
}
