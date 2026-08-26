import { SEED_AIRPORTS } from "./master-data";
import { isValidTimeZone } from "./i18n/format";

const SEED_TZ = new Map<string, string>();
for (const airport of SEED_AIRPORTS) {
  if (airport.timezone) SEED_TZ.set(airport.iata, airport.timezone);
}

/** Stored IANA first, then bundled seed. Returns null when unknown — never invents a zone. */
export function airportTimeZone(iata?: string | null, stored?: string | null) {
  if (stored && isValidTimeZone(stored)) return stored;
  if (iata) {
    const seed = SEED_TZ.get(iata);
    if (seed && isValidTimeZone(seed)) return seed;
  }
  return null;
}

/**
 * Origin calendar day in the airport IANA zone — never invents a named zone.
 * Unknown/invalid zone → UTC (same rule used for display clocks).
 */
export function originCalendarDay(date: Date, timeZone?: string | null) {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Shift a `yyyy-MM-dd` calendar day (date-only, not an instant). */
export function shiftCalendarDay(ymd: string, days: number) {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}
