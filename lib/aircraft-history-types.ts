import type { FlightStatus } from "@prisma/client";

export type AircraftHistoryReason =
  | "ok"
  | "no_identity"
  | "unconfigured"
  | "rate_limited"
  | "monthly_quota"
  | "not_subscribed"
  | "http_error"
  | "network_error"
  | "empty";

export type AircraftSectorView = {
  flightNumber: string;
  fromIata: string | null;
  toIata: string | null;
  fromName: string | null;
  toName: string | null;
  fromTimezone: string | null;
  toTimezone: string | null;
  scheduledDep: string | null;
  scheduledArr: string | null;
  estimatedDep: string | null;
  estimatedArr: string | null;
  actualDep: string | null;
  actualArr: string | null;
  status: FlightStatus;
  isCurrent: boolean;
  isInbound: boolean;
};

export type AircraftHistoryPayload = {
  registration: string | null;
  icao24: string | null;
  aircraftType: string | null;
  inbound: AircraftSectorView | null;
  sectors: AircraftSectorView[];
  reason: AircraftHistoryReason;
};

export function hasAircraftIdentity(opts: {
  registration?: string | null;
  icao24?: string | null;
}) {
  return Boolean(opts.registration?.trim() || opts.icao24?.trim());
}
