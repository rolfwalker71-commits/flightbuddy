import { differenceInMinutes } from "date-fns";
import type { UserFlightView } from "./flight-view";

export type ConnectionLevel = "missed" | "tight" | "ok" | "comfortable";

export type ConnectionInfo = {
  layoverMin: number;
  level: ConnectionLevel;
  fromIata: string | null;
  toIata: string | null;
};

export type TripView = {
  id: string;
  name: string | null;
  createdAt: Date;
  legs: Array<{
    id: string;
    sortOrder: number;
    userFlightId: string;
    flightId: string;
    connectionToNext: ConnectionInfo | null;
  }>;
};

function asDate(value?: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function connectionBetween(
  arriveAt: Date | string | null | undefined,
  departAt: Date | string | null | undefined,
  fromIata?: string | null,
  toIata?: string | null,
): ConnectionInfo | null {
  const arr = asDate(arriveAt);
  const dep = asDate(departAt);
  if (!arr || !dep) return null;
  const layoverMin = differenceInMinutes(dep, arr);
  let level: ConnectionLevel = "comfortable";
  if (layoverMin < 0) level = "missed";
  else if (layoverMin < 45) level = "tight";
  else if (layoverMin < 90) level = "ok";
  return {
    layoverMin,
    level,
    fromIata: fromIata ?? null,
    toIata: toIata ?? null,
  };
}

export function tripIdByFlightId(trips: TripView[]) {
  const map = new Map<string, string>();
  for (const trip of trips) {
    for (const leg of trip.legs) {
      map.set(leg.flightId, trip.id);
    }
  }
  return map;
}

export function connectionByFlightId(trips: TripView[]) {
  const map = new Map<string, ConnectionInfo>();
  for (const trip of trips) {
    for (const leg of trip.legs) {
      if (leg.connectionToNext) map.set(leg.flightId, leg.connectionToNext);
    }
  }
  return map;
}

/** Suggest pairing an upcoming flight with another that connects. */
export function suggestConnections(flights: UserFlightView[], flightId: string) {
  const current = flights.find((f) => f.flightId === flightId || f.flight.id === flightId);
  if (!current) return [];
  const arrIata = current.flight.arrivalAirport?.iata;
  const arrive = asDate(
    current.flight.actualArr ?? current.flight.estimatedArr ?? current.flight.scheduledArr,
  );
  if (!arrIata || !arrive) return [];

  return flights
    .filter((row) => {
      if (row.id === current.id) return false;
      if (row.flight.departureAirport?.iata !== arrIata) return false;
      const dep = asDate(
        row.flight.actualDep ?? row.flight.estimatedDep ?? row.flight.scheduledDep,
      );
      if (!dep) return false;
      const layover = differenceInMinutes(dep, arrive);
      return layover >= 0 && layover <= 12 * 60;
    })
    .map((row) => ({
      userFlightId: row.id,
      flightId: row.flight.id,
      flightNumber: row.flight.flightNumber,
      connection: connectionBetween(
        arrive,
        row.flight.actualDep ?? row.flight.estimatedDep ?? row.flight.scheduledDep,
        arrIata,
        row.flight.departureAirport?.iata,
      ),
    }));
}
