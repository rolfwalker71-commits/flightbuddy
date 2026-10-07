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
      } catch {
        throw primaryError; // Fehler der Hauptquelle melden
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
  | "groundSpeedKts" | "track" | "verticalRateFpm" | "squawk" | "onGround">;

export function toPublic(a: Aircraft): PublicAircraft {
  return { hex: a.hex, callsign: a.callsign, registration: a.registration, type: a.type ?? null, lat: a.lat, lon: a.lon,
    altitudeFt: a.altitudeFt, groundSpeedKts: a.groundSpeedKts, track: a.track, verticalRateFpm: a.verticalRateFpm,
    squawk: a.squawk, onGround: a.onGround };
}
