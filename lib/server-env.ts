import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Server/worker secrets. Do not import from Client Components.
 * Reads are lazy: Next/Turbopack can constant-fold top-level `process.env`
 * / `.env` access to empty, which left flight search unconfigured.
 */
function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function envFromFile() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
  ];
  for (const file of candidates) {
    try {
      return parseDotEnv(readFileSync(file, "utf8"));
    } catch {
      // try next
    }
  }
  return {};
}

function pick(name: string) {
  const fromProc = process.env[name]?.trim();
  // Next/Turbopack often defines the name as "" in the server bundle.
  // Empty must not win over the real `.env` value.
  const v = fromProc || envFromFile()[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/** Official AeroDataBox listing on API.Market (not RapidAPI). */
export const AERO_API_MARKET_BASE_URL = "https://prod.api.market/api/v1/aedbx/aerodatabox";

export type AeroMarketplace = "apimarket" | "rapidapi";

export function resolveAeroEndpoint(baseUrl?: string, host?: string) {
  const fromBase = baseUrl?.trim();
  const fromHost = host?.trim();
  let raw = fromBase ?? "";
  if (!raw && fromHost) {
    if (/^https?:\/\//i.test(fromHost)) {
      raw = fromHost;
    } else if (/rapidapi\.com/i.test(fromHost)) {
      raw = `https://${fromHost.replace(/^\/+/, "")}`;
    } else if (/api\.market/i.test(fromHost)) {
      raw = fromHost.includes("/api/v1/")
        ? `https://${fromHost.replace(/^\/+/, "")}`
        : AERO_API_MARKET_BASE_URL;
    } else {
      raw = `https://${fromHost.replace(/^\/+/, "")}`;
    }
  }
  if (!raw) raw = AERO_API_MARKET_BASE_URL;
  const aeroBaseUrl = raw.replace(/\/+$/, "");
  const marketplace: AeroMarketplace = /rapidapi\.com/i.test(aeroBaseUrl) ? "rapidapi" : "apimarket";
  let aeroHost = "prod.api.market";
  try {
    aeroHost = new URL(aeroBaseUrl).host;
  } catch {
    // keep default host for logging
  }
  return { aeroBaseUrl, aeroHost, marketplace };
}

export function aeroConfig() {
  const resolved = resolveAeroEndpoint(pick("AERODATABOX_BASE_URL"), pick("AERODATABOX_HOST"));
  return {
    aeroKey: pick("AERODATABOX_KEY"),
    ...resolved,
  };
}

export function hasAeroDataBox() {
  return Boolean(aeroConfig().aeroKey);
}

export function openSkyConfig() {
  const rawInterval = pick("OPENSKY_MIN_INTERVAL_MS");
  const parsed = rawInterval ? Number(rawInterval) : NaN;
  return {
    // OpenSky REST now uses OAuth2 client credentials. We keep the existing
    // OPENSKY_USERNAME / OPENSKY_PASSWORD names (client_id / client_secret).
    clientId: pick("OPENSKY_CLIENT_ID") ?? pick("OPENSKY_USERNAME"),
    clientSecret: pick("OPENSKY_CLIENT_SECRET") ?? pick("OPENSKY_PASSWORD"),
    minIntervalMs: Number.isFinite(parsed) && parsed > 0 ? parsed : 90_000,
  };
}

export function hasOpenSkyAuth() {
  const { clientId, clientSecret } = openSkyConfig();
  return Boolean(clientId && clientSecret);
}

export function fr24Config() {
  const rawInterval = pick("FR24_MIN_INTERVAL_MS");
  const parsed = rawInterval ? Number(rawInterval) : NaN;
  const enabledRaw = pick("FR24_ENABLED");
  return {
    // Official SDK / portal name. Never import this module from Client Components.
    token: pick("FR24_API_TOKEN"),
    envEnabled: enabledRaw == null || (enabledRaw !== "false" && enabledRaw !== "0"),
    // Cruise-like default (3 min). Never faster than Explorer 10/min (enforced in lib/fr24.ts).
    minIntervalMs: Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000,
  };
}

export function hasFr24Token() {
  return Boolean(fr24Config().token);
}
