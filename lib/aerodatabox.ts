import { addDays, format, subDays } from "date-fns";
import { aeroConfig, hasAeroDataBox } from "./server-env";
import { prisma } from "./db";
import { takeToken } from "./rate-limit";
import { mapProviderStatus } from "./flight-status";
import { persistAeroQuota } from "./api-quota";

export type AeroLiveTelemetry = {
  icao24?: string;
  callsign?: string;
  aircraftType?: string;
  registration?: string;
  gate?: string;
  terminal?: string;
  arrivalGate?: string;
  arrivalTerminal?: string;
  scheduledArr?: string;
  estimatedDep?: string;
  estimatedArr?: string;
  actualDep?: string;
  actualArr?: string;
  delayMinutes?: number;
  lat?: number;
  lon?: number;
  altitudeFt?: number;
  velocityKts?: number;
  heading?: number;
};

export type AeroFlight = {
  flightNumber: string;
  airlineName?: string;
  airlineIata?: string;
  airlineIcao?: string;
  fromIata?: string;
  toIata?: string;
  fromName?: string;
  toName?: string;
  scheduledDep?: string;
  scheduledArr?: string;
  estimatedDep?: string;
  estimatedArr?: string;
  actualDep?: string;
  actualArr?: string;
  status: ReturnType<typeof mapProviderStatus>;
  statusRaw?: string;
  gate?: string;
  terminal?: string;
  arrivalGate?: string;
  arrivalTerminal?: string;
  aircraftType?: string;
  registration?: string;
  delayMinutes?: number;
  icao24?: string;
  callsign?: string;
} & Pick<AeroLiveTelemetry, "lat" | "lon" | "altitudeFt" | "velocityKts" | "heading">;

type AeroClock = string | { utc?: string; local?: string };

type AeroLeg = {
  airport?: { iata?: string; name?: string; municipalityName?: string };
  scheduledTime?: AeroClock;
  scheduledTimeLocal?: string;
  scheduledTimeUtc?: string;
  revisedTime?: AeroClock;
  revisedTimeLocal?: string;
  revisedTimeUtc?: string;
  predictedTime?: AeroClock;
  actualTime?: AeroClock;
  actualTimeUtc?: string;
  runwayTime?: AeroClock;
  terminal?: string;
  gate?: string;
  delay?: { minutes?: number };
};

type AeroMeasure = {
  meter?: number;
  foot?: number;
  kt?: number;
  kmh?: number;
  kts?: number;
};

type AeroLocation = {
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  altFt?: number;
  altitudeFt?: number;
  altMeter?: number;
  altitude?: number;
  trueTrack?: number;
  heading?: number;
  groundSpeedKts?: number;
  groundSpeedKmh?: number;
  pressureAltitude?: AeroMeasure;
  groundSpeed?: AeroMeasure;
  gs?: AeroMeasure;
};

type AeroRaw = {
  number?: string;
  status?: string;
  callSign?: string;
  callsign?: string;
  airline?: { name?: string; iata?: string; icao?: string };
  departure?: AeroLeg;
  arrival?: AeroLeg;
  aircraft?: {
    model?: string;
    reg?: string;
    modeS?: string;
    icao24?: string;
  };
  location?: AeroLocation;
  position?: AeroLocation;
};

/** AeroDataBox sends `2026-08-26 10:20Z` or `{ utc, local }` instead of ISO strings. */
function aeroTime(...candidates: (AeroClock | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = typeof candidate === "string" ? candidate : candidate.utc ?? candidate.local;
    if (!raw?.trim()) continue;
    return normalizeAeroTime(raw.trim());
  }
  return undefined;
}

function normalizeAeroTime(raw: string): string {
  const spaceClock = raw.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (spaceClock) {
    const seconds = spaceClock[3] ?? "00";
    return `${spaceClock[1]}T${spaceClock[2]}:${seconds}${spaceClock[4]}`;
  }
  return raw;
}

function asFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstFinite(...values: unknown[]) {
  for (const value of values) {
    const n = asFinite(value);
    if (n != null) return n;
  }
  return undefined;
}

function mapAeroLocation(loc?: AeroLocation | null): Pick<
  AeroLiveTelemetry,
  "lat" | "lon" | "altitudeFt" | "velocityKts" | "heading"
> {
  if (!loc) return {};
  const lat = firstFinite(loc.lat, loc.latitude);
  const lon = firstFinite(loc.lon, loc.longitude);
  const altFt = firstFinite(
    loc.pressureAltitude?.foot,
    loc.altFt,
    loc.altitudeFt,
    loc.altMeter != null ? loc.altMeter * 3.28084 : undefined,
    loc.altitude != null ? loc.altitude * 3.28084 : undefined,
  );
  const speedKts = firstFinite(
    loc.groundSpeed?.kt,
    loc.groundSpeed?.kts,
    loc.gs?.kt,
    loc.gs?.kts,
    loc.groundSpeedKts,
    loc.groundSpeedKmh != null ? loc.groundSpeedKmh / 1.852 : undefined,
    loc.groundSpeed?.kmh != null ? loc.groundSpeed.kmh / 1.852 : undefined,
  );
  const heading = firstFinite(loc.trueTrack, loc.heading);
  return {
    lat,
    lon,
    altitudeFt: altFt,
    velocityKts: speedKts,
    heading,
  };
}

function mapAeroIdentity(raw: AeroRaw) {
  const modeS = (raw.aircraft?.modeS ?? raw.aircraft?.icao24 ?? "").trim().toLowerCase();
  const callsign = (raw.callSign ?? raw.callsign ?? "").trim() || undefined;
  const registration = raw.aircraft?.reg?.trim() || undefined;
  return {
    icao24: modeS || undefined,
    callsign,
    aircraftType: raw.aircraft?.model,
    registration,
  };
}

function scheduledOnly(leg?: AeroLeg) {
  return aeroTime(leg?.scheduledTimeUtc, leg?.scheduledTime, leg?.scheduledTimeLocal);
}

function mapAero(raw: AeroRaw): AeroFlight {
  const identity = mapAeroIdentity(raw);
  const live = mapAeroLocation(raw.location ?? raw.position);
  const estimatedDep = aeroTime(
    raw.departure?.revisedTimeUtc,
    raw.departure?.revisedTime,
    raw.departure?.predictedTime,
    raw.departure?.revisedTimeLocal,
  );
  const estimatedArr = aeroTime(
    raw.arrival?.revisedTimeUtc,
    raw.arrival?.revisedTime,
    raw.arrival?.predictedTime,
    raw.arrival?.revisedTimeLocal,
  );
  const actualDep = aeroTime(
    raw.departure?.actualTimeUtc,
    raw.departure?.actualTime,
    raw.departure?.runwayTime,
  );
  const actualArr = aeroTime(raw.arrival?.actualTimeUtc, raw.arrival?.actualTime, raw.arrival?.runwayTime);
  return {
    flightNumber: (raw.number ?? "").replace(/\s+/g, ""),
    airlineName: raw.airline?.name,
    airlineIata: raw.airline?.iata,
    airlineIcao: raw.airline?.icao,
    fromIata: raw.departure?.airport?.iata,
    toIata: raw.arrival?.airport?.iata,
    fromName: raw.departure?.airport?.municipalityName ?? raw.departure?.airport?.name,
    toName: raw.arrival?.airport?.municipalityName ?? raw.arrival?.airport?.name,
    scheduledDep: scheduledOnly(raw.departure),
    scheduledArr: scheduledOnly(raw.arrival),
    estimatedDep,
    estimatedArr,
    actualDep,
    actualArr,
    status: mapProviderStatus(raw.status),
    statusRaw: raw.status,
    gate: raw.departure?.gate,
    terminal: raw.departure?.terminal,
    arrivalGate: raw.arrival?.gate,
    arrivalTerminal: raw.arrival?.terminal,
    aircraftType: identity.aircraftType,
    registration: identity.registration,
    delayMinutes: raw.departure?.delay?.minutes,
    icao24: identity.icao24,
    callsign: identity.callsign,
    ...live,
  };
}

export type AeroSearchReason =
  | "ok"
  | "unconfigured"
  | "rate_limited"
  | "monthly_quota"
  | "not_subscribed"
  | "http_error"
  | "network_error"
  | "empty";

/** Map API.Market / RapidAPI HTTP failures to search reasons. */
export function classifyAeroFailure(status: number, body: string): Exclude<AeroSearchReason, "ok"> {
  const msg = body.toLowerCase();
  const invalidKey =
    msg.includes("invalid_api_key") ||
    msg.includes("invalid api key") ||
    msg.includes("no valid api key") ||
    msg.includes("invalid x-api-market-key") ||
    msg.includes("invalid x-magicapi-key") ||
    (msg.includes("invalid") && msg.includes("key")) ||
    msg.includes("unauthorized") ||
    (msg.includes("missing") && msg.includes("key"));
  const notSubscribed =
    msg.includes("not subscribed") ||
    msg.includes("subscription_not_found") ||
    msg.includes("subscription not found") ||
    msg.includes("not subscribed to this api") ||
    msg.includes("no subscription") ||
    (msg.includes("subscription") && (msg.includes("inactive") || msg.includes("required"))) ||
    msg.includes("exceed the maximum");

  if (status === 429) {
    if (
      msg.includes("monthly") ||
      msg.includes("quota") ||
      msg.includes("api units") ||
      msg.includes("api-units") ||
      msg.includes("plan limit")
    ) {
      return "monthly_quota";
    }
    return "rate_limited";
  }
  if (status === 400 && invalidKey) return "not_subscribed";
  if (status === 401 || invalidKey) return "not_subscribed";
  if (status === 403 && (notSubscribed || invalidKey || msg.includes("forbidden"))) {
    return "not_subscribed";
  }
  if (status === 404 && notSubscribed) return "not_subscribed";
  return "http_error";
}

export type AeroSearchOutcome = {
  flights: AeroFlight[];
  reason: AeroSearchReason;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFlightNumber(flightNumber: string) {
  return flightNumber.toUpperCase().replace(/[\s-]+/g, "");
}

function rowsFromAeroBody(text: string): AeroRaw[] {
  if (!text.trim()) return [];
  const json: unknown = JSON.parse(text);
  if (Array.isArray(json)) return json as AeroRaw[];
  if (json && typeof json === "object") {
    const obj = json as { items?: unknown; number?: unknown; departure?: unknown };
    if (Array.isArray(obj.items)) return obj.items as AeroRaw[];
    if (obj.number != null || obj.departure != null) return [json as AeroRaw];
  }
  return [];
}

async function logAero(data: {
  endpoint: string;
  statusCode?: number;
  ok: boolean;
  latencyMs: number;
  error?: string | null;
}) {
  try {
    await prisma.apiLog.create({
      data: {
        provider: "aerodatabox",
        endpoint: data.endpoint,
        statusCode: data.statusCode,
        ok: data.ok,
        latencyMs: data.latencyMs,
        error: data.error ?? null,
      },
    });
  } catch {
    // Logging must never discard a successful schedule lookup.
  }
}

async function acquireAeroSlot(priority: "user" | "poll"): Promise<boolean> {
  try {
    const gate = await takeToken({
      key: "ratelimit:aerodatabox:global",
      minIntervalMs: 1_200,
    });
    if (gate.allowed) return true;
    if (priority === "user" && gate.retryAfterMs <= 2_500) {
      await sleep(gate.retryAfterMs + 50);
      return true;
    }
    return false;
  } catch {
    // Redis down must not skip a user-facing status lookup.
    return true;
  }
}

function aeroRequestHeaders(key: string, marketplace: "apimarket" | "rapidapi", host: string) {
  if (marketplace === "rapidapi") {
    return {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": host,
      Accept: "application/json",
    };
  }
  // Official API.Market OpenAPI: x-api-market-key. Legacy MagicAPI alias is still accepted.
  return {
    "x-api-market-key": key,
    "x-magicapi-key": key,
    Accept: "application/json",
  };
}

async function fetchAero(path: string) {
  const { aeroKey, aeroBaseUrl, aeroHost, marketplace } = aeroConfig();
  const started = Date.now();
  const res = await fetch(`${aeroBaseUrl}${path}`, {
    headers: aeroRequestHeaders(aeroKey!, marketplace, aeroHost),
    cache: "no-store",
  });
  void persistAeroQuota(res.headers);
  const text = await res.text();
  return { res, text, latencyMs: Date.now() - started };
}

export async function lookupAeroDataBox(
  flightNumber: string,
  date: Date,
  opts?: { priority?: "user" | "poll" },
): Promise<AeroSearchOutcome> {
  if (!hasAeroDataBox()) return { flights: [], reason: "unconfigured" };

  const priority = opts?.priority ?? "poll";
  if (!(await acquireAeroSlot(priority))) return { flights: [], reason: "rate_limited" };

  const number = normalizeFlightNumber(flightNumber);
  // User search: ±1 local day so overnight long-haul (MIA 25 Aug → ZRH 26 Aug)
  // is found whether the picker is departure day or "today" in Europe.
  const fromDay = format(priority === "user" ? subDays(date, 1) : date, "yyyy-MM-dd");
  const toDay = format(priority === "user" ? addDays(date, 1) : date, "yyyy-MM-dd");
  const endpoint =
    fromDay === toDay
      ? `/flights/number/${encodeURIComponent(number)}/${fromDay}?dateLocalRole=Both`
      : `/flights/number/${encodeURIComponent(number)}/${fromDay}/${toDay}?dateLocalRole=Both`;

  try {
    let used = endpoint;
    let { res, text, latencyMs } = await fetchAero(used);
    if (res.status === 429 && priority === "user") {
      await sleep(1_250);
      ({ res, text, latencyMs } = await fetchAero(used));
    }
    // Some BASIC plans reject the history-range path; fall back to the selected day.
    if ((res.status === 403 || res.status === 404) && fromDay !== toDay) {
      used = `/flights/number/${encodeURIComponent(number)}/${format(date, "yyyy-MM-dd")}?dateLocalRole=Both`;
      await sleep(1_200);
      ({ res, text, latencyMs } = await fetchAero(used));
    }

    await logAero({
      endpoint: used,
      statusCode: res.status,
      ok: res.ok,
      latencyMs,
      error: res.ok ? null : text.slice(0, 500),
    });

    if (res.status === 429) return { flights: [], reason: classifyAeroFailure(res.status, text) };
    if (res.status === 204) return { flights: [], reason: "empty" };
    if (res.status === 404) {
      const classified = classifyAeroFailure(res.status, text);
      return { flights: [], reason: classified === "http_error" ? "empty" : classified };
    }
    if (!res.ok) return { flights: [], reason: classifyAeroFailure(res.status, text) };

    const flights = rowsFromAeroBody(text).map(mapAero);
    return { flights, reason: flights.length ? "ok" : "empty" };
  } catch (error) {
    await logAero({
      endpoint,
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : "fetch failed",
    });
    return { flights: [], reason: "network_error" };
  }
}

export async function searchAeroDataBox(flightNumber: string, date: Date) {
  const { flights } = await lookupAeroDataBox(flightNumber, date);
  return flights;
}

function normalizeRegistration(reg: string) {
  return reg.toUpperCase().replace(/[\s]+/g, "").replace(/[–—]/g, "-");
}

function safeHttpUrl(raw?: string) {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // ignore malformed provider URLs
  }
  return undefined;
}

export type AeroAircraftImage = {
  url: string;
  webUrl?: string;
  author?: string;
  license?: string;
};

function parseAeroImage(raw: unknown): AeroAircraftImage | null {
  if (typeof raw === "string") {
    const url = safeHttpUrl(raw);
    return url ? { url } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    url?: unknown;
    webUrl?: unknown;
    author?: unknown;
    license?: unknown;
  };
  const url = typeof obj.url === "string" ? safeHttpUrl(obj.url) : undefined;
  if (!url) return null;
  const author = typeof obj.author === "string" ? obj.author.trim() : "";
  const license = typeof obj.license === "string" ? obj.license.trim() : "";
  return {
    url,
    webUrl: typeof obj.webUrl === "string" ? safeHttpUrl(obj.webUrl) : undefined,
    author: author || undefined,
    license: license || undefined,
  };
}

/**
 * TIER 1 aircraft record with `withImage=true` — commercially licensed
 * `aircraft.image` (url, author, webUrl). Not added to flight polling.
 */
export async function lookupAeroAircraftImage(
  registration: string,
): Promise<AeroAircraftImage | null> {
  if (!hasAeroDataBox()) return null;
  const reg = normalizeRegistration(registration);
  if (!reg) return null;
  if (!(await acquireAeroSlot("user"))) return null;

  const endpoint = `/aircrafts/reg/${encodeURIComponent(reg)}?withImage=true`;
  try {
    const { res, text, latencyMs } = await fetchAero(endpoint);
    await logAero({
      endpoint,
      statusCode: res.status,
      ok: res.ok,
      latencyMs,
      error: res.ok ? null : text.slice(0, 500),
    });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) return null;
    const json: unknown = JSON.parse(text);
    if (!json || typeof json !== "object") return null;
    return parseAeroImage((json as { image?: unknown }).image);
  } catch (error) {
    await logAero({
      endpoint,
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : "fetch failed",
    });
    return null;
  }
}

function normalizeIcao24(hex: string) {
  return hex.trim().toLowerCase().replace(/^0x/, "");
}

function eachLocalDay(fromDay: string, toDay: string): string[] {
  const start = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${toDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [fromDay];
  }
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function mergeAeroFlights(batches: AeroFlight[][]) {
  const seen = new Set<string>();
  const out: AeroFlight[] = [];
  for (const batch of batches) {
    for (const flight of batch) {
      const key = [
        normalizeFlightNumber(flight.flightNumber),
        flight.scheduledDep ?? "",
        flight.fromIata ?? "",
        flight.toIata ?? "",
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(flight);
    }
  }
  return out;
}

async function fetchAeroSearchPath(
  path: string,
  priority: "user" | "poll",
): Promise<{ res: Response; text: string; latencyMs: number; used: string } | { reason: AeroSearchReason }> {
  if (!(await acquireAeroSlot(priority))) return { reason: "rate_limited" };
  const used = path;
  let { res, text, latencyMs } = await fetchAero(used);
  if (res.status === 429 && priority === "user") {
    await sleep(1_250);
    ({ res, text, latencyMs } = await fetchAero(used));
  }
  return { res, text, latencyMs, used };
}

/**
 * Tail history: `/flights/reg/{reg}/{date}` (TIER 2) or `/{from}/{to}` (TIER 3).
 * BASIC plans often 403 the range — fall back to single days. Use icao24 only when
 * no registration is stored.
 */
export async function lookupAeroByAircraft(opts: {
  registration?: string | null;
  icao24?: string | null;
  fromDay: string;
  toDay: string;
  priority?: "user" | "poll";
}): Promise<AeroSearchOutcome> {
  if (!hasAeroDataBox()) return { flights: [], reason: "unconfigured" };

  const priority = opts.priority ?? "poll";
  const searchBy = opts.registration?.trim()
    ? ("reg" as const)
    : opts.icao24?.trim()
      ? ("icao24" as const)
      : null;
  if (!searchBy) return { flights: [], reason: "empty" };

  const param =
    searchBy === "reg"
      ? normalizeRegistration(opts.registration!)
      : normalizeIcao24(opts.icao24!);
  if (!param) return { flights: [], reason: "empty" };

  const fromDay = opts.fromDay;
  const toDay = opts.toDay;
  const days = eachLocalDay(fromDay, toDay);

  const rangePath =
    fromDay === toDay
      ? `/flights/${searchBy}/${encodeURIComponent(param)}/${fromDay}?dateLocalRole=Both`
      : `/flights/${searchBy}/${encodeURIComponent(param)}/${fromDay}/${toDay}?dateLocalRole=Both`;

  try {
    if (fromDay !== toDay) {
      const range = await fetchAeroSearchPath(rangePath, priority);
      if ("reason" in range) return { flights: [], reason: range.reason };

      await logAero({
        endpoint: range.used,
        statusCode: range.res.status,
        ok: range.res.ok,
        latencyMs: range.latencyMs,
        error: range.res.ok ? null : range.text.slice(0, 500),
      });

      if (range.res.status === 429) {
        return { flights: [], reason: classifyAeroFailure(range.res.status, range.text) };
      }
      if (range.res.status === 204) return { flights: [], reason: "empty" };
      if (range.res.status === 404) {
        const classified = classifyAeroFailure(range.res.status, range.text);
        if (classified === "not_subscribed") return { flights: [], reason: classified };
      }
      if (range.res.ok) {
        const flights = rowsFromAeroBody(range.text).map(mapAero);
        return { flights, reason: flights.length ? "ok" : "empty" };
      }
      // BASIC / TIER 2: range is often 403. Fall back to each local day.
      if (range.res.status !== 403 && range.res.status !== 404) {
        return { flights: [], reason: classifyAeroFailure(range.res.status, range.text) };
      }
    }

    const batches: AeroFlight[][] = [];
    let lastReason: AeroSearchReason = "empty";
    for (let i = 0; i < days.length; i++) {
      if (i > 0 || fromDay !== toDay) await sleep(1_200);
      const dayPath = `/flights/${searchBy}/${encodeURIComponent(param)}/${days[i]}?dateLocalRole=Both`;
      const day = await fetchAeroSearchPath(dayPath, priority);
      if ("reason" in day) {
        lastReason = day.reason;
        if (batches.some((b) => b.length)) break;
        return { flights: [], reason: day.reason };
      }

      await logAero({
        endpoint: day.used,
        statusCode: day.res.status,
        ok: day.res.ok,
        latencyMs: day.latencyMs,
        error: day.res.ok ? null : day.text.slice(0, 500),
      });

      if (day.res.status === 429) {
        lastReason = classifyAeroFailure(day.res.status, day.text);
        if (batches.some((b) => b.length)) break;
        return { flights: [], reason: lastReason };
      }
      if (day.res.status === 204 || day.res.status === 404) {
        if (day.res.status === 404) {
          const classified = classifyAeroFailure(day.res.status, day.text);
          if (classified === "not_subscribed") {
            lastReason = classified;
            if (batches.some((b) => b.length)) break;
            return { flights: [], reason: classified };
          }
        }
        lastReason = "empty";
        continue;
      }
      if (!day.res.ok) {
        lastReason = classifyAeroFailure(day.res.status, day.text);
        if (batches.some((b) => b.length)) break;
        return { flights: [], reason: lastReason };
      }
      const flights = rowsFromAeroBody(day.text).map(mapAero);
      if (flights.length) batches.push(flights);
    }

    const flights = mergeAeroFlights(batches);
    return { flights, reason: flights.length ? "ok" : lastReason };
  } catch (error) {
    await logAero({
      endpoint: rangePath,
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : "fetch failed",
    });
    return { flights: [], reason: "network_error" };
  }
}

/** Pick the Aero row for this scheduled departure — not yesterday's same flight number. */
export function pickAeroForScheduledDep(
  flights: AeroFlight[],
  scheduledDep: Date,
  opts?: { fromIata?: string | null; toIata?: string | null },
): AeroFlight | undefined {
  const byRoute = flights.filter((f) => {
    if (opts?.fromIata && f.fromIata && f.fromIata !== opts.fromIata) return false;
    if (opts?.toIata && f.toIata && f.toIata !== opts.toIata) return false;
    return true;
  });
  const pool = byRoute.length ? byRoute : flights;
  let best: AeroFlight | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const flight of pool) {
    if (!flight.scheduledDep) continue;
    const delta = Math.abs(new Date(flight.scheduledDep).getTime() - scheduledDep.getTime());
    if (delta < bestDelta) {
      best = flight;
      bestDelta = delta;
    }
  }
  if (best && bestDelta <= 12 * 60 * 60 * 1000) return best;
  return undefined;
}

function pickLiveAeroFlight(
  flights: AeroFlight[],
  opts?: { fromIata?: string | null; toIata?: string | null },
) {
  const liveStatuses = new Set(["EN_ROUTE", "DEPARTED", "BOARDING"]);
  const sameRoute = flights.filter((f) => {
    if (opts?.fromIata && f.fromIata && f.fromIata !== opts.fromIata) return false;
    if (opts?.toIata && f.toIata && f.toIata !== opts.toIata) return false;
    return true;
  });
  const pool = sameRoute.length ? sameRoute : flights;
  return (
    pool.find((f) => f.lat != null && f.lon != null) ??
    pool.find((f) => liveStatuses.has(f.status)) ??
    pool[0] ??
    null
  );
}

/** Airborne-only lookup: same flight-status endpoint with `withLocation=true`. */
export async function lookupAeroLiveTelemetry(
  flightNumber: string,
  date: Date,
  opts?: { fromIata?: string | null; toIata?: string | null },
): Promise<AeroLiveTelemetry | null> {
  if (!hasAeroDataBox()) return null;
  if (!(await acquireAeroSlot("poll"))) return null;

  const number = normalizeFlightNumber(flightNumber);
  const day = date.toISOString().slice(0, 10);
  const endpoint = `/flights/number/${encodeURIComponent(number)}/${day}?dateLocalRole=Both&withLocation=true`;

  try {
    const { res, text, latencyMs } = await fetchAero(endpoint);
    await logAero({
      endpoint,
      statusCode: res.status,
      ok: res.ok,
      latencyMs,
      error: res.ok ? null : text.slice(0, 500),
    });
    if (!res.ok) return null;
    const match = pickLiveAeroFlight(rowsFromAeroBody(text).map(mapAero), opts);
    if (!match) return null;
    return {
      icao24: match.icao24,
      callsign: match.callsign,
      aircraftType: match.aircraftType,
      registration: match.registration,
      gate: match.gate,
      terminal: match.terminal,
      arrivalGate: match.arrivalGate,
      arrivalTerminal: match.arrivalTerminal,
      scheduledArr: match.scheduledArr,
      estimatedDep: match.estimatedDep,
      estimatedArr: match.estimatedArr,
      actualDep: match.actualDep,
      actualArr: match.actualArr,
      delayMinutes: match.delayMinutes,
      lat: match.lat,
      lon: match.lon,
      altitudeFt: match.altitudeFt,
      velocityKts: match.velocityKts,
      heading: match.heading,
    };
  } catch (error) {
    await logAero({
      endpoint,
      ok: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : "fetch failed",
    });
    return null;
  }
}
