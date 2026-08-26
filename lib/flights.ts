import { parseISO } from "date-fns";
import { FlightStatus, PollPhase } from "@prisma/client";
import { hydrateTrackDaily, persistUserFlightTrackDaily, pickKnownModelData, prisma } from "./db";
import { lookupAeroDataBox } from "./aerodatabox";
import { parseFlightQuery } from "./utils";
import { nextPollAt, resolvePollPhase } from "./flight-status";
import { cancelFlightPoll, cancelPreflightReminder, scheduleFlightPoll, schedulePreflightReminder } from "./queue";
import { env } from "./env";
import { airportTimeZone } from "./airport-tz";

export type FlightSearchEmptyReason =
  | "unknown_query"
  | "unconfigured"
  | "rate_limited"
  | "api_error"
  | "not_found";

export type FlightSearchResult = {
  flightNumber: string;
  airlineName?: string | null;
  airlineIata?: string | null;
  airlineIcao?: string | null;
  fromIata?: string | null;
  toIata?: string | null;
  fromCity?: string | null;
  toCity?: string | null;
  scheduledDep?: string | null;
  scheduledArr?: string | null;
  estimatedDep?: string | null;
  estimatedArr?: string | null;
  actualDep?: string | null;
  actualArr?: string | null;
  fromTimezone?: string | null;
  toTimezone?: string | null;
  status: FlightStatus;
  gate?: string | null;
  terminal?: string | null;
  arrivalGate?: string | null;
  arrivalTerminal?: string | null;
  aircraftType?: string | null;
  registration?: string | null;
  icao24?: string | null;
  callsign?: string | null;
  source: "aerodatabox" | "local";
  timesEstimated?: boolean;
};

export type FlightSearchPayload = {
  results: FlightSearchResult[];
  emptyReason?: FlightSearchEmptyReason;
};

function empty(reason: FlightSearchEmptyReason): FlightSearchPayload {
  return { results: [], emptyReason: reason };
}

export async function searchFlights(query: string, date: Date): Promise<FlightSearchPayload> {
  const parsed = parseFlightQuery(query);
  if (parsed.kind === "unknown") return empty("unknown_query");

  if (parsed.kind === "flight") {
    const aero = await lookupAeroDataBox(parsed.flightNumber, date, { priority: "user" });
    if (aero.reason === "unconfigured") return empty("unconfigured");
    if (aero.reason === "rate_limited") return empty("rate_limited");
    if (aero.reason === "http_error" || aero.reason === "network_error") {
      return empty("api_error");
    }

    const official = aero.flights
      .filter((f) => (f.scheduledDep || f.estimatedDep || f.actualDep) && (f.fromIata || f.toIata))
      .map((f) => ({
        flightNumber: f.flightNumber || parsed.flightNumber,
        airlineName: f.airlineName,
        airlineIata: f.airlineIata ?? parsed.airline,
        airlineIcao: f.airlineIcao,
        fromIata: f.fromIata,
        toIata: f.toIata,
        fromCity: f.fromName,
        toCity: f.toName,
        scheduledDep: f.scheduledDep ?? f.estimatedDep ?? f.actualDep,
        scheduledArr: f.scheduledArr ?? f.estimatedArr ?? f.actualArr,
        estimatedDep: f.estimatedDep,
        estimatedArr: f.estimatedArr,
        actualDep: f.actualDep,
        actualArr: f.actualArr,
        fromTimezone: null as string | null,
        toTimezone: null as string | null,
        status: f.status === FlightStatus.UNKNOWN ? FlightStatus.SCHEDULED : f.status,
        gate: f.gate,
        terminal: f.terminal,
        arrivalGate: f.arrivalGate,
        arrivalTerminal: f.arrivalTerminal,
        aircraftType: f.aircraftType,
        registration: f.registration,
        icao24: f.icao24,
        callsign: f.callsign,
        source: "aerodatabox" as const,
      }));

    const iatas = [
      ...new Set(
        official.flatMap((f) => [f.fromIata, f.toIata]).filter((code): code is string => Boolean(code)),
      ),
    ];
    if (iatas.length) {
      const airports = await prisma.airport.findMany({
        where: { iata: { in: iatas } },
        select: { iata: true, timezone: true },
      });
      const tzByIata = new Map(airports.map((a) => [a.iata, a.timezone]));
      for (const row of official) {
        row.fromTimezone = airportTimeZone(row.fromIata, tzByIata.get(row.fromIata ?? "") ?? null);
        row.toTimezone = airportTimeZone(row.toIata, tzByIata.get(row.toIata ?? "") ?? null);
      }
    }

    const live = new Set<FlightStatus>([
      FlightStatus.EN_ROUTE,
      FlightStatus.DEPARTED,
      FlightStatus.BOARDING,
    ]);
    official.sort((a, b) => {
      const rank = (s: FlightStatus) => (live.has(s) ? 0 : 1);
      const byLive = rank(a.status) - rank(b.status);
      if (byLive !== 0) return byLive;
      return (b.scheduledDep ?? "").localeCompare(a.scheduledDep ?? "");
    });

    return official.length ? { results: official } : empty("not_found");
  }

  const from = await prisma.airport.findUnique({ where: { iata: parsed.from } });
  const to = await prisma.airport.findUnique({ where: { iata: parsed.to } });
  if (!from || !to) return empty("not_found");

  const route = await prisma.route.findFirst({
    where: { fromIata: parsed.from, toIata: parsed.to },
  });
  const airline = route?.airlineIata
    ? await prisma.airline.findUnique({ where: { iata: route.airlineIata } })
    : null;

  return {
    results: [
      {
        flightNumber: "",
        airlineName: airline?.name,
        airlineIata: airline?.iata,
        airlineIcao: airline?.icao,
        fromIata: from.iata,
        toIata: to.iata,
        fromCity: from.city,
        toCity: to.city,
        fromTimezone: airportTimeZone(from.iata, from.timezone),
        toTimezone: airportTimeZone(to.iata, to.timezone),
        status: FlightStatus.UNKNOWN,
        source: "local",
        timesEstimated: true,
      },
    ],
  };
}

export async function saveUserFlight(opts: {
  userId: string;
  result: FlightSearchResult;
  seat?: string;
  pushAlerts?: boolean;
  trackDaily?: boolean;
}) {
  if (!opts.result.scheduledDep || !opts.result.flightNumber.trim()) {
    throw new Error("Flight number and departure time are required");
  }
  const dep = parseISO(opts.result.scheduledDep);
  const arr = opts.result.scheduledArr ? parseISO(opts.result.scheduledArr) : null;
  const estimatedDep = opts.result.estimatedDep ? parseISO(opts.result.estimatedDep) : null;
  const estimatedArr = opts.result.estimatedArr ? parseISO(opts.result.estimatedArr) : null;
  const actualDep = opts.result.actualDep ? parseISO(opts.result.actualDep) : null;
  const actualArr = opts.result.actualArr ? parseISO(opts.result.actualArr) : null;
  const airline = opts.result.airlineIata
    ? await prisma.airline.findUnique({ where: { iata: opts.result.airlineIata } })
    : opts.result.airlineIcao
      ? await prisma.airline.findUnique({ where: { icao: opts.result.airlineIcao } })
      : null;
  const from = opts.result.fromIata
    ? await prisma.airport.findUnique({ where: { iata: opts.result.fromIata } })
    : null;
  const to = opts.result.toIata
    ? await prisma.airport.findUnique({ where: { iata: opts.result.toIata } })
    : null;

  const phase = resolvePollPhase({
    status: opts.result.status,
    scheduledDep: dep,
    actualDep: null,
    scheduledArr: arr,
  });
  const dueAt =
    phase === PollPhase.AIRBORNE
      ? new Date()
      : nextPollAt({
          status: opts.result.status,
          scheduledDep: dep,
          actualDep,
          estimatedDep,
          scheduledArr: arr,
          estimatedArr,
        });

  const flight = await prisma.flight.upsert({
    where: {
      flightNumber_scheduledDep: {
        flightNumber: opts.result.flightNumber.replace(/\s+/g, ""),
        scheduledDep: dep,
      },
    },
    update: {
      status: opts.result.status,
      gate: opts.result.gate,
      terminal: opts.result.terminal,
      arrivalGate: opts.result.arrivalGate,
      arrivalTerminal: opts.result.arrivalTerminal,
      aircraftType: opts.result.aircraftType,
      registration: opts.result.registration,
      icao24: opts.result.icao24 ?? undefined,
      callsign: opts.result.callsign ?? undefined,
      airlineId: airline?.id,
      airlineIata: airline?.iata ?? opts.result.airlineIata,
      airlineIcao: airline?.icao ?? opts.result.airlineIcao,
      departureAirportId: from?.id,
      arrivalAirportId: to?.id,
      scheduledArr: arr,
      estimatedDep: estimatedDep ?? undefined,
      estimatedArr: estimatedArr ?? undefined,
      actualDep: actualDep ?? undefined,
      actualArr: actualArr ?? undefined,
      pollPhase: phase,
      nextPollAt: dueAt,
    },
    create: {
      flightNumber: opts.result.flightNumber.replace(/\s+/g, ""),
      status: opts.result.status,
      gate: opts.result.gate,
      terminal: opts.result.terminal,
      arrivalGate: opts.result.arrivalGate,
      arrivalTerminal: opts.result.arrivalTerminal,
      aircraftType: opts.result.aircraftType,
      registration: opts.result.registration,
      icao24: opts.result.icao24 ?? undefined,
      callsign: opts.result.callsign ?? undefined,
      airlineId: airline?.id,
      airlineIata: airline?.iata ?? opts.result.airlineIata,
      airlineIcao: airline?.icao ?? opts.result.airlineIcao,
      departureAirportId: from?.id,
      arrivalAirportId: to?.id,
      scheduledDep: dep,
      scheduledArr: arr,
      estimatedDep,
      estimatedArr,
      actualDep,
      actualArr,
      pollPhase: phase,
      nextPollAt: dueAt,
    },
  });

  const userFlightData = pickKnownModelData("UserFlight", {
    seat: opts.seat,
    pushAlerts: opts.pushAlerts,
    trackDaily: opts.trackDaily,
  });
  const userFlight = await prisma.userFlight.upsert({
    where: { userId_flightId: { userId: opts.userId, flightId: flight.id } },
    update: userFlightData,
    create: {
      userId: opts.userId,
      flightId: flight.id,
      ...userFlightData,
    },
  });
  if (opts.trackDaily != null) {
    await persistUserFlightTrackDaily([userFlight.id], opts.trackDaily);
  }

  await scheduleFlightPoll(flight.id, flight.nextPollAt);
  await schedulePreflightReminder({
    userFlightId: userFlight.id,
    flightId: flight.id,
    userId: opts.userId,
    runAt: new Date(dep.getTime() - env.preflightWindowHours * 60 * 60 * 1000),
  });

  return { flight, userFlight };
}

export const flightInclude = {
  airline: true,
  departureAirport: true,
  arrivalAirport: true,
  positions: { orderBy: { recordedAt: "desc" as const }, take: 80 },
} as const;

export async function getUserFlights(userId: string) {
  const rows = await prisma.userFlight.findMany({
    where: { userId },
    include: { flight: { include: flightInclude } },
    orderBy: { flight: { scheduledDep: "asc" } },
  });
  return hydrateTrackDaily(rows);
}

export async function getUserFlight(userId: string, flightId: string) {
  const row = await prisma.userFlight.findFirst({
    where: { userId, flightId },
    include: { flight: { include: flightInclude } },
  });
  if (!row) return null;
  const [hydrated] = await hydrateTrackDaily([row]);
  return hydrated;
}

export async function untrackUserFlight(userId: string, flightId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.userFlight.findFirst({
      where: { userId, flightId },
    });
    if (!row) return null;

    await tx.userFlight.delete({ where: { id: row.id } });
    await tx.notification.deleteMany({ where: { userId, flightId } });

    const remaining = await tx.userFlight.count({ where: { flightId } });
    let flightDeleted = false;
    if (remaining === 0) {
      await tx.notification.deleteMany({ where: { flightId } });
      await tx.flight.delete({ where: { id: flightId } });
      flightDeleted = true;
    }

    return { userFlightId: row.id, flightDeleted };
  });

  if (!result) return null;
  await cancelPreflightReminder(result.userFlightId);
  if (result.flightDeleted) await cancelFlightPoll(flightId);
  return result;
}
