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

export function aeroConfig() {
  return {
    aeroKey: pick("AERODATABOX_KEY"),
    aeroHost: pick("AERODATABOX_HOST") ?? "aerodatabox.p.rapidapi.com",
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
