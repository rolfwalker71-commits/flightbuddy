import { FlightStatus } from "@prisma/client";
import { haversineNm, pointAlongGreatCircle, type LatLon } from "./geo";

/** Prefer a stored ADS-B/ADB fix until this age; then time-advance the remaining geodesic. */
export const LIVE_FIX_STALE_MS = 3 * 60 * 1000;

function asDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function timeFraction(start: Date, end: Date, now: Date) {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 0;
  return clamp01((now.getTime() - start.getTime()) / span);
}

export function departureInstant(opts: {
  actualDep?: Date | string | null;
  estimatedDep?: Date | string | null;
  scheduledDep?: Date | string | null;
}) {
  return asDate(opts.actualDep) ?? asDate(opts.estimatedDep) ?? asDate(opts.scheduledDep);
}

export function arrivalInstant(opts: {
  actualArr?: Date | string | null;
  estimatedArr?: Date | string | null;
  scheduledArr?: Date | string | null;
}) {
  return asDate(opts.actualArr) ?? asDate(opts.estimatedArr) ?? asDate(opts.scheduledArr);
}

export function geometricProgress(origin: LatLon, dest: LatLon, current: LatLon) {
  const total = haversineNm(origin, dest);
  if (total <= 0) return 0;
  return clamp01(1 - haversineNm(current, dest) / total);
}

export type InterpolateFlightInput = {
  origin?: LatLon | null;
  dest?: LatLon | null;
  lastFix?: LatLon | null;
  lastFixAt?: Date | string | null;
  scheduledDep?: Date | string | null;
  estimatedDep?: Date | string | null;
  actualDep?: Date | string | null;
  scheduledArr?: Date | string | null;
  estimatedArr?: Date | string | null;
  actualArr?: Date | string | null;
  status: FlightStatus;
  now?: Date;
};

function isFinished(status: FlightStatus) {
  return (
    status === FlightStatus.LANDED ||
    status === FlightStatus.CANCELLED ||
    status === FlightStatus.DIVERTED
  );
}

function hasDeparted(status: FlightStatus, dep: Date | null, now: Date) {
  if (isFinished(status)) return false;
  if (status === FlightStatus.DEPARTED || status === FlightStatus.EN_ROUTE) return true;
  return Boolean(dep && dep.getTime() <= now.getTime());
}

/** True once the aircraft is away (status or effective dep in the past). Not landed/cancelled. */
export function flightHasDeparted(
  input: Pick<InterpolateFlightInput, "status" | "scheduledDep" | "estimatedDep" | "actualDep">,
  now = new Date(),
) {
  return hasDeparted(input.status, departureInstant(input), now);
}

/**
 * Display position while airborne. Fresh ADS-B/ADB wins; a stale (or missing)
 * fix is advanced along the remaining great circle using dep/arr times.
 * Estimates are display-only — never persist as a live fix or invent altitude.
 */
export function interpolateAirbornePosition(input: InterpolateFlightInput): {
  position: LatLon | null;
  estimated: boolean;
} {
  const now = input.now ?? new Date();
  const origin = input.origin ?? null;
  const dest = input.dest ?? null;
  const lastFix =
    input.lastFix && Number.isFinite(input.lastFix.lat) && Number.isFinite(input.lastFix.lon)
      ? input.lastFix
      : null;
  const lastFixAt = asDate(input.lastFixAt);
  const dep = departureInstant(input);
  const arr = arrivalInstant(input);

  if (!hasDeparted(input.status, dep, now) || !origin || !dest) {
    return { position: lastFix, estimated: false };
  }

  const lastAgeMs = lastFixAt ? now.getTime() - lastFixAt.getTime() : null;
  const lastFresh = Boolean(
    lastFix && lastFixAt && lastAgeMs != null && lastAgeMs >= 0 && lastAgeMs <= LIVE_FIX_STALE_MS,
  );
  if (lastFresh) {
    return { position: lastFix, estimated: false };
  }

  if (lastFix && lastFixAt && arr && arr.getTime() > lastFixAt.getTime()) {
    const t = timeFraction(lastFixAt, arr, now);
    return { position: pointAlongGreatCircle(lastFix, dest, t), estimated: true };
  }

  if (dep && arr && arr.getTime() > dep.getTime()) {
    const t = timeFraction(dep, arr, now);
    if (lastFix) {
      const lastP = geometricProgress(origin, dest, lastFix);
      if (t <= lastP) return { position: lastFix, estimated: false };
      const local = lastP >= 1 ? 1 : (t - lastP) / (1 - lastP);
      return { position: pointAlongGreatCircle(lastFix, dest, local), estimated: true };
    }
    return { position: pointAlongGreatCircle(origin, dest, t), estimated: true };
  }

  return { position: lastFix, estimated: false };
}

/** Tick while airborne so interpolation can start the moment a live fix goes stale. */
export function flightNeedsInterpolationClock(input: InterpolateFlightInput, now = new Date()) {
  const dep = departureInstant(input);
  return hasDeparted(input.status, dep, now);
}
