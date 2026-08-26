import { prisma } from "./db";
import { takeToken } from "./rate-limit";
import { FR24_ENABLED_SETTING, persistFr24Quota } from "./api-quota";
import { normalizeCallsign } from "./callsign";
import { fr24Config, hasFr24Token } from "./server-env";

const BASE = "https://fr24api.flightradar24.com";
const TIMEOUT_MS = 8_000;
/** Explorer is 10 requests/min — stay just under that globally. */
const EXPLORER_MIN_INTERVAL_MS = 6_500;
const RETRY_WAIT_CAP_MS = 10_000;
const LIVE_SOURCES = new Set(["ADSB", "MLAT", "UAT"]);

export type Fr24Position = {
  icao24: string | null;
  callsign: string | null;
  flight: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  velocityKts: number | null;
  heading: number | null;
  onGround: boolean;
  source: string;
  observedAt: Date;
};

type Fr24Raw = {
  hex?: string;
  callsign?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt?: number;
  gspeed?: number;
  track?: number;
  timestamp?: string;
  source?: string;
  reg?: string;
};

function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeFlightNumber(value: string) {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

function truthyEnabled(value?: string | null) {
  if (value == null || value.trim() === "") return true;
  const v = value.trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

export async function isFr24PreferenceEnabled(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: FR24_ENABLED_SETTING } });
    return truthyEnabled(row?.value);
  } catch {
    return true;
  }
}

export async function setFr24PreferenceEnabled(enabled: boolean) {
  await prisma.appSetting.upsert({
    where: { key: FR24_ENABLED_SETTING },
    create: { key: FR24_ENABLED_SETTING, value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
}

/** Token present, env not forcing off, and settings toggle on. */
export async function isFr24Enabled(): Promise<boolean> {
  const { envEnabled } = fr24Config();
  if (!hasFr24Token() || !envEnabled) return false;
  return isFr24PreferenceEnabled();
}

function authHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Version": "v1",
    Authorization: `Bearer ${token}`,
  };
}

function retryAfterMs(headers: Headers): number {
  const raw = headers.get("retry-after");
  if (raw) {
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(sec * 1000, RETRY_WAIT_CAP_MS);
    }
  }
  return 6_000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePosition(raw: Fr24Raw): Fr24Position | null {
  const lat = asFinite(raw.lat);
  const lon = asFinite(raw.lon);
  if (lat == null || lon == null) return null;
  const source = (raw.source ?? "").toUpperCase();
  if (source && !LIVE_SOURCES.has(source)) return null;
  const alt = asFinite(raw.alt);
  const speed = asFinite(raw.gspeed);
  const observedAt = raw.timestamp ? new Date(raw.timestamp) : new Date();
  return {
    icao24: raw.hex ? raw.hex.trim().toLowerCase() : null,
    callsign: raw.callsign ? normalizeCallsign(raw.callsign) : null,
    flight: raw.flight ? normalizeFlightNumber(raw.flight) : null,
    lat,
    lon,
    altitudeFt: alt,
    velocityKts: speed,
    heading: asFinite(raw.track),
    onGround: alt != null && alt <= 0,
    source: source || "ADSB",
    observedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt,
  };
}

function pickMatch(
  rows: Fr24Raw[],
  opts: { icao24?: string | null; flightNumber?: string | null; requireHex?: boolean },
) {
  const icao = opts.icao24?.trim().toLowerCase();
  const flight = opts.flightNumber ? normalizeFlightNumber(opts.flightNumber) : "";
  const parsed = rows.map(parsePosition).filter((row): row is Fr24Position => Boolean(row));
  if (icao) {
    const byHex = parsed.find((row) => row.icao24 === icao);
    if (byHex) return byHex;
    if (opts.requireHex) return null;
  }
  if (flight) {
    const byFlight = parsed.find((row) => row.flight === flight);
    if (byFlight) return byFlight;
  }
  return parsed[0] ?? null;
}

function buildQuery(opts: {
  icao24?: string | null;
  callsign?: string | null;
  flightNumber?: string | null;
  registration?: string | null;
  lastLat?: number | null;
  lastLon?: number | null;
}): { path: string; kind: string } | null {
  const params = new URLSearchParams();
  params.set("limit", "1");
  params.set("data_sources", "ADSB,MLAT,UAT");

  if (opts.callsign) {
    params.set("callsigns", normalizeCallsign(opts.callsign));
    return { path: `/api/live/flight-positions/light?${params}`, kind: "callsign" };
  }
  if (opts.flightNumber) {
    params.set("flights", normalizeFlightNumber(opts.flightNumber));
    return { path: `/api/live/flight-positions/light?${params}`, kind: "flight" };
  }
  if (opts.registration) {
    params.set("registrations", opts.registration.trim().toUpperCase());
    return { path: `/api/live/flight-positions/light?${params}`, kind: "registration" };
  }
  // Official live-positions has no icao24/hex filter. Last-known box + hex match only.
  if (
    opts.icao24 &&
    opts.lastLat != null &&
    opts.lastLon != null &&
    Number.isFinite(opts.lastLat) &&
    Number.isFinite(opts.lastLon)
  ) {
    const deg = 1.5;
    const n = Math.min(90, opts.lastLat + deg).toFixed(3);
    const s = Math.max(-90, opts.lastLat - deg).toFixed(3);
    const w = (opts.lastLon - deg).toFixed(3);
    const e = (opts.lastLon + deg).toFixed(3);
    params.set("bounds", `${n},${s},${w},${e}`);
    params.set("limit", "5");
    return { path: `/api/live/flight-positions/light?${params}`, kind: "hex-bounds" };
  }
  return null;
}

async function logFr24(data: {
  endpoint: string;
  statusCode?: number;
  ok: boolean;
  latencyMs: number;
  error?: string | null;
}) {
  try {
    await prisma.apiLog.create({
      data: {
        provider: "fr24",
        endpoint: data.endpoint,
        statusCode: data.statusCode,
        ok: data.ok,
        latencyMs: data.latencyMs,
        error: data.error ?? null,
      },
    });
  } catch {
    // Logging must never discard a successful position.
  }
}

async function fr24Get(path: string, retried = false): Promise<{
  status: number;
  rows: Fr24Raw[];
}> {
  const { token } = fr24Config();
  if (!token) return { status: 0, rows: [] };
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: authHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    void persistFr24Quota(res.headers);
    if (res.status === 429 && !retried) {
      const wait = retryAfterMs(res.headers);
      await logFr24({
        endpoint: path,
        statusCode: 429,
        ok: false,
        latencyMs: Date.now() - started,
        error: "rate limited",
      });
      await sleep(wait);
      return fr24Get(path, true);
    }
    const text = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      await logFr24({
        endpoint: path,
        statusCode: res.status,
        ok: false,
        latencyMs,
        error: text.slice(0, 400) || res.statusText,
      });
      return { status: res.status, rows: [] };
    }
    await logFr24({ endpoint: path, statusCode: res.status, ok: true, latencyMs });
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return { status: res.status, rows: [] };
    }
    const rows = json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: Fr24Raw[] }).data ?? [])
      : [];
    return { status: res.status, rows };
  } catch (error) {
    await logFr24({
      endpoint: path,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "fetch failed",
    });
    return { status: 0, rows: [] };
  }
}

/**
 * One live-position light lookup. Caller must already know OpenSky/ADB missed.
 * Gated to Explorer (≤10/min) and a cruise-like per-flight interval.
 */
export async function fetchFr24LivePosition(opts: {
  flightId?: string;
  icao24?: string | null;
  callsign?: string | null;
  flightNumber?: string | null;
  registration?: string | null;
  lastLat?: number | null;
  lastLon?: number | null;
}): Promise<Fr24Position | null> {
  if (!(await isFr24Enabled())) return null;
  const { minIntervalMs } = fr24Config();

  if (opts.flightId) {
    const flightGate = await takeToken({
      key: `ratelimit:fr24:flight:${opts.flightId}`,
      minIntervalMs,
    });
    if (!flightGate.allowed) return null;
  }

  const globalGate = await takeToken({
    key: "ratelimit:fr24",
    minIntervalMs: EXPLORER_MIN_INTERVAL_MS,
  });
  if (!globalGate.allowed) return null;

  const query = buildQuery(opts);
  if (!query) return null;
  const result = await fr24Get(query.path);
  return pickMatch(result.rows, {
    icao24: opts.icao24,
    flightNumber: opts.flightNumber,
    requireHex: query.kind === "hex-bounds",
  });
}
