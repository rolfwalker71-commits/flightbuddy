import type { SearchResult, TrafficSource } from "./airplanes.ts";
import { config } from "./config.ts";
import { normalizeSquawk, type Aircraft } from "./logic.ts";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const API = "https://opensky-network.org/api";
const FT_PER_M = 3.28084;
const KT_PER_MS = 1.94384;
const FPM_PER_MS = 196.85;
const SNAPSHOT_TTL_MS = 30_000;

type Fetch = typeof fetch;

/** Zeile aus /states/all: [icao24, callsign, country, t_pos, t_last, lon, lat, baro_alt(m), on_ground, v(m/s), track, vrate(m/s), …, squawk(14)] */
export function toAircraft(row: unknown[]): Aircraft | null {
  const lon = row[5], lat = row[6];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const onGround = row[8] === true;
  const alt = num(row[7]);
  const v = num(row[9]);
  const vr = num(row[11]);
  return {
    hex: String(row[0]).toLowerCase(),
    callsign: typeof row[1] === "string" && row[1].trim() ? row[1].trim() : null,
    registration: null, // OpenSky liefert keine Registration
    type: null,
    lat, lon,
    altitudeFt: onGround ? 0 : alt != null ? alt * FT_PER_M : null,
    groundSpeedKts: v != null ? v * KT_PER_MS : null,
    track: num(row[10]),
    verticalRateFpm: vr != null ? vr * FPM_PER_MS : null,
    squawk: normalizeSquawk(row[14]),
    onGround,
  };
}

/** Callsign gleich der Anfrage oder Anfrage plus ein Buchstabe (SWR64 → SWR64E), nie weitere Ziffern (SWR640). */
export function matchesCallsign(callsign: string | null, query: string): boolean {
  if (!callsign) return false;
  const c = callsign.toUpperCase(), q = query.toUpperCase();
  return c === q || (c.startsWith(q) && /^[A-Z]+$/.test(c.slice(q.length)) && c.length - q.length <= 2);
}

export class OpenSky implements TrafficSource {
  lastOk: number | null = null;
  lastError: string | null = null;
  creditsRemaining: number | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private blockedUntil = 0;
  private snapshot: { at: number; rows: Aircraft[] } | null = null;

  /** Woher die Zugangsdaten stammen: Umgebungsvariablen oder Eingabe in der App. */
  source: "env" | "app" | null;

  constructor(
    private clientId = config.opensky.clientId,
    private clientSecret = config.opensky.clientSecret,
    private doFetch: Fetch = fetch,
    private now: () => number = () => Date.now(),
  ) {
    this.source = clientId && clientSecret ? "env" : null;
  }

  get configured() { return !!this.clientId && !!this.clientSecret; }

  /** Neue Zugangsdaten setzen. Der alte Token und der Zwischenspeicher werden verworfen. */
  setCredentials(id: string, secret: string, source: "env" | "app" | null) {
    this.clientId = id; this.clientSecret = secret; this.source = source;
    this.token = null; this.snapshot = null; this.blockedUntil = 0; this.lastError = null;
  }

  /** Prüft die Zugangsdaten, indem ein Token angefordert wird. Wirft bei falschen Daten. */
  async verify(): Promise<void> {
    this.token = null;
    await this.accessToken();
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt) return this.token.value;
    const res = await this.doFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      this.lastError = `Token HTTP ${res.status}`;
      throw new Error(`OpenSky-Anmeldung fehlgeschlagen (HTTP ${res.status}): Client-ID/Secret prüfen`);
    }
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    // Der Token läuft nach 30 Minuten ab; 30 s früher erneuern.
    this.token = { value: body.access_token, expiresAt: this.now() + ((body.expires_in ?? 1800) - 30) * 1000 };
    return this.token.value;
  }

  private async get(path: string): Promise<Aircraft[]> {
    if (!this.configured) throw new Error("OpenSky nicht konfiguriert (OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET)");
    if (this.now() < this.blockedUntil) throw new Error("OpenSky: Kontingent erschöpft, Pause");
    const call = async () => this.doFetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    let res = await call();
    if (res.status === 401) { this.token = null; res = await call(); } // Token abgelaufen: einmal erneuern
    const left = res.headers.get("x-rate-limit-remaining");
    if (left != null) this.creditsRemaining = Number(left);
    if (res.status === 429) {
      const wait = Number(res.headers.get("x-rate-limit-retry-after-seconds") ?? 60);
      this.blockedUntil = this.now() + wait * 1000;
      this.lastError = `HTTP 429 (Pause ${wait} s)`;
      throw new Error(this.lastError);
    }
    if (!res.ok) { this.lastError = `HTTP ${res.status}`; throw new Error(this.lastError); }
    this.lastOk = this.now();
    this.lastError = null;
    const body = (await res.json()) as { states?: unknown[][] | null };
    return (body.states ?? []).map(toAircraft).filter((a): a is Aircraft => a != null);
  }

  async byHex(hexes: string[]) {
    const q = hexes.map((h) => `icao24=${encodeURIComponent(h.toLowerCase())}`).join("&");
    return this.get(`/states/all?${q}`); // 1 Credit pro Abfrage
  }

  /** Globaler Schnappschuss (4 Credits), 30 s zwischengespeichert, damit mehrere Suchen nicht mehrfach kosten. */
  private async all(): Promise<Aircraft[]> {
    if (this.snapshot && this.now() - this.snapshot.at < SNAPSHOT_TTL_MS) return this.snapshot.rows;
    const rows = await this.get("/states/all");
    this.snapshot = { at: this.now(), rows };
    return rows;
  }

  async byCallsign(callsign: string) {
    const q = callsign.toUpperCase();
    return (await this.all()).filter((a) => a.callsign?.toUpperCase() === q);
  }
  /** OpenSky kennt keine Registrationen. Ein Fehler ist ehrlicher als eine leere Liste, die wie «nicht in der Luft» aussieht. */
  async byRegistration(_reg: string): Promise<Aircraft[]> {
    throw new Error("OpenSky kann nicht nach Registration suchen (Hex-Code oder Callsign verwenden)");
  }

  async searchCallsign(query: string): Promise<SearchResult> {
    const q = query.toUpperCase().replace(/\s+/g, "");
    return { aircraft: (await this.all()).filter((a) => matchesCallsign(a.callsign, q)), partial: false };
  }

  async near(lat: number, lon: number, radiusNm: number) {
    const dLat = radiusNm / 60;
    const dLon = radiusNm / (60 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const f = (n: number) => n.toFixed(4);
    return this.get(`/states/all?lamin=${f(lat - dLat)}&lomin=${f(lon - dLon)}&lamax=${f(lat + dLat)}&lomax=${f(lon + dLon)}`);
  }
}
