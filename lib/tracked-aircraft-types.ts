import { displayCallsign } from "./callsign";

export type TrackedAircraftView = {
  id: string;
  icao24: string;
  callsign: string;
  operator: string | null;
  airlineIata: string | null;
  createdAt: Date;
  starts?: number;
  landings?: number;
  lastEventAt?: Date | null;
};

export type TrackedAircraftEventView = {
  id: string;
  phase: "airborne" | "landed" | string;
  callsign: string | null;
  altitudeFt: number | null;
  velocityKts: number | null;
  lat: number | null;
  lon: number | null;
  recordedAt: Date;
};

export type TrackedAircraftHistory = {
  aircraft: TrackedAircraftView;
  events: TrackedAircraftEventView[];
  stats: { starts: number; landings: number };
};

export type TrackedAircraftInput = {
  icao24: string;
  callsign?: string | null;
  operator?: string | null;
  airlineIata?: string | null;
};

export function displayTrackedCallsign(row: Pick<TrackedAircraftView, "callsign" | "icao24">) {
  return displayCallsign(row.callsign, row.icao24.slice(0, 6).toUpperCase());
}
