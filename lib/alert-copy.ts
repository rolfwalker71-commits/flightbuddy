import { FlightStatus } from "@prisma/client";
import { airportTimeZone } from "./airport-tz";
import { isLegDelayed, resolveLegTimes, type LegTimes } from "./flight-times";
import { formatAltitude, formatClock, formatSpeed, formatStand, formatTimeZoneName, statusText } from "./i18n/format";
import { t, type Locale, type Units } from "./i18n/messages";
import { displayFlightNumber } from "./utils";

export const PUSH_TITLE_MAX = 50;
export const PUSH_BODY_MAX = 150;

export type NotifyKind = "gate" | "status" | "preflight" | "gate_close" | "arrival_soon" | "generic" | "object";

export type AlertAirport = {
  iata?: string | null;
  city?: string | null;
  timezone?: string | null;
};

export type AlertFlight = {
  id: string;
  flightNumber: string;
  status: FlightStatus | string;
  scheduledDep: Date | string;
  scheduledArr?: Date | string | null;
  estimatedDep?: Date | string | null;
  estimatedArr?: Date | string | null;
  actualDep?: Date | string | null;
  actualArr?: Date | string | null;
  delayMinutes?: number | null;
  gate?: string | null;
  terminal?: string | null;
  arrivalGate?: string | null;
  arrivalTerminal?: string | null;
  departureAirport?: AlertAirport | null;
  arrivalAirport?: AlertAirport | null;
};

export type AlertCopyInput = {
  locale: Locale;
  units?: Units;
  kind: NotifyKind;
  flight: AlertFlight;
  status?: FlightStatus | string | null;
  gate?: string | null;
  terminal?: string | null;
  delayMinutes?: number | null;
};

export type AlertCopy = {
  title: string;
  body: string;
  event: string;
  persistKind: string;
  flightId: string;
  url: string;
};

const STATUS_KIND: Record<string, FlightStatus> = {
  landed: FlightStatus.LANDED,
  departed: FlightStatus.DEPARTED,
  delayed: FlightStatus.DELAYED,
  boarding: FlightStatus.BOARDING,
  en_route: FlightStatus.EN_ROUTE,
  cancelled: FlightStatus.CANCELLED,
  diverted: FlightStatus.DIVERTED,
};

export function persistAlertKind(kind: NotifyKind, status?: FlightStatus | string | null): string {
  if (kind !== "status") return kind;
  switch (status) {
    case FlightStatus.LANDED:
    case "LANDED":
      return "landed";
    case FlightStatus.DEPARTED:
    case "DEPARTED":
      return "departed";
    case FlightStatus.DELAYED:
    case "DELAYED":
      return "delayed";
    case FlightStatus.BOARDING:
    case "BOARDING":
      return "boarding";
    case FlightStatus.EN_ROUTE:
    case "EN_ROUTE":
      return "en_route";
    case FlightStatus.CANCELLED:
    case "CANCELLED":
      return "cancelled";
    case FlightStatus.DIVERTED:
    case "DIVERTED":
      return "diverted";
    default:
      return "status";
  }
}

export function asFlightStatus(value?: string | null): FlightStatus {
  if (!value) return FlightStatus.UNKNOWN;
  if ((Object.values(FlightStatus) as string[]).includes(value)) return value as FlightStatus;
  return FlightStatus.UNKNOWN;
}

export function alertEventLabel(
  locale: Locale,
  kind: string,
  status?: string | null,
  delayMinutes?: number | null,
): string {
  if (kind === "preflight") return t(locale, "alerts.eventPreflight");
  if (kind === "gate_close") return t(locale, "alerts.eventGateClose");
  if (kind === "arrival_soon") return t(locale, "alerts.eventArrivalSoon");
  if (kind === "gate") return t(locale, "alerts.eventGate");
  if (kind === "object_airborne") return t(locale, "alerts.eventObjectAirborne");
  if (kind === "object_landed") return t(locale, "alerts.eventObjectLanded");
  const fromKind = STATUS_KIND[kind];
  return statusText(fromKind ?? asFlightStatus(status), locale, delayMinutes);
}

export function alertRole(kind: string, status?: string | null): "dep" | "arr" {
  if (kind === "landed" || kind === "arrival_soon") return "arr";
  if (kind === "status" || kind === "generic") {
    if (status === FlightStatus.LANDED || status === "LANDED") return "arr";
  }
  return "dep";
}

export function clampPushText(text: string, max: number) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return "…";
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function joinDot(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

export function alertRouteIata(flight: AlertFlight) {
  const from = flight.departureAirport?.iata ?? null;
  const to = flight.arrivalAirport?.iata ?? null;
  if (!from && !to) return null;
  return { from, to };
}

export function alertRouteLine(flight: AlertFlight) {
  const route = alertRouteIata(flight);
  if (!route) return null;
  if (route.from && route.to) return `${route.from} → ${route.to}`;
  return route.from ?? route.to;
}

function resolveStatus(input: AlertCopyInput) {
  return input.status ?? input.flight.status;
}

function resolveDelay(input: AlertCopyInput) {
  return input.delayMinutes ?? input.flight.delayMinutes ?? null;
}

export function alertLeg(
  flight: AlertFlight,
  kind: string,
  status?: string | null,
  gate?: string | null,
  terminal?: string | null,
): {
  role: "dep" | "arr";
  times: LegTimes;
  zone: string | null;
  gate: string | null;
  terminal: string | null;
} {
  const role = alertRole(kind, status);
  const times =
    role === "arr"
      ? resolveLegTimes(flight.scheduledArr, flight.estimatedArr, flight.actualArr)
      : resolveLegTimes(flight.scheduledDep, flight.estimatedDep, flight.actualDep);
  const airport = role === "arr" ? flight.arrivalAirport : flight.departureAirport;
  const resolvedGate = role === "arr" ? (flight.arrivalGate ?? null) : (gate ?? flight.gate ?? null);
  const resolvedTerminal =
    role === "arr" ? (flight.arrivalTerminal ?? null) : (terminal ?? flight.terminal ?? null);
  return {
    role,
    times,
    zone: airportTimeZone(airport?.iata, airport?.timezone),
    gate: resolvedGate,
    terminal: resolvedTerminal,
  };
}

function pushTimePart(locale: Locale, units: Units, times: LegTimes, zone: string | null) {
  const planned = times.planned ? formatClock(times.planned, units, zone) : null;
  const effective = times.effective ? formatClock(times.effective, units, zone) : null;
  if (times.differ && planned && effective) {
    return t(locale, "push.effectivePlanned", { effective, planned });
  }
  if (planned) return t(locale, "push.plannedTime", { time: planned });
  if (effective) return t(locale, "push.effectiveTime", { time: effective });
  return null;
}

export function buildAlertCopy(input: AlertCopyInput): AlertCopy {
  const locale = input.locale;
  const units = input.units ?? "metric";
  const status = resolveStatus(input);
  const delayMinutes = resolveDelay(input);
  const persistKind = persistAlertKind(input.kind, status);
  const code = displayFlightNumber(input.flight.flightNumber);
  const event = alertEventLabel(locale, persistKind, String(status), delayMinutes);
  const title =
    input.kind === "preflight"
      ? t(locale, "push.preflightTitle", { code })
      : input.kind === "gate_close"
        ? t(locale, "push.gateCloseTitle", { code })
        : input.kind === "arrival_soon"
          ? t(locale, "push.arrivalSoonTitle", { code })
          : input.kind === "gate"
            ? t(locale, "push.gateTitle", { code })
            : t(locale, "push.statusTitle", { code, status: event });

  const leg = alertLeg(input.flight, persistKind, String(status), input.gate, input.terminal);
  const stand =
    input.kind === "preflight" || input.kind === "gate" || input.kind === "gate_close"
      ? formatStand(locale, leg.gate, leg.terminal)
      : null;
  const times = pushTimePart(locale, units, leg.times, leg.zone);
  let body = joinDot([alertRouteLine(input.flight), times, stand]);

  if (!body && input.kind === "preflight") {
    body = t(locale, "push.preflightFallback");
  } else if (!body && input.kind === "gate_close") {
    body = t(locale, "push.gateCloseFallback");
  } else if (!body && input.kind === "arrival_soon") {
    body = t(locale, "push.arrivalSoonFallback");
  } else if (!body && persistKind === "delayed" && delayMinutes) {
    body = t(locale, "push.delayedBody", { n: delayMinutes });
  }

  return {
    title: clampPushText(title, PUSH_TITLE_MAX),
    body: clampPushText(body, PUSH_BODY_MAX),
    event,
    persistKind,
    flightId: input.flight.id,
    url: `/flights/${input.flight.id}`,
  };
}

export type AlertCardModel = {
  code: string;
  event: string;
  eventKind: string;
  fromIata: string | null;
  toIata: string | null;
  fromCity: string | null;
  toCity: string | null;
  planned: Date | null;
  plannedClock: string | null;
  plannedZone: string | null;
  effective: Date | null;
  effectiveClock: string | null;
  showEffective: boolean;
  delayed: boolean;
  stand: string | null;
};

export function alertCardModel(
  flight: AlertFlight,
  kind: string,
  locale: Locale,
  units: Units,
): AlertCardModel {
  const eventKind =
    kind === "preflight" ||
    kind === "gate" ||
    kind === "gate_close" ||
    kind === "arrival_soon" ||
    Boolean(STATUS_KIND[kind])
      ? kind
      : persistAlertKind("status", flight.status);
  const event = alertEventLabel(locale, eventKind, String(flight.status), flight.delayMinutes);
  const leg = alertLeg(flight, eventKind, String(flight.status));
  const plannedClock = leg.times.planned ? formatClock(leg.times.planned, units, leg.zone) : null;
  const effectiveClock = leg.times.effective ? formatClock(leg.times.effective, units, leg.zone) : null;
  return {
    code: displayFlightNumber(flight.flightNumber),
    event,
    eventKind,
    fromIata: flight.departureAirport?.iata ?? null,
    toIata: flight.arrivalAirport?.iata ?? null,
    fromCity: flight.departureAirport?.city ?? null,
    toCity: flight.arrivalAirport?.city ?? null,
    planned: leg.times.planned,
    plannedClock,
    plannedZone: leg.times.planned ? formatTimeZoneName(leg.times.planned, leg.zone, locale) : null,
    effective: leg.times.effective,
    effectiveClock,
    showEffective: Boolean(leg.times.differ && leg.times.planned && leg.times.effective),
    delayed: isLegDelayed(leg.times, String(flight.status)),
    stand: formatStand(locale, leg.gate, leg.terminal),
  };
}

export function buildObjectAlertCopy(opts: {
  locale: Locale;
  units?: Units;
  phase: "airborne" | "landed";
  callsign: string;
  altitudeFt?: number | null;
  speedKts?: number | null;
}): AlertCopy {
  const locale = opts.locale;
  const title =
    opts.phase === "airborne"
      ? t(locale, "push.objectAirborneTitle", { callsign: opts.callsign })
      : t(locale, "push.objectLandedTitle", { callsign: opts.callsign });
  const units = opts.units ?? "metric";
  const alt = formatAltitude(opts.altitudeFt, locale, units);
  const speed = formatSpeed(opts.speedKts, locale, units);
  const body = joinDot([alt !== "—" ? alt : null, speed !== "—" ? speed : null]);
  const persistKind = opts.phase === "airborne" ? "object_airborne" : "object_landed";
  return {
    title: clampPushText(title, PUSH_TITLE_MAX),
    body: clampPushText(body, PUSH_BODY_MAX),
    event: alertEventLabel(locale, persistKind),
    persistKind,
    flightId: "",
    url: "/map",
  };
}

export function eventBadgeVariant(
  kind: string,
): "live" | "success" | "warning" | "destructive" | "default" {
  if (
    kind === "preflight" ||
    kind === "gate_close" ||
    kind === "departed" ||
    kind === "en_route" ||
    kind === "object_airborne"
  )
    return "live";
  if (kind === "landed" || kind === "boarding" || kind === "arrival_soon" || kind === "object_landed")
    return "success";
  if (kind === "delayed") return "warning";
  if (kind === "cancelled" || kind === "diverted") return "destructive";
  return "default";
}
