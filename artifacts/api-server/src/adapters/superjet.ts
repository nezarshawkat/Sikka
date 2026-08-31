import axios from "axios";
import * as cheerio from "cheerio";
import type { InterTrip } from "../lib/intercityTypes.js";

const BASE = "https://www.superjet.com.eg";
const TIMEOUT = 12000;

export interface SuperJetCity {
  id: string;
  name: string;
}

export async function getSuperJetCities(): Promise<SuperJetCity[]> {
  try {
    const res = await axios.get(`${BASE}/booking/start`, {
      timeout: TIMEOUT,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EgyptTransit/1.0)" },
    });
    const $ = cheerio.load(res.data);
    const cities: SuperJetCity[] = [];
    $("#FromCity option, select[name='FromCity'] option").each((_i, el) => {
      const val = $(el).attr("value");
      const name = $(el).text().trim();
      if (val && name && val !== "0") {
        cities.push({ id: val, name });
      }
    });
    return cities;
  } catch (err) {
    // We genuinely don't know SuperJet's real internal city IDs without
    // reaching its live dropdown -- returning a guessed/invented list here
    // would just cause `searchSuperJet` below to post the wrong form values
    // and silently fail. An empty list correctly tells the caller "no
    // SuperJet city data available right now" instead of pretending to.
    console.warn("[superjet] failed to load city list", (err as Error)?.message ?? err);
    return [];
  }
}

export async function searchSuperJet(
  fromId: string,
  toId: string,
  date: string,
  bookingUrl: string
): Promise<InterTrip[]> {
  try {
    const formData = new URLSearchParams({
      FromCity: fromId,
      ToCity: toId,
      DateFrom: date,
      Adults: "1",
      ReturnTrip: "false",
    });
    const res = await axios.post(`${BASE}/booking/getTrips`, formData, {
      timeout: TIMEOUT,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EgyptTransit/1.0)",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    const $ = cheerio.load(res.data);
    const trips: InterTrip[] = [];

    $(".trip-row, .trip-item, [class*='trip']").each((_i, el) => {
      const departure = $(el).find("[class*='depart'], [class*='time']").first().text().trim();
      const arrival = $(el).find("[class*='arriv']").first().text().trim();
      const priceText = $(el).find("[class*='price'], [class*='fare']").first().text().trim();
      const price = parseFloat(priceText.replace(/[^\d.]/g, "")) || 0;
      const fromStation = $(el).find("[class*='from-station'], [class*='origin']").first().text().trim();
      const toStation = $(el).find("[class*='to-station'], [class*='dest']").first().text().trim();
      const busType = $(el).find("[class*='bus-type'], [class*='class']").first().text().trim();

      if (departure && price > 0) {
        trips.push({
          operator: "SuperJet",
          operatorSlug: "superjet",
          operatorLogo: null,
          departure: departure || "00:00",
          arrival: arrival || "",
          durationMinutes: estimateDuration(departure, arrival),
          priceEgp: price,
          fromStation: fromStation || "Main Terminal",
          toStation: toStation || "Main Terminal",
          bookingMethod: "online",
          bookingUrl,
          availableSeats: null,
          distanceKm: null,
          distanceScore: null,
          busType: busType || null,
        });
      }
    });

    // No trips parsed for this route/date -- report that honestly instead
    // of inventing schedule/price data that would look real to a rider.
    return trips;
  } catch (err) {
    console.warn("[superjet] search failed", (err as Error)?.message ?? err);
    return [];
  }
}

function estimateDuration(dep: string, arr: string): number {
  try {
    const [dh, dm] = dep.split(":").map(Number);
    const [ah, am] = arr.split(":").map(Number);
    const diff = (ah * 60 + am) - (dh * 60 + dm);
    return diff > 0 ? diff : diff + 1440;
  } catch {
    return 180;
  }
}
