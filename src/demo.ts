import type { SearchResult, TrafficSource } from "./airplanes.ts";
import type { Aircraft } from "./logic.ts";

const ZRH = { lat: 47.4647, lon: 8.5492 };
const LHR = { lat: 51.47, lon: -0.4543 };

/** Zeitplan eines Demo-Flugs in Sekunden seit dem ersten Abruf. */
export const DEMO = {
  groundUntil: 45,       // am Boden in Zürich
  cruiseFrom: 105,       // Steigflug bis hierhin
  squawkFrom: 120,       // Notfall-Squawk 7700 …
  squawkUntil: 150,      // … bis hier
  descentFrom: 270,      // Sinkflug
  landedAt: 330,         // gelandet in London
};

const PLANES: Record<string, { callsign: string; registration: string }> = {
  "4b1814": { callsign: "SWR8", registration: "HB-JNA" },
  "3c6444": { callsign: "DLH7XK", registration: "D-AIUA" },
};

/**
 * Simuliert Verkehr für Tests ohne airplanes.live (TRAFFIC_SOURCE=demo).
 * Jeder Hex startet bei der ersten Abfrage seinen eigenen Flug. Wird mehr als 2 Minuten lang nicht abgefragt
 * (zum Beispiel nach der Landung), beginnt beim nächsten Abruf ein neuer Flug.
 */
export class DemoTraffic implements TrafficSource {
  private started = new Map<string, number>();
  private lastQuery = new Map<string, number>();

  constructor(private now: () => number = () => Date.now()) {}

  private at(hex: string): Aircraft | null {
    const meta = PLANES[hex];
    if (!meta) return null;
    const now = this.now();
    if (!this.started.has(hex) || now - (this.lastQuery.get(hex) ?? 0) > 120_000) this.started.set(hex, now);
    this.lastQuery.set(hex, now);
    const t = (now - this.started.get(hex)!) / 1000;

    const f = Math.min(1, Math.max(0, (t - DEMO.groundUntil) / (DEMO.landedAt - DEMO.groundUntil)));
    const lat = ZRH.lat + (LHR.lat - ZRH.lat) * f;
    const lon = ZRH.lon + (LHR.lon - ZRH.lon) * f;
    const base = { hex, callsign: meta.callsign, registration: meta.registration, track: 300, squawk: "1000" };

    if (t < DEMO.groundUntil) return { ...base, lat: ZRH.lat, lon: ZRH.lon, altitudeFt: 0, groundSpeedKts: 5, verticalRateFpm: 0, onGround: true };
    if (t >= DEMO.landedAt) return { ...base, lat: LHR.lat, lon: LHR.lon, altitudeFt: 0, groundSpeedKts: 8, verticalRateFpm: 0, onGround: true };

    let alt = 36_000, gs = 430, vr = 0;
    if (t < DEMO.cruiseFrom) {
      const k = (t - DEMO.groundUntil) / (DEMO.cruiseFrom - DEMO.groundUntil);
      alt = 1_500 + k * 34_500; gs = 190 + k * 240; vr = 2_500;
    } else if (t >= DEMO.descentFrom) {
      const k = (t - DEMO.descentFrom) / (DEMO.landedAt - DEMO.descentFrom);
      alt = Math.max(300, 36_000 * (1 - k)); gs = 430 - k * 280; vr = -2_000;
    }
    const squawk = t >= DEMO.squawkFrom && t < DEMO.squawkUntil ? "7700" : "1000";
    return { ...base, squawk, lat, lon, altitudeFt: alt, groundSpeedKts: gs, verticalRateFpm: vr, onGround: false };
  }

  async byHex(hexes: string[]) { return hexes.map((h) => this.at(h.toLowerCase())).filter((a): a is Aircraft => a != null); }
  async byCallsign(cs: string) {
    const hex = Object.keys(PLANES).find((h) => PLANES[h]!.callsign === cs.toUpperCase());
    const a = hex ? this.at(hex) : null; return a ? [a] : [];
  }
  async byRegistration(reg: string) {
    const hex = Object.keys(PLANES).find((h) => PLANES[h]!.registration === reg.toUpperCase());
    const a = hex ? this.at(hex) : null; return a ? [a] : [];
  }

  async near() { return Object.keys(PLANES).map((h) => this.at(h)).filter((a): a is Aircraft => a != null); }
  async searchCallsign(query: string): Promise<SearchResult> {
    const q = query.toUpperCase();
    const hits = (await this.near()).filter((a) => a.callsign?.startsWith(q));
    return { aircraft: hits, partial: false };
  }
}
