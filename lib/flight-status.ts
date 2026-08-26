import { FlightStatus, PollPhase, type Flight } from "@prisma/client";
import { env } from "./env";
import { flightProgress, type LatLon } from "./geo";

export type PollScheduleInput = {
  status: Flight["status"];
  scheduledDep: Date | string;
  actualDep?: Date | string | null;
  estimatedDep?: Date | string | null;
  scheduledArr?: Date | string | null;
  estimatedArr?: Date | string | null;
  lastLat?: number | null;
  lastLon?: number | null;
  departureAirport?: LatLon | null;
  arrivalAirport?: LatLon | null;
};

function asDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Adaptive poll schedule. The cycle may run faster than OpenSky
 * (`OPENSKY_MIN_INTERVAL_MS`, default 90s); OpenSky stays gated and
 * AeroDataBox location fills cooldown. Never faster than AeroDataBox 1.2s.
 *
 * | Phase / window                         | Interval      |
 * |----------------------------------------|---------------|
 * | INACTIVE (> preflight window to dep)   | 8 h           |
 * | PREFLIGHT, > 45 min to dep             | 15 min        |
 * | PREFLIGHT, last 45 min to dep          | 3 min         |
 * | AIRBORNE climb (first 10 min after     | 10 s          |
 * |   actual/estimated/scheduled dep, or   |               |
 * |   progress still very low if no dep)   |               |
 * | AIRBORNE climb (first 10–20 min after  | 30 s          |
 * |   dep, or low progress if no dep)      |               |
 * | AIRBORNE approach (last 10 min to ETA, | 10 s          |
 * |   or progress ≥ ~90% if no ETA)        |               |
 * | AIRBORNE approach (last 10–20 min to   | 30 s          |
 * |   ETA, or progress ≥ ~80% if no ETA)   |               |
 * | AIRBORNE cruise                        | 3 min         |
 * | COMPLETE                               | stop          |
 */
const INACTIVE_MS = 8 * 60 * 60 * 1000;
const PREFLIGHT_FAR_MS = 15 * 60 * 1000;
const PREFLIGHT_CLOSE_MS = 3 * 60 * 1000;
const PREFLIGHT_CLOSE_WINDOW_MS = 45 * 60 * 1000;
const CLIMB_HOT_WINDOW_MS = 10 * 60 * 1000;
const CLIMB_EDGE_WINDOW_MS = 20 * 60 * 1000;
const APPROACH_HOT_WINDOW_MS = 10 * 60 * 1000;
const APPROACH_EDGE_WINDOW_MS = 20 * 60 * 1000;
const CRUISE_MS = 3 * 60 * 1000;
const AIRBORNE_HOT_MS = 10_000;
const AIRBORNE_EDGE_MS = 30_000;
const AERODATABOX_MIN_MS = 1_200;
const CLIMB_PROGRESS_HOT = 0.1;
const CLIMB_PROGRESS_EDGE = 0.2;
const APPROACH_PROGRESS_HOT = 0.9;
const APPROACH_PROGRESS_EDGE = 0.8;

export const LIVE_STATUSES: FlightStatus[] = [
  FlightStatus.BOARDING,
  FlightStatus.DEPARTED,
  FlightStatus.EN_ROUTE,
];

export const PAST_STATUSES: FlightStatus[] = [
  FlightStatus.LANDED,
  FlightStatus.CANCELLED,
  FlightStatus.DIVERTED,
];

export function isLiveStatus(status: FlightStatus) {
  return LIVE_STATUSES.includes(status);
}

export function isPastStatus(status: FlightStatus) {
  return PAST_STATUSES.includes(status);
}

export function resolvePollPhase(
  flight: Pick<PollScheduleInput, "status" | "scheduledDep" | "actualDep" | "scheduledArr">,
  now = new Date(),
): PollPhase {
  if (
    flight.status === FlightStatus.LANDED ||
    flight.status === FlightStatus.CANCELLED ||
    flight.status === FlightStatus.DIVERTED
  ) {
    return PollPhase.COMPLETE;
  }
  const scheduledDep = asDate(flight.scheduledDep);
  const actualDep = asDate(flight.actualDep);
  if (
    flight.status === FlightStatus.EN_ROUTE ||
    flight.status === FlightStatus.DEPARTED ||
    (actualDep && actualDep <= now) ||
    (scheduledDep && scheduledDep <= now)
  ) {
    return PollPhase.AIRBORNE;
  }
  const preflightMs = env.preflightWindowHours * 60 * 60 * 1000;
  if (scheduledDep && scheduledDep.getTime() - now.getTime() <= preflightMs) {
    return PollPhase.PREFLIGHT;
  }
  return PollPhase.INACTIVE;
}

type AirborneTier = "hot" | "edge" | "cruise";

function pickCloserTier(a: AirborneTier, b: AirborneTier): AirborneTier {
  if (a === "hot" || b === "hot") return "hot";
  if (a === "edge" || b === "edge") return "edge";
  return "cruise";
}

function airborneTier(flight: PollScheduleInput, now: Date): AirborneTier {
  const scheduledDep = asDate(flight.scheduledDep);
  const actualDep = asDate(flight.actualDep);
  const estimatedDep = asDate(flight.estimatedDep);
  const eta = asDate(flight.estimatedArr) ?? asDate(flight.scheduledArr);
  const origin = flight.departureAirport ?? null;
  const dest = flight.arrivalAirport ?? null;
  const current =
    flight.lastLat != null && flight.lastLon != null
      ? { lat: flight.lastLat, lon: flight.lastLon }
      : null;
  const progress = flightProgress({
    origin,
    dest,
    current,
    scheduledDep,
    scheduledArr: eta ?? asDate(flight.scheduledArr),
    actualDep,
    now,
  });
  const dep = actualDep ?? estimatedDep ?? scheduledDep;
  const msSinceDep = dep ? now.getTime() - dep.getTime() : null;
  const msToEta = eta ? eta.getTime() - now.getTime() : null;
  const hasDepElapsed = msSinceDep != null && msSinceDep >= 0;

  let climb: AirborneTier = "cruise";
  if (hasDepElapsed) {
    if (msSinceDep <= CLIMB_HOT_WINDOW_MS) climb = "hot";
    else if (msSinceDep <= CLIMB_EDGE_WINDOW_MS) climb = "edge";
  } else if (progress < CLIMB_PROGRESS_HOT) {
    climb = "hot";
  } else if (progress < CLIMB_PROGRESS_EDGE) {
    climb = "edge";
  }

  let approach: AirborneTier = "cruise";
  if (msToEta != null) {
    if (msToEta <= APPROACH_HOT_WINDOW_MS) approach = "hot";
    else if (msToEta <= APPROACH_EDGE_WINDOW_MS) approach = "edge";
  } else if (progress >= APPROACH_PROGRESS_HOT) {
    approach = "hot";
  } else if (progress >= APPROACH_PROGRESS_EDGE) {
    approach = "edge";
  }

  return pickCloserTier(climb, approach);
}

export function intervalForFlight(flight: PollScheduleInput, now = new Date()): number | null {
  const phase = resolvePollPhase(flight, now);
  return intervalForPhase(phase, flight, now);
}

export function intervalForPhase(
  phase: PollPhase,
  flight?: PollScheduleInput,
  now = new Date(),
) {
  switch (phase) {
    case PollPhase.AIRBORNE: {
      const hotMs = Math.max(AERODATABOX_MIN_MS, AIRBORNE_HOT_MS);
      const edgeMs = Math.max(AERODATABOX_MIN_MS, AIRBORNE_EDGE_MS);
      if (!flight) return hotMs;
      const tier = airborneTier(flight, now);
      if (tier === "hot") return hotMs;
      if (tier === "edge") return edgeMs;
      return CRUISE_MS;
    }
    case PollPhase.PREFLIGHT: {
      const dep = flight ? asDate(flight.scheduledDep) : null;
      if (dep && dep.getTime() - now.getTime() <= PREFLIGHT_CLOSE_WINDOW_MS) {
        return PREFLIGHT_CLOSE_MS;
      }
      return PREFLIGHT_FAR_MS;
    }
    case PollPhase.INACTIVE:
      return INACTIVE_MS;
    case PollPhase.COMPLETE:
      return null;
  }
}

export function nextPollAt(input: PollPhase | PollScheduleInput, now = new Date()) {
  const interval = typeof input === "string" ? intervalForPhase(input, undefined, now) : intervalForFlight(input, now);
  if (interval == null) return null;
  return new Date(now.getTime() + interval);
}

/** Small delay after `nextPollAt` so the client reads post-poll DB. */
export const CLIENT_POLL_SLACK_MS = 400;

export type ClientPollFlight = PollScheduleInput & { nextPollAt?: Date | string | null };

/**
 * Delay until the open page should hit `GET /api/flights/[id]/live`.
 * `due` — wait until `nextPollAt` + slack, or slack if already due.
 * `afterFetch` — if `nextPollAt` is still past, wait a full interval (no tight loop).
 */
export function msUntilNextClientPoll(
  flight: ClientPollFlight,
  now = new Date(),
  mode: "due" | "afterFetch" = "due",
): number | null {
  const interval = intervalForFlight(flight, now);
  if (interval == null) return null;
  const due = asDate(flight.nextPollAt);
  if (due) {
    const wait = due.getTime() - now.getTime() + CLIENT_POLL_SLACK_MS;
    if (wait > CLIENT_POLL_SLACK_MS) return wait;
  }
  if (mode === "afterFetch") return interval;
  return CLIENT_POLL_SLACK_MS;
}

export function statusLabel(status: FlightStatus) {
  switch (status) {
    case FlightStatus.EN_ROUTE:
      return "En Route";
    case FlightStatus.SCHEDULED:
      return "Scheduled";
    case FlightStatus.DELAYED:
      return "Delayed";
    case FlightStatus.BOARDING:
      return "Boarding";
    case FlightStatus.DEPARTED:
      return "Departed";
    case FlightStatus.LANDED:
      return "Landed";
    case FlightStatus.CANCELLED:
      return "Cancelled";
    case FlightStatus.DIVERTED:
      return "Diverted";
    default:
      return "Unknown";
  }
}

export function mapProviderStatus(raw?: string | null): FlightStatus {
  if (!raw) return FlightStatus.UNKNOWN;
  const s = raw.toLowerCase();
  if (s.includes("cancel")) return FlightStatus.CANCELLED;
  if (s.includes("divert")) return FlightStatus.DIVERTED;
  // "Approaching" contains "arriv" — check it before landed/arrived.
  if (s.includes("approach") || s.includes("taxi")) return FlightStatus.EN_ROUTE;
  if (s.includes("landed") || s === "arrived" || s.includes("arrived")) return FlightStatus.LANDED;
  if (s.includes("enroute") || s.includes("en route") || s.includes("airborne") || s.includes("active")) {
    return FlightStatus.EN_ROUTE;
  }
  if (s.includes("depart") || s.includes("takeoff") || s.includes("gate departure")) {
    return FlightStatus.DEPARTED;
  }
  if (s.includes("board")) return FlightStatus.BOARDING;
  if (s.includes("delay")) return FlightStatus.DELAYED;
  if (s.includes("schedul") || s.includes("expected") || s.includes("on time")) {
    return FlightStatus.SCHEDULED;
  }
  return FlightStatus.UNKNOWN;
}
