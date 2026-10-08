import type { SearchResult, TrafficSource } from "./airplanes.ts";
import type { Aircraft } from "./logic.ts";

/** Erste Quelle zuerst; bei einem Fehler (nicht bei leerem Ergebnis) die zweite. */
export class FallbackTraffic implements TrafficSource {
  lastUsed: "primary" | "secondary" = "primary";
  constructor(private primary: TrafficSource, private secondary: TrafficSource) {}

  private async pick<T>(fn: (s: TrafficSource) => Promise<T>): Promise<T> {
    try {
      const r = await fn(this.primary);
      this.lastUsed = "primary";
      return r;
    } catch (primaryError) {
      try {
        const r = await fn(this.secondary);
        this.lastUsed = "secondary";
        return r;
      } catch (secondaryError) {
        // Beide Gründe nennen, damit klar ist, warum auch die Ausweichquelle nicht geholfen hat.
        const a = primaryError instanceof Error ? primaryError.message : String(primaryError);
        const b = secondaryError instanceof Error ? secondaryError.message : String(secondaryError);
        throw new Error(`${a}; Ausweichquelle: ${b}`);
      }
    }
  }

  byHex(h: string[]) { return this.pick((s) => s.byHex(h)); }
  byCallsign(c: string) { return this.pick((s) => s.byCallsign(c)); }
  byRegistration(r: string) { return this.pick((s) => s.byRegistration(r)); }
  near(lat: number, lon: number, r: number) { return this.pick((s) => s.near(lat, lon, r)); }
  searchCallsign(q: string): Promise<SearchResult> { return this.pick((s) => s.searchCallsign(q)); }
}

export type PublicAircraft = Pick<Aircraft, "hex" | "callsign" | "registration" | "type" | "lat" | "lon" | "altitudeFt"
  | "groundSpeedKts" | "track" | "verticalRateFpm" | "squawk" | "onGround"> & { positionAgeSeconds: number | null };

export function toPublic(a: Aircraft): PublicAircraft {
  return { hex: a.hex, callsign: a.callsign, registration: a.registration, type: a.type ?? null, lat: a.lat, lon: a.lon,
    altitudeFt: a.altitudeFt, groundSpeedKts: a.groundSpeedKts, track: a.track, verticalRateFpm: a.verticalRateFpm,
    squawk: a.squawk, onGround: a.onGround, positionAgeSeconds: a.ageSec ?? null };
}

/** Welche Quelle gerade antwortet und wie oft die App die Karte aktualisieren soll (OpenSky hat ein Tageskontingent). */
export function trafficMeta(traffic: object, sourceName: string): { source: "airplanes" | "opensky" | "demo"; refreshSeconds: number } {
  const used = traffic instanceof FallbackTraffic ? (traffic.lastUsed === "secondary" ? "opensky" : "airplanes")
    : sourceName === "opensky" ? "opensky" : sourceName === "demo" ? "demo" : "airplanes";
  return { source: used, refreshSeconds: used === "opensky" ? 30 : 10 };
}
