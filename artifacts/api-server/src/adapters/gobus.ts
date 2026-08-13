import axios from "axios";
import type { InterTrip } from "../lib/intercityTypes.js";

const BASE = "https://www.go-bus.com";
const TIMEOUT = 10000;

export async function searchGoBus(
  fromCity: string,
  toCity: string,
  date: string
): Promise<InterTrip[]> {
  try {
    const res = await axios.get(`${BASE}/api/getTrips`, {
      params: { from: fromCity, to: toCity, date },
      timeout: TIMEOUT,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EgyptTransit/1.0)",
        Accept: "application/json",
      },
    });

    const data = res.data;
    const rawTrips: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.trips)
        ? data.trips
        : Array.isArray(data?.data)
          ? data.data
          : [];

    return rawTrips
      .map((t: any) => ({
        operator: "GoBus",
        operatorSlug: "gobus",
        operatorLogo: null,
        departure: t.departureTime ?? t.departure_time ?? t.time ?? "",
        arrival: t.arrivalTime ?? t.arrival_time ?? "",
        durationMinutes:
          t.duration ?? t.durationMinutes ?? estimateDuration(t.departureTime, t.arrivalTime) ?? 240,
        priceEgp:
          parseFloat(String(t.price ?? t.fare ?? t.amount ?? 0)) || 0,
        fromStation: t.fromStation ?? t.from_station ?? t.boardingPoint ?? fromCity,
        toStation: t.toStation ?? t.to_station ?? t.droppingPoint ?? toCity,
        bookingMethod: "online" as const,
        bookingUrl: `${BASE}/search?from=${encodeURIComponent(fromCity)}&to=${encodeURIComponent(toCity)}&date=${date}`,
        availableSeats: t.availableSeats ?? t.available_seats ?? null,
        distanceKm: t.distanceKm ?? null,
        distanceScore: null,
        busType: t.busType ?? t.bus_type ?? t.type ?? null,
      }))
      .filter((t) => t.departure && t.priceEgp > 0);
  } catch (err) {
    // Genuinely no data for this route/date -- report zero results rather
    // than inventing schedule/price data that would look real to a rider.
    console.warn("[gobus] search failed", (err as Error)?.message ?? err);
    return [];
  }
}

function estimateDuration(dep?: string, arr?: string): number {
  if (!dep || !arr) return 240;
  try {
    const [dh, dm] = dep.split(":").map(Number);
    const [ah, am] = arr.split(":").map(Number);
    const diff = ah * 60 + am - (dh * 60 + dm);
    return diff > 0 ? diff : diff + 1440;
  } catch {
    return 240;
  }
}
