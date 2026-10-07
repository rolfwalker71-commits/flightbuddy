import { config } from "./config.ts";
import { normalizeSquawk, type Aircraft } from "./logic.ts";

export interface TrafficSource {
  byHex(hexes: string[]): Promise<Aircraft[]>;
  byCallsign(callsign: string): Promise<Aircraft[]>;
  byRegistration(reg: string): Promise<Aircraft[]>;
}

type Raw = {
  hex: string; flight?: string; r?: string; lat?: number; lon?: number;
  alt_baro?: number | string; gs?: number; track?: number; baro_rate?: number; squawk?: string;
};

function toAircraft(r: Raw): Aircraft | null {
  if (typeof r.lat !== "number" || typeof r.lon !== "number") return null;
  const ground = r.alt_baro === "ground";
  return {
    hex: r.hex.toLowerCase(),
    callsign: r.flight?.trim() || null,
    registration: r.r?.trim() || null,
    lat: r.lat,
    lon: r.lon,
    altitudeFt: ground ? 0 : typeof r.alt_baro === "number" ? r.alt_baro : null,
    groundSpeedKts: r.gs ?? null,
    track: r.track ?? null,
    verticalRateFpm: r.baro_rate ?? null,
    squawk: normalizeSquawk(r.squawk),
    onGround: ground,
  };
}

export class AirplanesLive implements TrafficSource {
  lastOk: number | null = null;
  lastError: string | null = null;
  private last = 0;
  private blockedUntil = 0;
  private backoff = 5_000;

  /** Eine Anfrage pro 1,1 s; nach HTTP 429 wird exponentiell pausiert. */
  private async get(path: string): Promise<Aircraft[]> {
    if (Date.now() < this.blockedUntil) throw new Error("rate limited (backoff)");
    const wait = 1_100 - (Date.now() - this.last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const res = await fetch(`${config.airplanesBase}/${path}`, {
      headers: {
        "User-Agent": `FlightBuddy-Server/1.0 (non-commercial personal flight tracker; contact: ${config.contact})`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      this.blockedUntil = Date.now() + this.backoff;
      this.backoff = Math.min(this.backoff * 2, 120_000);
      this.lastError = "HTTP 429";
      throw new Error("HTTP 429");
    }
    if (!res.ok) {
      this.lastError = `HTTP ${res.status}${res.status === 403 ? " (Zugriff nicht freigeschaltet: contact@airplanes.live)" : ""}`;
      throw new Error(this.lastError);
    }
    this.backoff = 5_000;
    this.lastOk = Date.now();
    this.lastError = null;
    const body = (await res.json()) as { ac?: Raw[] };
    return (body.ac ?? []).map(toAircraft).filter((a): a is Aircraft => a != null);
  }

  byHex(hexes: string[]) {
    return this.get(`hex/${hexes.map((h) => h.toLowerCase()).join(",")}`);
  }
  byCallsign(cs: string) {
    return this.get(`callsign/${encodeURIComponent(cs.toUpperCase())}`);
  }
  byRegistration(reg: string) {
    return this.get(`reg/${encodeURIComponent(reg.toUpperCase())}`);
  }
}
