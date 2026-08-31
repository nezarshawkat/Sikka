import type { InterCityRecord } from "./intercityTypes.js";

export type BusOperatorSlug = "superjet" | "gobus" | "bluebus";

export interface OperatorCityMapping {
  operator: BusOperatorSlug;
  appCityId: string;
  /** Value/name used by that operator's search API or web form. */
  operatorCity: string;
  /** User-facing station/city label from the operator network. */
  label: string;
}

const OPERATOR_CITY_NAMES: Record<BusOperatorSlug, Record<string, string>> = {
  superjet: {
    cairo: "Cairo", giza: "Giza", alexandria: "Alexandria", hurghada: "Hurghada", sharm: "Sharm El Sheikh",
    luxor: "Luxor", aswan: "Aswan", portSaid: "Port Said", suez: "Suez", sohag: "Sohag", matrouh: "Marsa Matrouh",
  },
  gobus: {
    cairo: "Cairo", giza: "Giza", alexandria: "Alexandria", hurghada: "Hurghada", sharm: "Sharm El Sheikh",
    luxor: "Luxor", aswan: "Aswan", dahab: "Dahab", nuweiba: "Nuweiba", taba: "Taba", matrouh: "Marsa Matrouh",
  },
  bluebus: {
    cairo: "Cairo", giza: "Giza", alexandria: "Alexandria", hurghada: "Hurghada", sharm: "Sharm El Sheikh",
    luxor: "Luxor", dahab: "Dahab", matrouh: "Marsa Matrouh",
  },
};

const OPERATOR_BOOKING_BASE: Record<BusOperatorSlug, string> = {
  superjet: "https://www.superjet.com.eg/booking/start",
  gobus: "https://go-bus.com/en",
  bluebus: "https://bluebus.com.eg/en",
};

export function getOperatorCity(operator: BusOperatorSlug, city: InterCityRecord): OperatorCityMapping | null {
  const operatorCity = OPERATOR_CITY_NAMES[operator][city.id];
  if (!operatorCity) return null;
  return { operator, appCityId: city.id, operatorCity, label: operatorCity };
}

export function buildOperatorBookingUrl(operator: BusOperatorSlug, from: string, to: string, date: string): string {
  const url = new URL(OPERATOR_BOOKING_BASE[operator]);
  // These query keys are harmless if an operator ignores them, and preserve
  // the user's selected corridor for sites/SPAs that can prefill from URLs.
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("date", date);
  return url.toString();
}

export function getOperatorCoverage(city: InterCityRecord) {
  return (Object.keys(OPERATOR_CITY_NAMES) as BusOperatorSlug[])
    .map((operator) => getOperatorCity(operator, city))
    .filter((value): value is OperatorCityMapping => Boolean(value));
}
