import { candidateCallsigns, matchesCallsign } from "./callsign";
import { destinationPoint, type LatLon } from "./geo";

export type ViewportBounds = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

export type ViewportTrafficAircraft = {
  icao24: string;
  callsign: string | null;
  airlineName: string | null;
  airlineIata: string | null;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  speedKts: number | null;
  heading: number | null;
  onGround: boolean;
};

export type ViewportTrafficResponse = {
  aircraft: ViewportTrafficAircraft[];
  remaining: number | null;
  intervalMs: number;
  retryAfterMs: number;
  fetched: boolean;
  source: "opensky";
  exhausted?: boolean;
  areaSqDeg?: number;
};

/** OpenSky charges 4 credits above this (or for a global query). */
export const VIEWPORT_TRAFFIC_MAX_AREA_SQ_DEG = 400;

/**
 * Safety cap only — not a short kill switch. OpenSky polls every ~90s; keep
 * projecting until the next fix (plus a missed cycle) so the layer never
 * freezes after a few seconds.
 */
export const VIEWPORT_TRAFFIC_DR_MAX_MS = 180_000;

export function bboxAreaSqDeg(box: ViewportBounds) {
  return Math.max(0, box.lamax - box.lamin) * Math.max(0, box.lomax - box.lomin);
}

export function isViewportTooLarge(box: ViewportBounds) {
  return bboxAreaSqDeg(box) > VIEWPORT_TRAFFIC_MAX_AREA_SQ_DEG;
}

export function boundsNearlyEqual(a: ViewportBounds | null, b: ViewportBounds | null, epsilon = 0.02) {
  if (!a || !b) return false;
  return (
    Math.abs(a.lamin - b.lamin) < epsilon &&
    Math.abs(a.lomin - b.lomin) < epsilon &&
    Math.abs(a.lamax - b.lamax) < epsilon &&
    Math.abs(a.lomax - b.lomax) < epsilon
  );
}

export function isValidViewportBounds(box: ViewportBounds) {
  const { lamin, lomin, lamax, lomax } = box;
  if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) return false;
  if (lamin < -90 || lamax > 90 || lamin >= lamax) return false;
  if (lomin < -180 || lomax > 180 || lomin >= lomax) return false;
  return true;
}

export function parseViewportBounds(params: URLSearchParams): ViewportBounds | null {
  const box = {
    lamin: Number(params.get("lamin")),
    lomin: Number(params.get("lomin")),
    lamax: Number(params.get("lamax")),
    lomax: Number(params.get("lomax")),
  };
  return isValidViewportBounds(box) ? box : null;
}

export function viewportQuery(box: ViewportBounds) {
  const q = new URLSearchParams({
    lamin: String(box.lamin),
    lomin: String(box.lomin),
    lamax: String(box.lamax),
    lomax: String(box.lomax),
  });
  return q.toString();
}

/** ICAO/IATA prefix from an OpenSky callsign (`DLH441` → `DLH`). */
export function callsignPrefix(callsign: string | null): string | null {
  if (!callsign) return null;
  const compact = callsign.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const match = compact.match(/^([A-Z]{2,3})/);
  return match?.[1] ?? null;
}

export function trafficMatchesFlight(
  ac: Pick<ViewportTrafficAircraft, "icao24" | "callsign">,
  flight: {
    icao24?: string | null;
    flightNumber: string;
    airlineIata?: string | null;
    airlineIcao?: string | null;
    airline?: { iata?: string | null; icao?: string | null } | null;
  },
) {
  if (flight.icao24 && flight.icao24.toLowerCase() === ac.icao24.toLowerCase()) return true;
  return matchesCallsign(
    ac.callsign,
    candidateCallsigns({
      flightNumber: flight.flightNumber,
      airlineIata: flight.airlineIata ?? flight.airline?.iata,
      airlineIcao: flight.airlineIcao ?? flight.airline?.icao,
    }),
  );
}

export function deadReckonAircraft(
  ac: ViewportTrafficAircraft,
  elapsedMs: number,
): LatLon {
  const heading = ac.heading;
  const speed = ac.speedKts;
  if (
    heading == null ||
    !Number.isFinite(heading) ||
    speed == null ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    elapsedMs <= 0
  ) {
    return { lat: ac.lat, lon: ac.lon };
  }
  const dt = Math.min(elapsedMs, VIEWPORT_TRAFFIC_DR_MAX_MS);
  const nm = speed * (dt / 3_600_000);
  return destinationPoint({ lat: ac.lat, lon: ac.lon }, heading, nm);
}
