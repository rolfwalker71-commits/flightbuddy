import { addDays, format, parseISO, subDays } from "date-fns";
import { prisma } from "./db";
import { airportTimeZone, originCalendarDay } from "./airport-tz";
import { lookupAeroByAircraft, type AeroFlight, type AeroSearchReason } from "./aerodatabox";
import { getUserFlight } from "./flights";
import {
  collapseCodeshares,
  compareSectorsByStart,
  isCurrentHistorySector,
  pickInboundSector,
  reconcileHistoryStatuses,
  type CurrentHistoryFlight,
} from "./aircraft-history-logic";
import {
  hasAircraftIdentity,
  type AircraftHistoryPayload,
  type AircraftSectorView,
} from "./aircraft-history-types";

export type { AircraftHistoryPayload, AircraftHistoryReason, AircraftSectorView } from "./aircraft-history-types";
export { hasAircraftIdentity };
export {
  collapseCodeshares,
  compareSectorsByStart,
  isCurrentHistorySector,
  isSameSector,
  pickInboundSector,
  reconcileHistoryStatuses,
  sectorStartMs,
} from "./aircraft-history-logic";
export { originCalendarDay } from "./airport-tz";

function toIso(value?: string | null) {
  return value ?? null;
}

function parseMs(value?: Date | string | null) {
  if (!value) return null;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(t) ? t : null;
}

async function viewSectors(
  sectors: AeroFlight[],
  current: CurrentHistoryFlight,
  inbound: AeroFlight | null,
): Promise<AircraftSectorView[]> {
  const iatas = [
    ...new Set(
      sectors.flatMap((s) => [s.fromIata, s.toIata]).filter((code): code is string => Boolean(code)),
    ),
  ];
  const airports = iatas.length
    ? await prisma.airport.findMany({
        where: { iata: { in: iatas } },
        select: { iata: true, timezone: true, city: true, name: true },
      })
    : [];
  const byIata = new Map(airports.map((a) => [a.iata, a]));

  return sectors.map((s) => {
    const from = s.fromIata ? byIata.get(s.fromIata) : undefined;
    const to = s.toIata ? byIata.get(s.toIata) : undefined;
    return {
      flightNumber: s.flightNumber,
      fromIata: s.fromIata ?? null,
      toIata: s.toIata ?? null,
      fromName: s.fromName ?? from?.city ?? from?.name ?? null,
      toName: s.toName ?? to?.city ?? to?.name ?? null,
      fromTimezone: airportTimeZone(s.fromIata, from?.timezone),
      toTimezone: airportTimeZone(s.toIata, to?.timezone),
      scheduledDep: toIso(s.scheduledDep),
      scheduledArr: toIso(s.scheduledArr),
      estimatedDep: toIso(s.estimatedDep),
      estimatedArr: toIso(s.estimatedArr),
      actualDep: toIso(s.actualDep),
      actualArr: toIso(s.actualArr),
      status: s.status,
      isCurrent: isCurrentHistorySector(s, current),
      isInbound: inbound != null && s === inbound,
    };
  });
}

export async function getAircraftHistory(
  userId: string,
  flightId: string,
): Promise<{ status: 404 } | { status: 200; payload: AircraftHistoryPayload }> {
  const row = await getUserFlight(userId, flightId);
  if (!row) return { status: 404 };
  const { flight } = row;

  const registration = flight.registration?.trim() || null;
  const icao24 = flight.icao24?.trim() || null;
  const aircraftType = flight.aircraftType?.trim() || null;
  const identity = { registration, icao24, aircraftType };

  if (!hasAircraftIdentity(identity)) {
    return {
      status: 200,
      payload: { ...identity, inbound: null, sectors: [], reason: "no_identity" },
    };
  }

  const originZone = airportTimeZone(flight.departureAirport?.iata, flight.departureAirport?.timezone);
  const originDay = originCalendarDay(flight.scheduledDep, originZone);
  const originDate = parseISO(originDay);
  const fromDay = format(subDays(originDate, 1), "yyyy-MM-dd");
  const toDay = format(addDays(originDate, 1), "yyyy-MM-dd");

  const aero = await lookupAeroByAircraft({
    registration,
    icao24,
    fromDay,
    toDay,
    priority: "user",
  });

  if (aero.reason !== "ok") {
    return {
      status: 200,
      payload: {
        ...identity,
        inbound: null,
        sectors: [],
        reason: aero.reason as Exclude<AeroSearchReason, "ok">,
      },
    };
  }

  const departureMs =
    parseMs(flight.actualDep ?? flight.estimatedDep ?? flight.scheduledDep) ??
    flight.scheduledDep.getTime();
  const current: CurrentHistoryFlight = {
    flightNumber: flight.flightNumber,
    fromIata: flight.departureAirport?.iata ?? null,
    toIata: flight.arrivalAirport?.iata ?? null,
    scheduledDep: flight.scheduledDep,
    scheduledArr: flight.scheduledArr,
    estimatedDep: flight.estimatedDep,
    estimatedArr: flight.estimatedArr,
    actualDep: flight.actualDep,
    actualArr: flight.actualArr,
    departureMs,
    status: flight.status,
  };

  const sectors = reconcileHistoryStatuses(collapseCodeshares(aero.flights), current);
  const inboundRaw = pickInboundSector(sectors, current);
  const timeline = [...sectors].sort(compareSectorsByStart);
  const views = await viewSectors(timeline, current, inboundRaw);

  return {
    status: 200,
    payload: {
      ...identity,
      inbound: views.find((sector) => sector.isInbound) ?? null,
      sectors: views,
      reason: "ok",
    },
  };
}
