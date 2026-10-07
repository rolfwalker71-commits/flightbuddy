// Port der App-Logik (Swift: Logic/Geo.swift, FlightPhase.swift, Squawk.swift).
const R_NM = 3440.065;

export type LatLon = { lat: number; lon: number };

export function distanceNm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dφ = (b.lat - a.lat) * rad;
  const dλ = (b.lon - a.lon) * rad;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dλ / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function progress(origin: LatLon, dest: LatLon, cur: LatLon): number {
  const total = distanceNm(origin, dest);
  return total > 0 ? Math.min(1, Math.max(0, 1 - distanceNm(cur, dest) / total)) : 0;
}

export function etaSeconds(cur: LatLon, dest: LatLon, gsKts: number | null): number | null {
  if (gsKts == null || gsKts <= 80) return null;
  return (distanceNm(cur, dest) / gsKts) * 3600;
}

export type Phase = "ground" | "climb" | "cruise" | "descent" | "approach";

export const PHASE_LABEL: Record<Phase, string> = {
  ground: "Am Boden",
  climb: "Steigflug",
  cruise: "Reiseflug",
  descent: "Sinkflug",
  approach: "Anflug",
};

export function phaseOf(a: Aircraft, distToDestNm: number | null): Phase {
  if (a.onGround) return "ground";
  const alt = a.altitudeFt ?? 0;
  const vr = a.verticalRateFpm ?? 0;
  if (distToDestNm != null && distToDestNm < 40 && alt < 10_000) return "approach";
  if (vr > 500 && alt < 30_000) return "climb";
  if (vr < -500) return alt < 10_000 ? "approach" : "descent";
  return alt < 3_000 && (a.groundSpeedKts ?? 0) < 200 ? "climb" : "cruise";
}

export const EMERGENCY = new Set(["7500", "7600", "7700"]);

export function normalizeSquawk(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^[0-7]{4}$/.test(s) ? s : null;
}

export function shouldAlertSquawk(prev: string | null, next: string | null): boolean {
  return next != null && EMERGENCY.has(next) && prev !== next;
}

export function squawkMeaning(code: string): string {
  return code === "7500" ? "Flugzeugentführung" : code === "7600" ? "Funkausfall" : "Allgemeiner Notfall";
}

export type Aircraft = {
  hex: string;
  callsign: string | null;
  registration: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  groundSpeedKts: number | null;
  track: number | null;
  verticalRateFpm: number | null;
  squawk: string | null;
  onGround: boolean;
};
