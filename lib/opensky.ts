import { FlightStatus } from "@prisma/client";
import { hasOpenSkyAuth, openSkyConfig } from "./server-env";
import { prisma } from "./db";
import { takeToken } from "./rate-limit";
import { boundingBox, type LatLon } from "./geo";
import { getStoredOpenSkyRemaining, persistOpenSkyQuota, parseOpenSkyQuotaHeaders } from "./api-quota";
import type { ViewportBounds } from "./viewport-traffic";
import { candidateCallsigns, matchesCallsign, normalizeCallsign } from "./callsign";
import { normalizeSquawk } from "./squawk";

export { candidateCallsigns, matchesCallsign, normalizeCallsign };

const BASE = "https://opensky-network.org/api";
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

export type OpenSkyState = {
  icao24: string;
  callsign: string | null;
  originCountry: string | null;
  lon: number | null;
  lat: number | null;
  baroAltitude: number | null;
  geoAltitude: number | null;
  velocity: number | null;
  trueTrack: number | null;
  onGround: boolean;
  lastContact: number | null;
  squawk: string | null;
};

type CachedToken = { token: string; expiresAt: number };

let cachedToken: CachedToken | null = null;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStates(rows: unknown[]): OpenSkyState[] {
  return rows
    .map((row) => {
      if (!Array.isArray(row)) return null;
      return {
        icao24: String(row[0] ?? "").trim().toLowerCase(),
        callsign: row[1] ? String(row[1]).trim() : null,
        originCountry: row[2] ? String(row[2]) : null,
        lon: asNumber(row[5]),
        lat: asNumber(row[6]),
        baroAltitude: asNumber(row[7]),
        onGround: Boolean(row[8]),
        velocity: asNumber(row[9]),
        trueTrack: asNumber(row[10]),
        lastContact: asNumber(row[4]),
        geoAltitude: asNumber(row[13]),
        squawk: normalizeSquawk(row[14]),
      } satisfies OpenSkyState;
    })
    .filter((s): s is OpenSkyState => Boolean(s?.icao24));
}

async function fetchAccessToken(force = false): Promise<string | null> {
  const { clientId, clientSecret } = openSkyConfig();
  if (!clientId || !clientSecret) return null;
  if (!force && cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    cachedToken = null;
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    cachedToken = null;
    return null;
  }
  const ttlMs = Math.max(60, (data.expires_in ?? 1800) - 60) * 1000;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ttlMs };
  return data.access_token;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await fetchAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export type OpenSkyHttpResult = {
  status: number;
  states: OpenSkyState[];
  remaining: number | null;
  retryAfterSeconds: number | null;
};

async function loggedFetch(endpoint: string, retried = false): Promise<OpenSkyHttpResult> {
  const started = Date.now();
  const empty = (status: number): OpenSkyHttpResult => ({
    status,
    states: [],
    remaining: null,
    retryAfterSeconds: null,
  });
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      headers: { Accept: "application/json", ...(await authHeaders()) },
      cache: "no-store",
    });
    if (res.status === 401 && hasOpenSkyAuth() && !retried) {
      cachedToken = null;
      await fetchAccessToken(true);
      return loggedFetch(endpoint, true);
    }
    const quota = parseOpenSkyQuotaHeaders(res.headers);
    void persistOpenSkyQuota(res.headers);
    const latencyMs = Date.now() - started;
    await prisma.apiLog.create({
      data: {
        provider: "opensky",
        endpoint,
        statusCode: res.status,
        ok: res.ok,
        latencyMs,
        error: res.ok ? null : await res.text().catch(() => res.statusText),
      },
    });
    if (!res.ok) {
      return {
        status: res.status,
        states: [],
        remaining: quota?.remaining ?? null,
        retryAfterSeconds: quota?.resetSeconds ?? null,
      };
    }
    const data = (await res.json()) as { time?: number; states?: unknown[] };
    return {
      status: res.status,
      states: parseStates(data?.states ?? []),
      remaining: quota?.remaining ?? null,
      retryAfterSeconds: quota?.resetSeconds ?? null,
    };
  } catch (error) {
    await prisma.apiLog.create({
      data: {
        provider: "opensky",
        endpoint,
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : "fetch failed",
      },
    });
    return empty(0);
  }
}

export async function fetchOpenSkyStates(opts: {
  icao24?: string | null;
  origin?: LatLon | null;
  dest?: LatLon | null;
  current?: LatLon | null;
  callsigns: string[];
}): Promise<OpenSkyState | null> {
  const { minIntervalMs } = openSkyConfig();
  const gate = await takeToken({
    key: "ratelimit:opensky",
    minIntervalMs,
  });
  if (!gate.allowed) return null;

  if (opts.icao24) {
    const result = await loggedFetch(`/states/all?icao24=${encodeURIComponent(opts.icao24.toLowerCase())}`);
    // Known transponder: do not fall through to a transatlantic bbox search.
    return result.states[0] ?? null;
  }

  const points = [opts.origin, opts.dest, opts.current].filter(Boolean) as LatLon[];
  let endpoint = "/states/all";
  if (points.length) {
    const box = boundingBox(points, 6);
    endpoint += `?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`;
  }
  const result = await loggedFetch(endpoint);
  return result.states.find((s) => matchesCallsign(s.callsign, opts.callsigns)) ?? null;
}

export type OpenSkyBboxResult = OpenSkyHttpResult & {
  gated: boolean;
  retryAfterMs: number;
};

const ICAO24_BATCH = 40;

function uniqueIcao24s(values: string[]) {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * State vectors for known transponders — one OpenSky call per batch
 * (`icao24=hex1,hex2`), never a world scan.
 */
export async function fetchOpenSkyByIcao24s(icao24s: string[]): Promise<OpenSkyBboxResult> {
  const ids = uniqueIcao24s(icao24s);
  if (!ids.length) {
    return {
      status: 200,
      states: [],
      remaining: await getStoredOpenSkyRemaining(),
      retryAfterSeconds: null,
      gated: false,
      retryAfterMs: 0,
    };
  }

  const { minIntervalMs } = openSkyConfig();
  const gate = await takeToken({
    key: "ratelimit:opensky",
    minIntervalMs,
  });
  if (!gate.allowed) {
    return {
      status: 0,
      states: [],
      remaining: await getStoredOpenSkyRemaining(),
      retryAfterSeconds: null,
      gated: true,
      retryAfterMs: gate.retryAfterMs,
    };
  }

  const states: OpenSkyState[] = [];
  let remaining: number | null = null;
  let status = 200;
  for (const group of chunk(ids, ICAO24_BATCH)) {
    const endpoint = `/states/all?icao24=${group.map(encodeURIComponent).join(",")}`;
    const result = await loggedFetch(endpoint);
    status = result.status;
    remaining = result.remaining;
    states.push(...result.states);
    if (result.status === 429) {
      return { ...result, states, gated: false, retryAfterMs: (result.retryAfterSeconds ?? 60) * 1000 };
    }
  }
  return {
    status,
    states,
    remaining,
    retryAfterSeconds: null,
    gated: false,
    retryAfterMs: 0,
  };
}

/** All state vectors in a bounding box — one OpenSky call, not per aircraft. */
export async function fetchOpenSkyBbox(box: ViewportBounds): Promise<OpenSkyBboxResult> {
  const { minIntervalMs } = openSkyConfig();
  const gate = await takeToken({
    key: "ratelimit:opensky",
    minIntervalMs,
  });
  if (!gate.allowed) {
    return {
      status: 0,
      states: [],
      remaining: await getStoredOpenSkyRemaining(),
      retryAfterSeconds: null,
      gated: true,
      retryAfterMs: gate.retryAfterMs,
    };
  }

  const endpoint =
    `/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`;
  const result = await loggedFetch(endpoint);
  return {
    ...result,
    gated: false,
    retryAfterMs: 0,
  };
}

export function openSkyToTelemetry(state: OpenSkyState) {
  const altM = state.baroAltitude ?? state.geoAltitude;
  return {
    icao24: state.icao24,
    callsign: state.callsign,
    lat: state.lat,
    lon: state.lon,
    altitudeFt: altM != null ? altM * 3.28084 : null,
    velocityKts: state.velocity != null ? state.velocity * 1.94384 : null,
    heading: state.trueTrack,
    onGround: state.onGround,
    squawk: state.squawk,
    status: state.onGround ? FlightStatus.LANDED : FlightStatus.EN_ROUTE,
  };
}
