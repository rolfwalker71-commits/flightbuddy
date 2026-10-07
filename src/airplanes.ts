import { config } from "./config.ts";
import { normalizeSquawk, type Aircraft } from "./logic.ts";

export type SearchResult = { aircraft: Aircraft[]; partial: boolean };

export interface TrafficSource {
  byHex(hexes: string[]): Promise<Aircraft[]>;
  byCallsign(callsign: string): Promise<Aircraft[]>;
  byRegistration(reg: string): Promise<Aircraft[]>;
  /** Flugzeuge im Umkreis (Kartenansicht). */
  near(lat: number, lon: number, radiusNm: number): Promise<Aircraft[]>;
  /** Callsign mit Toleranz für einen Buchstaben-Suffix (SWR64 findet SWR64E). */
  searchCallsign(query: string): Promise<SearchResult>;
}

/** So lange wird airplanes.live nach einem 403 nicht mehr angefragt. */
export const DENIED_PAUSE_MS = 10 * 60_000;

export const SUFFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type Raw = {
  hex: string; flight?: string; r?: string; t?: string; lat?: number; lon?: number;
  alt_baro?: number | string; gs?: number; track?: number; baro_rate?: number; squawk?: string;
};

function toAircraft(r: Raw): Aircraft | null {
  if (typeof r.lat !== "number" || typeof r.lon !== "number") return null;
  const ground = r.alt_baro === "ground";
  return {
    hex: r.hex.toLowerCase(),
    callsign: r.flight?.trim() || null,
    registration: r.r?.trim() || null,
    type: r.t?.trim() || null,
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
  /** Nach einem 403 (Zugriff nicht freigeschaltet) wird die Quelle eine Weile übersprungen. */
  private deniedUntil = 0;
  private backoff = 5_000;

  constructor(private doFetch: typeof fetch = fetch, private now: () => number = () => Date.now()) {}

  /** Eine Anfrage pro 1,1 s; nach HTTP 429 wird exponentiell pausiert, nach 403 zehn Minuten ganz ausgesetzt. */
  private async get(path: string): Promise<Aircraft[]> {
    // Gesperrt: sofort scheitern, ohne Wartezeit und ohne Anfrage, damit die Ausweichquelle gleich übernimmt.
    if (this.now() < this.deniedUntil) throw new Error(this.lastError ?? "HTTP 403 (Zugriff nicht freigeschaltet)");
    if (this.now() < this.blockedUntil) throw new Error("rate limited (backoff)");
    const wait = 1_100 - (this.now() - this.last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = this.now();
    const res = await this.doFetch(`${config.airplanesBase}/${path}`, {
      headers: {
        "User-Agent": `FlightBuddy-Server/1.0 (non-commercial personal flight tracker; contact: ${config.contact})`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      this.blockedUntil = this.now() + this.backoff;
      this.backoff = Math.min(this.backoff * 2, 120_000);
      this.lastError = "HTTP 429";
      throw new Error("HTTP 429");
    }
    if (!res.ok) {
      this.lastError = `HTTP ${res.status}${res.status === 403 ? " (Zugriff nicht freigeschaltet: contact@airplanes.live)" : ""}`;
      if (res.status === 403) this.deniedUntil = this.now() + DENIED_PAUSE_MS;
      throw new Error(this.lastError);
    }
    this.backoff = 5_000;
    this.deniedUntil = 0;
    this.lastOk = this.now();
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
  near(lat: number, lon: number, radiusNm: number) {
    return this.get(`point/${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.round(Math.min(Math.max(radiusNm, 1), 250))}`);
  }

  /**
   * airplanes.live kennt keine Präfix-Suche: erst exakt, dann mit jedem Buchstaben A–Z probieren.
   * Das braucht wegen des Limits bis zu 26 Anfragen; nach `budgetMs` wird mit dem bisherigen Stand abgebrochen.
   */
  async searchCallsign(query: string, budgetMs = 14_000): Promise<SearchResult> {
    const q = query.toUpperCase().replace(/\s+/g, "");
    const exact = await this.byCallsign(q);
    if (exact.length) return { aircraft: exact, partial: false };
    const deadline = Date.now() + budgetMs;
    const found: Aircraft[] = [];
    for (const letter of SUFFIXES) {
      if (Date.now() > deadline) return { aircraft: found, partial: true };
      found.push(...(await this.byCallsign(q + letter)));
    }
    return { aircraft: found, partial: false };
  }
}
