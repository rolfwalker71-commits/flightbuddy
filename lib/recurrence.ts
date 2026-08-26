import { FlightStatus } from "@prisma/client";
import { lookupAeroDataBox, type AeroFlight } from "./aerodatabox";
import { airportTimeZone, originCalendarDay, shiftCalendarDay } from "./airport-tz";
import { clientModelFieldNames, persistUserFlightTrackDaily, prisma } from "./db";
import { saveUserFlight, type FlightSearchResult } from "./flights";

/**
 * Daily tracking timezone rule
 * --------------------------------
 * “Today” is the origin airport’s calendar day (IANA zone of the last known
 * departure airport). Missing/invalid zone → UTC, same as display clocks.
 * We also resolve tomorrow in that same zone so a late-evening job still
 * links the next official instance before the origin date rolls.
 *
 * A new Flight row is created only when AeroDataBox returns a real instance
 * for that origin-local day (scheduledDep + route). Nothing is invented.
 * Unique key stays [flightNumber, scheduledDep]; recurrence means “also
 * follow later days’ same number + typical route”.
 */

const LOOKAHEAD_DAYS = 1;

type SeriesMember = {
  userId: string;
  seat: string | null;
  pushAlerts: boolean;
  knownDays: Set<string>;
};

type Series = {
  flightNumber: string;
  fromIata: string | null;
  toIata: string | null;
  originTimeZone: string | null;
  users: Map<string, SeriesMember>;
};

function recurrenceSupported() {
  const fields = clientModelFieldNames("UserFlight");
  return !fields || fields.has("trackDaily");
}

function seriesKey(flightNumber: string, fromIata: string | null, toIata: string | null) {
  return `${flightNumber}|${fromIata ?? ""}|${toIata ?? ""}`;
}

function dateAtUtcNoon(ymd: string) {
  return new Date(`${ymd}T12:00:00.000Z`);
}

export function pickOfficialDailyInstance(
  flights: AeroFlight[],
  opts: {
    targetDay: string;
    originTimeZone?: string | null;
    fromIata?: string | null;
    toIata?: string | null;
  },
): AeroFlight | undefined {
  const wantFrom = opts.fromIata ?? null;
  const wantTo = opts.toIata ?? null;
  const requireRoute = Boolean(wantFrom || wantTo);

  const onDay = flights.filter((flight) => {
    if (!flight.scheduledDep) return false;
    if (!flight.fromIata && !flight.toIata) return false;
    const day = originCalendarDay(new Date(flight.scheduledDep), opts.originTimeZone);
    return day === opts.targetDay;
  });

  if (requireRoute) {
    const exact = onDay.filter((flight) => {
      if (wantFrom && flight.fromIata !== wantFrom) return false;
      if (wantTo && flight.toIata !== wantTo) return false;
      return true;
    });
    exact.sort((a, b) => (a.scheduledDep ?? "").localeCompare(b.scheduledDep ?? ""));
    return exact[0];
  }

  onDay.sort((a, b) => (a.scheduledDep ?? "").localeCompare(b.scheduledDep ?? ""));
  return onDay[0];
}

function toSearchResult(flight: AeroFlight): FlightSearchResult | null {
  const scheduledDep = flight.scheduledDep ?? flight.estimatedDep ?? flight.actualDep;
  const flightNumber = flight.flightNumber?.replace(/\s+/g, "");
  if (!scheduledDep || !flightNumber) return null;
  if (!flight.fromIata && !flight.toIata) return null;
  return {
    flightNumber,
    airlineName: flight.airlineName,
    airlineIata: flight.airlineIata,
    airlineIcao: flight.airlineIcao,
    fromIata: flight.fromIata,
    toIata: flight.toIata,
    fromCity: flight.fromName,
    toCity: flight.toName,
    scheduledDep,
    scheduledArr: flight.scheduledArr ?? flight.estimatedArr ?? flight.actualArr,
    estimatedDep: flight.estimatedDep,
    estimatedArr: flight.estimatedArr,
    actualDep: flight.actualDep,
    actualArr: flight.actualArr,
    status: flight.status === FlightStatus.UNKNOWN ? FlightStatus.SCHEDULED : flight.status,
    gate: flight.gate,
    terminal: flight.terminal,
    arrivalGate: flight.arrivalGate,
    arrivalTerminal: flight.arrivalTerminal,
    aircraftType: flight.aircraftType,
    registration: flight.registration,
    icao24: flight.icao24,
    callsign: flight.callsign,
    source: "aerodatabox",
  };
}

async function loadSeries(filter?: {
  userId?: string;
  flightNumber?: string;
  fromIata?: string | null;
  toIata?: string | null;
}): Promise<Series[]> {
  if (!recurrenceSupported()) return [];

  const rows = await prisma.userFlight.findMany({
    where: {
      trackDaily: true,
      ...(filter?.userId ? { userId: filter.userId } : {}),
      ...(filter?.flightNumber
        ? {
            flight: {
              flightNumber: filter.flightNumber,
              ...(filter.fromIata ? { departureAirport: { iata: filter.fromIata } } : {}),
              ...(filter.toIata ? { arrivalAirport: { iata: filter.toIata } } : {}),
            },
          }
        : {}),
    },
    include: {
      flight: {
        include: { departureAirport: true, arrivalAirport: true },
      },
    },
  });

  const byKey = new Map<string, Series>();
  for (const row of rows) {
    const flightNumber = row.flight.flightNumber.replace(/\s+/g, "").toUpperCase();
    const fromIata = row.flight.departureAirport?.iata ?? null;
    const toIata = row.flight.arrivalAirport?.iata ?? null;
    const key = seriesKey(flightNumber, fromIata, toIata);
    let series = byKey.get(key);
    if (!series) {
      series = {
        flightNumber,
        fromIata,
        toIata,
        originTimeZone: airportTimeZone(
          row.flight.departureAirport?.iata,
          row.flight.departureAirport?.timezone,
        ),
        users: new Map(),
      };
      byKey.set(key, series);
    }
    let member = series.users.get(row.userId);
    if (!member) {
      member = {
        userId: row.userId,
        seat: row.seat,
        pushAlerts: row.pushAlerts,
        knownDays: new Set(),
      };
      series.users.set(row.userId, member);
    }
    member.knownDays.add(originCalendarDay(row.flight.scheduledDep, series.originTimeZone));
  }
  return [...byKey.values()];
}

async function linkOfficialDay(series: Series, targetDay: string) {
  const missing = [...series.users.values()].filter((user) => !user.knownDays.has(targetDay));
  if (!missing.length) return;

  const aero = await lookupAeroDataBox(series.flightNumber, dateAtUtcNoon(targetDay), {
    priority: "poll",
  });
  if (aero.reason !== "ok") return;

  const match = pickOfficialDailyInstance(aero.flights, {
    targetDay,
    originTimeZone: series.originTimeZone,
    fromIata: series.fromIata,
    toIata: series.toIata,
  });
  const result = match ? toSearchResult(match) : null;
  if (!result) return;

  for (const user of missing) {
    await saveUserFlight({
      userId: user.userId,
      result,
      seat: user.seat ?? undefined,
      pushAlerts: user.pushAlerts,
      trackDaily: true,
    });
    user.knownDays.add(targetDay);
  }
}

export async function advanceRecurringFlights(filter?: {
  userId?: string;
  flightNumber?: string;
  fromIata?: string | null;
  toIata?: string | null;
}) {
  const seriesList = await loadSeries(filter);
  const now = new Date();

  for (const series of seriesList) {
    const today = originCalendarDay(now, series.originTimeZone);
    for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset++) {
      const day = shiftCalendarDay(today, offset);
      try {
        await linkOfficialDay(series, day);
      } catch (err) {
        console.error("[recurrence] failed", series.flightNumber, day, err);
      }
    }
  }
}

/** Turn daily tracking on/off for this number + typical route (all of the user's instances). */
export async function setTrackDaily(userId: string, flightId: string, trackDaily: boolean) {
  const row = await prisma.userFlight.findFirst({
    where: { userId, flightId },
    include: {
      flight: { include: { departureAirport: true, arrivalAirport: true } },
    },
  });
  if (!row) return null;

  const flightNumber = row.flight.flightNumber;
  const fromIata = row.flight.departureAirport?.iata ?? null;
  const toIata = row.flight.arrivalAirport?.iata ?? null;

  const siblings = await prisma.userFlight.findMany({
    where: {
      userId,
      flight: {
        flightNumber,
        ...(fromIata ? { departureAirport: { iata: fromIata } } : {}),
        ...(toIata ? { arrivalAirport: { iata: toIata } } : {}),
      },
    },
    select: { id: true },
  });

  const ids = siblings.length ? siblings.map((item) => item.id) : [row.id];
  await persistUserFlightTrackDaily(ids, trackDaily);

  if (trackDaily && recurrenceSupported()) {
    await advanceRecurringFlights({ userId, flightNumber, fromIata, toIata });
  }
  return { ok: true as const, trackDaily };
}
