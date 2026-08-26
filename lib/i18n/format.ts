import { formatDistanceToNow } from "date-fns";
import { de, enUS } from "date-fns/locale";
import type { Locale, Units } from "./messages";
import { t, type MessageKey } from "./messages";
import { FlightStatus } from "@prisma/client";
import { interpolateAirbornePosition } from "@/lib/flight-interpolate";
import { intervalForFlight, isLiveStatus, type PollScheduleInput } from "@/lib/flight-status";

const FT_TO_M = 0.3048;
const KT_TO_KMH = 1.852;
const KT_TO_MPH = 1.15078;
const MI_TO_KM = 1.60934;

export function numberLocale(locale: Locale) {
  return locale === "de" ? "de-DE" : "en-US";
}

export function formatNumber(value: number, locale: Locale, digits = 0) {
  return new Intl.NumberFormat(numberLocale(locale), {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function asDate(date?: Date | string | null) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidTimeZone(timeZone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** IANA zone if valid; otherwise UTC. Never invents a named airport zone. */
export function resolveTimeZone(timeZone?: string | null) {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  return "UTC";
}

function intlLocale(units: Units) {
  return units === "imperial" ? "en-US" : "de-DE";
}

function formatClockInZone(date: Date, units: Units, timeZone: string) {
  return new Intl.DateTimeFormat(intlLocale(units), {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: units === "imperial",
  }).format(date);
}

function formatInZone(
  date: Date,
  units: Units,
  timeZone: string,
  mode: "clock" | "datetime" | "day",
): string {
  const locale = intlLocale(units);
  if (mode === "clock") return formatClockInZone(date, units, timeZone);
  if (mode === "day") {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      ...(units === "imperial"
        ? { month: "short", day: "numeric" }
        : { day: "2-digit", month: "2-digit", year: "numeric" }),
    }).format(date);
  }
  const datePart = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `${datePart} ${formatClockInZone(date, units, timeZone)}`;
}

/**
 * Clock in an airport IANA zone. Missing/invalid zone → UTC (not the viewer TZ).
 */
export function formatClock(
  date?: Date | string | null,
  units: Units = "metric",
  timeZone?: string | null,
) {
  const d = asDate(date);
  if (!d) return "—";
  return formatInZone(d, units, resolveTimeZone(timeZone), "clock");
}

export function formatDateTime(
  date?: Date | string | null,
  units: Units = "metric",
  timeZone?: string | null,
) {
  const d = asDate(date);
  if (!d) return "—";
  return formatInZone(d, units, resolveTimeZone(timeZone), "datetime");
}

export function formatDay(
  date?: Date | string | null,
  units: Units = "metric",
  timeZone?: string | null,
) {
  const d = asDate(date);
  if (!d) return "";
  return formatInZone(d, units, resolveTimeZone(timeZone), "day");
}

/** Same instant in the runtime/viewer timezone (browser local on the client). */
export function formatViewerClock(date?: Date | string | null, units: Units = "metric") {
  const d = asDate(date);
  if (!d) return "—";
  return new Intl.DateTimeFormat(intlLocale(units), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: units === "imperial",
  }).format(d);
}

export function formatTimeZoneName(
  date?: Date | string | null,
  timeZone?: string | null,
  locale: Locale = "de",
) {
  const d = asDate(date);
  const resolved = resolveTimeZone(timeZone);
  if (!d) return timeZone && isValidTimeZone(timeZone) ? null : "UTC";
  try {
    const parts = new Intl.DateTimeFormat(numberLocale(locale), {
      timeZone: resolved,
      timeZoneName: "short",
    }).formatToParts(d);
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? (resolved === "UTC" ? "UTC" : null)
    );
  } catch {
    return resolved === "UTC" ? "UTC" : null;
  }
}

export function formatRelative(date: Date | string, locale: Locale) {
  return formatDistanceToNow(asDate(date) ?? new Date(), {
    addSuffix: true,
    locale: locale === "de" ? de : enUS,
  });
}

export function formatDuration(minutes: number | null | undefined, locale: Locale) {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const abs = Math.max(0, Math.round(minutes));
  const days = Math.floor(abs / (24 * 60));
  const hours = Math.floor((abs % (24 * 60)) / 60);
  const mins = abs % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(t(locale, days === 1 ? "duration.day" : "duration.days", { d: days }));
  }
  if (hours > 0) {
    parts.push(t(locale, "duration.hours", { h: hours }));
  }
  if (mins > 0 || parts.length === 0) {
    parts.push(t(locale, "duration.minutes", { m: mins }));
  }
  return parts.join(" ");
}

export function formatAltitude(ft: number | null | undefined, locale: Locale, units: Units) {
  if (ft == null) return "—";
  if (units === "imperial") return `${formatNumber(ft, locale)} ${t(locale, "units.ft")}`;
  return `${formatNumber(ft * FT_TO_M, locale)} ${t(locale, "units.mAmsl")}`;
}

export function formatSpeed(kts: number | null | undefined, locale: Locale, units: Units) {
  if (kts == null) return "—";
  if (units === "imperial") return `${formatNumber(kts * KT_TO_MPH, locale)} mph`;
  return `${formatNumber(kts * KT_TO_KMH, locale)} ${t(locale, "units.kmh")}`;
}

/** Aviation knots — independent of the user units pref (imperial pref is mph). */
export function formatSpeedKt(kts: number | null | undefined, locale: Locale) {
  if (kts == null) return "—";
  return `${formatNumber(kts, locale)} ${t(locale, "units.kt")}`;
}

/** Always ft primary + metric AMSL, regardless of the user units pref. */
export function formatAltitudePair(ft: number | null | undefined, locale: Locale) {
  return {
    primary: formatAltitude(ft, locale, "imperial"),
    secondary: formatAltitude(ft, locale, "metric"),
  };
}

/** Always kt primary + km/h, regardless of the user units pref. */
export function formatSpeedPair(kts: number | null | undefined, locale: Locale) {
  return {
    primary: formatSpeedKt(kts, locale),
    secondary: formatSpeed(kts, locale, "metric"),
  };
}

export function formatDistanceMiles(miles: number | null | undefined, locale: Locale, units: Units) {
  if (miles == null) return "—";
  if (units === "imperial") return `${formatNumber(miles, locale)} mi`;
  return `${formatNumber(miles * MI_TO_KM, locale)} km`;
}

export function formatHeading(deg: number | null | undefined, locale: Locale) {
  if (deg == null) return "—";
  return locale === "de" ? `${formatNumber(deg, locale)}°` : `${formatNumber(deg, locale)}°`;
}

export function formatStand(
  locale: Locale,
  gate?: string | null,
  terminal?: string | null,
) {
  const parts: string[] = [];
  if (gate) parts.push(`${t(locale, "flight.gate")} ${gate}`);
  if (terminal) parts.push(`${t(locale, "flight.terminal")} ${terminal}`);
  return parts.length ? parts.join(" · ") : null;
}

export function metricLabel(locale: Locale, key: MessageKey, estimated?: boolean) {
  const label = t(locale, key);
  return estimated ? `${label} · ${t(locale, "flight.estimate")}` : label;
}

export function formatPollInterval(ms: number, locale: Locale): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec >= 3600 && sec % 3600 === 0) {
    return locale === "de" ? `${sec / 3600} Std.` : `${sec / 3600}h`;
  }
  if (sec >= 120 && sec % 60 === 0) {
    return `${sec / 60} min`;
  }
  return locale === "de" ? `${sec} s` : `${sec}s`;
}

export function adsbCaption(
  flight: {
    lastPositionAt?: Date | string | null;
    lastAltitudeFt?: number | null;
    lastVelocityKts?: number | null;
    lastHeading?: number | null;
    lastLat?: number | null;
    lastLon?: number | null;
    status: FlightStatus;
    scheduledDep?: Date | string | null;
    actualDep?: Date | string | null;
    estimatedDep?: Date | string | null;
    scheduledArr?: Date | string | null;
    estimatedArr?: Date | string | null;
    actualArr?: Date | string | null;
    departureAirport?: { lat?: number | null; lon?: number | null } | null;
    arrivalAirport?: { lat?: number | null; lon?: number | null } | null;
  },
  locale: Locale,
) {
  const intervalMs =
    flight.scheduledDep != null
      ? intervalForFlight({
          status: flight.status,
          scheduledDep: flight.scheduledDep,
          actualDep: flight.actualDep,
          estimatedDep: flight.estimatedDep,
          scheduledArr: flight.scheduledArr,
          estimatedArr: flight.estimatedArr,
          lastLat: flight.lastLat,
          lastLon: flight.lastLon,
          lastPositionAt: flight.lastPositionAt,
          actualArr: flight.actualArr,
          departureAirport: latLonOf(flight.departureAirport),
          arrivalAirport: latLonOf(flight.arrivalAirport),
        } satisfies PollScheduleInput)
      : null;
  const interval = intervalMs != null ? formatPollInterval(intervalMs, locale) : null;
  const hasFix =
    flight.lastLat != null ||
    flight.lastAltitudeFt != null ||
    flight.lastVelocityKts != null ||
    flight.lastHeading != null;
  const interpolated = interpolateAirbornePosition({
    origin: latLonOf(flight.departureAirport),
    dest: latLonOf(flight.arrivalAirport),
    lastFix:
      flight.lastLat != null && flight.lastLon != null
        ? { lat: flight.lastLat, lon: flight.lastLon }
        : null,
    lastFixAt: flight.lastPositionAt,
    scheduledDep: flight.scheduledDep,
    estimatedDep: flight.estimatedDep,
    actualDep: flight.actualDep,
    scheduledArr: flight.scheduledArr,
    estimatedArr: flight.estimatedArr,
    actualArr: flight.actualArr,
    status: flight.status,
  }).estimated;
  if (interpolated) {
    if (hasFix && flight.lastPositionAt) {
      return t(locale, "flight.adsbEstimatedLast", { time: formatRelative(flight.lastPositionAt, locale) });
    }
    return t(locale, "flight.adsbEstimated");
  }
  if (hasFix && flight.lastPositionAt) {
    const ageMs = Date.now() - (asDate(flight.lastPositionAt)?.getTime() ?? 0);
    if (ageMs <= 3 * 60 * 1000 && interval) return t(locale, "flight.adsbLive", { interval });
    return t(locale, "flight.adsbLastSeen", { time: formatRelative(flight.lastPositionAt, locale) });
  }
  if (
    flight.status === FlightStatus.EN_ROUTE ||
    flight.status === FlightStatus.DEPARTED ||
    flight.status === FlightStatus.BOARDING
  ) {
    return t(locale, "flight.adsbNone");
  }
  if (interval && isLiveStatus(flight.status)) return t(locale, "flight.adsb", { interval });
  if (interval) return t(locale, "flight.pollStatus", { interval });
  return t(locale, "flight.adsbNone");
}

function latLonOf(airport?: { lat?: number | null; lon?: number | null } | null) {
  if (airport?.lat == null || airport.lon == null) return null;
  return { lat: airport.lat, lon: airport.lon };
}

export function statusKey(status: FlightStatus): MessageKey {
  switch (status) {
    case FlightStatus.EN_ROUTE:
      return "status.enRoute";
    case FlightStatus.SCHEDULED:
      return "status.scheduled";
    case FlightStatus.DELAYED:
      return "status.delayed";
    case FlightStatus.BOARDING:
      return "status.boarding";
    case FlightStatus.DEPARTED:
      return "status.departed";
    case FlightStatus.LANDED:
      return "status.landed";
    case FlightStatus.CANCELLED:
      return "status.cancelled";
    case FlightStatus.DIVERTED:
      return "status.diverted";
    default:
      return "status.unknown";
  }
}

export function statusText(status: FlightStatus, locale: Locale, delayMinutes?: number | null) {
  if (status === FlightStatus.DELAYED && delayMinutes) {
    return t(locale, "status.delayedBy", { n: delayMinutes });
  }
  if (status === FlightStatus.SCHEDULED) return t(locale, "status.onTime");
  return t(locale, statusKey(status));
}

export function greeting(locale: Locale, now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return t(locale, "greeting.morning");
  if (hour < 18) return t(locale, "greeting.afternoon");
  return t(locale, "greeting.evening");
}

function isValidYmd(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

/** Display a `yyyy-MM-dd` value as dd.mm.yyyy (metric) or mm/dd/yyyy (imperial). */
export function formatIsoDateInput(isoDate: string, units: Units) {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  return units === "imperial" ? `${mo}/${d}/${y}` : `${d}.${mo}.${y}`;
}

/** Parse a typed date back to `yyyy-MM-dd`, or null if incomplete/invalid. */
export function parseIsoDateInput(raw: string, units: Units): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidYmd(year, month, day) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const parts = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (!parts) return null;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = Number(parts[3]);
  const month = units === "imperial" ? first : second;
  const day = units === "imperial" ? second : first;
  if (!isValidYmd(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
