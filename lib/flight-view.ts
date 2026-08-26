import type { Airline, Airport, Flight, FlightPosition, UserFlight } from "@prisma/client";
import { differenceInMinutes, format } from "date-fns";
import { flightProgress, headingAlongGreatCircle, haversineMiles, type LatLon } from "./geo";
import { isLiveStatus, isPastStatus } from "./flight-status";
import { displayFlightNumber } from "./utils";

export type FlightWithRelations = Flight & {
  airline: Airline | null;
  departureAirport: Airport | null;
  arrivalAirport: Airport | null;
  positions: FlightPosition[];
};

export type UserFlightView = UserFlight & { flight: FlightWithRelations };

export function filterFlights(rows: UserFlightView[], tab: "upcoming" | "live" | "past") {
  return rows.filter(({ flight }) => {
    if (tab === "live") return isLiveStatus(flight.status);
    if (tab === "past") return isPastStatus(flight.status);
    return !isPastStatus(flight.status);
  });
}

export function flightMetrics(flight: FlightWithRelations) {
  const origin = flight.departureAirport;
  const dest = flight.arrivalAirport;
  const current =
    flight.lastLat != null && flight.lastLon != null
      ? { lat: flight.lastLat, lon: flight.lastLon }
      : null;
  const scheduledDep = asDate(flight.scheduledDep);
  const scheduledArr = asDate(flight.scheduledArr);
  const actualDep = asDate(flight.actualDep);
  const progress = flightProgress({
    origin,
    dest,
    current,
    scheduledDep,
    scheduledArr,
    actualDep,
  });
  const remainingMiles =
    current && dest ? haversineMiles(current, dest) : dest && origin ? haversineMiles(origin, dest) * (1 - progress) : null;
  const durationMin =
    scheduledArr && scheduledDep ? differenceInMinutes(scheduledArr, scheduledDep) : null;
  const remainingMin =
    durationMin != null ? Math.max(0, Math.round(durationMin * (1 - progress))) : null;
  return { progress, remainingMiles, remainingMin, durationMin, origin, dest, current };
}

export function flightTrack(flight: Pick<FlightWithRelations, "positions" | "lastLat" | "lastLon">): LatLon[] {
  const pts = [...flight.positions]
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .map((p) => ({ lat: p.lat, lon: p.lon }));
  if (flight.lastLat != null && flight.lastLon != null) {
    const last = pts[pts.length - 1];
    if (!last || last.lat !== flight.lastLat || last.lon !== flight.lastLon) {
      pts.push({ lat: flight.lastLat, lon: flight.lastLon });
    }
  }
  return pts;
}

/**
 * Live ADS-B when stored; otherwise great-circle heading and schedule-based speed.
 * Never invents altitude. Estimates are display-only — not persisted as ADS-B.
 */
export function flightTelemetry(flight: FlightWithRelations, metrics = flightMetrics(flight)) {
  const canEstimate =
    isLiveStatus(flight.status) || metrics.current != null;
  let heading = flight.lastHeading ?? null;
  let headingEstimated = false;
  if (heading == null && canEstimate && metrics.origin && metrics.dest) {
    heading = headingAlongGreatCircle(metrics.origin, metrics.dest, metrics.progress);
    headingEstimated = true;
  }

  let speedKts = flight.lastVelocityKts ?? null;
  let speedEstimated = false;
  if (speedKts == null && canEstimate && metrics.remainingMiles != null) {
    const eta = asDate(flight.estimatedArr) ?? asDate(flight.scheduledArr);
    const remainingMin =
      eta && eta.getTime() > Date.now()
        ? differenceInMinutes(eta, new Date())
        : metrics.remainingMin;
    if (remainingMin != null && remainingMin >= 3) {
      const remainingNm = metrics.remainingMiles / 1.15078;
      const estimated = remainingNm / (remainingMin / 60);
      if (estimated >= 80 && estimated <= 550) {
        speedKts = estimated;
        speedEstimated = true;
      }
    }
  }

  return {
    heading,
    headingEstimated,
    speedKts,
    speedEstimated,
    altitudeFt: flight.lastAltitudeFt ?? null,
  };
}

export function toMapFlight(flight: FlightWithRelations, opts?: { active?: boolean }) {
  const m = flightMetrics(flight);
  return {
    id: flight.id,
    from: m.origin,
    to: m.dest,
    current: m.current,
    progress: m.progress,
    heading: flight.lastHeading,
    label: displayFlightNumber(flight.flightNumber),
    track: flightTrack(flight),
    icao24: flight.icao24?.toLowerCase() ?? null,
    active: opts?.active,
  };
}

function asDate(date?: Date | string | null) {
  if (!date) return null;
  return date instanceof Date ? date : new Date(date);
}

export function formatClock(date?: Date | string | null) {
  const d = asDate(date);
  if (!d) return "—";
  return format(d, "HH:mm");
}

export function formatDay(date?: Date | string | null) {
  const d = asDate(date);
  if (!d) return "";
  return format(d, "MMM d");
}
