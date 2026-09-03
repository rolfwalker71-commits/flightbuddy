import { FlightStatus, PollPhase } from "@prisma/client";
import { isPrismaUnknownArgError, prisma, safeFlightUpdate } from "./db";
import { notifyUsers } from "./push";
import { lookupAeroLiveTelemetry, pickAeroForScheduledDep, searchAeroDataBox } from "./aerodatabox";
import { candidateCallsigns, fetchOpenSkyStates, openSkyToTelemetry } from "./opensky";
import { fetchFr24LivePosition } from "./fr24";
import { LIVE_FIX_STALE_MS } from "./flight-interpolate";
import {
  isTerminalStatus,
  mergeAeroFlightStatus,
  nextPollAt,
  resolvePollPhase,
  statusAfterGroundFix,
  type PollScheduleInput,
} from "./flight-status";
import { getUserFlight } from "./flights";
import { scheduleFlightPoll, scheduleUserFlightReminders } from "./queue";
import { env } from "./env";
import { shouldAlertEmergencySquawk } from "./squawk";

type LiveFix = {
  lat: number;
  lon: number;
  altitudeFt?: number | null;
  velocityKts?: number | null;
  heading?: number | null;
  onGround?: boolean;
  icao24?: string | null;
  callsign?: string | null;
  squawk?: string | null;
  source: string;
  observedAt?: Date;
};

async function persistIdentity(
  flightId: string,
  data: {
    icao24?: string | null;
    callsign?: string | null;
    aircraftType?: string | null;
    registration?: string | null;
  },
) {
  const patch: { icao24?: string; callsign?: string; aircraftType?: string; registration?: string } = {};
  if (data.icao24) patch.icao24 = data.icao24;
  if (data.callsign) patch.callsign = data.callsign;
  if (data.aircraftType) patch.aircraftType = data.aircraftType;
  if (data.registration) patch.registration = data.registration;
  if (!Object.keys(patch).length) return;
  await safeFlightUpdate(flightId, patch);
}

async function persistLiveFix(flightId: string, fix: LiveFix) {
  const observedAt = fix.observedAt && !Number.isNaN(fix.observedAt.getTime()) ? fix.observedAt : new Date();
  await prisma.flightPosition.create({
    data: {
      flightId,
      lat: fix.lat,
      lon: fix.lon,
      altitudeFt: fix.altitudeFt ?? null,
      velocityKts: fix.velocityKts ?? null,
      heading: fix.heading ?? null,
      onGround: fix.onGround ?? false,
      source: fix.source,
      recordedAt: observedAt,
    },
  });
  await safeFlightUpdate(flightId, {
    icao24: fix.icao24 ?? undefined,
    callsign: fix.callsign ?? undefined,
    lastLat: fix.lat,
    lastLon: fix.lon,
    lastAltitudeFt: fix.altitudeFt ?? null,
    lastVelocityKts: fix.velocityKts ?? null,
    lastHeading: fix.heading ?? null,
    lastOnGround: fix.onGround ?? false,
    lastPositionAt: observedAt,
    ...(fix.squawk !== undefined ? { lastSquawk: fix.squawk } : {}),
  });
}

async function resolveArrivalAirport(iata?: string | null) {
  if (!iata) return null;
  return prisma.airport.findUnique({ where: { iata } });
}

export async function pollFlight(flightId: string) {
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: {
      departureAirport: true,
      arrivalAirport: true,
      airline: true,
      userFlights: true,
    },
  });
  if (!flight) return;
  const row = flight;

  const prev = {
    status: row.status,
    gate: row.gate,
    delayMinutes: row.delayMinutes,
    arrivalIata: row.arrivalAirport?.iata ?? null,
  };

  const phase = resolvePollPhase(row);
  let nextStatus = row.status;
  let nextGate = row.gate;
  let nextDelay = row.delayMinutes;
  let estimatedDep = row.estimatedDep;
  let estimatedArr = row.estimatedArr;
  let actualDep = row.actualDep;
  let actualArr = row.actualArr;
  let terminal = row.terminal;
  let arrivalGate = row.arrivalGate;
  let arrivalTerminal = row.arrivalTerminal;
  let aircraftType = row.aircraftType;
  let registration = row.registration;
  let lastStatusSource = row.lastStatusSource;
  let nextSquawk = row.lastSquawk ?? null;
  let squawkAlertCode: string | null = null;
  let nextArrivalAirportId = row.arrivalAirportId;
  let arrivalAirport = row.arrivalAirport;
  let destinationChanged = false;
  let lastOnGround = row.lastOnGround ?? false;

  async function applyArrivalIata(iata?: string | null) {
    if (!iata || iata === (arrivalAirport?.iata ?? null)) return;
    const airport = await resolveArrivalAirport(iata);
    if (!airport) return;
    destinationChanged = true;
    nextArrivalAirportId = airport.id;
    arrivalAirport = airport;
    row.arrivalAirport = airport;
  }

  if (phase === PollPhase.INACTIVE || phase === PollPhase.PREFLIGHT || phase === PollPhase.AIRBORNE) {
    const aero = await searchAeroDataBox(row.flightNumber, row.scheduledDep);
    const match = pickAeroForScheduledDep(aero, row.scheduledDep, {
      fromIata: row.departureAirport?.iata,
      toIata: prev.arrivalIata,
    });
    if (match) {
      await applyArrivalIata(match.toIata);
      actualArr = match.actualArr ? new Date(match.actualArr) : actualArr;
      nextStatus = mergeAeroFlightStatus({
        current: nextStatus,
        aeroStatus: match.status,
        destinationChanged: Boolean(
          match.toIata && prev.arrivalIata && match.toIata !== prev.arrivalIata,
        ),
        actualArr,
      });
      nextGate = match.gate ?? nextGate;
      nextDelay = match.delayMinutes ?? nextDelay;
      estimatedDep = match.estimatedDep ? new Date(match.estimatedDep) : estimatedDep;
      estimatedArr = match.estimatedArr ? new Date(match.estimatedArr) : estimatedArr;
      actualDep = match.actualDep ? new Date(match.actualDep) : actualDep;
      if (match.scheduledArr && !row.scheduledArr) {
        row.scheduledArr = new Date(match.scheduledArr);
      }
      terminal = match.terminal ?? terminal;
      arrivalGate = match.arrivalGate ?? arrivalGate;
      arrivalTerminal = match.arrivalTerminal ?? arrivalTerminal;
      aircraftType = match.aircraftType ?? aircraftType;
      registration = match.registration ?? registration;
      lastStatusSource = "aerodatabox";
      await persistIdentity(row.id, {
        icao24: match.icao24,
        callsign: match.callsign,
        aircraftType: match.aircraftType,
        registration: match.registration,
      });
      if (match.icao24) row.icao24 = match.icao24;
      if (match.callsign) row.callsign = match.callsign;
    }
  }

  const airborneNow = resolvePollPhase({
    ...row,
    status: nextStatus,
    actualDep,
  });

  if (airborneNow === PollPhase.AIRBORNE) {
    let gotFix = false;
    // OpenSky is gated by OPENSKY_MIN_INTERVAL_MS (default 90s). On cooldown
    // fetchOpenSkyStates returns null; AeroDataBox location is the fallback.
    const state = await fetchOpenSkyStates({
      icao24: row.icao24,
      origin: row.departureAirport,
      dest: arrivalAirport,
      current:
        row.lastLat != null && row.lastLon != null
          ? { lat: row.lastLat, lon: row.lastLon }
          : null,
      callsigns: candidateCallsigns({
        flightNumber: row.flightNumber,
        airlineIata: row.airlineIata,
        airlineIcao: row.airlineIcao ?? row.airline?.icao,
      }),
    });
    if (state?.lat != null && state.lon != null) {
      const tel = openSkyToTelemetry(state);
      lastOnGround = tel.onGround;
      nextStatus = tel.onGround ? statusAfterGroundFix(nextStatus) : tel.status;
      lastStatusSource = "opensky";
      gotFix = true;
      if (tel.squawk) {
        if (shouldAlertEmergencySquawk(row.lastSquawk, tel.squawk)) {
          squawkAlertCode = tel.squawk;
        }
        nextSquawk = tel.squawk;
      }
      await persistLiveFix(row.id, {
        lat: state.lat,
        lon: state.lon,
        altitudeFt: tel.altitudeFt,
        velocityKts: tel.velocityKts,
        heading: tel.heading,
        onGround: tel.onGround,
        icao24: tel.icao24,
        callsign: tel.callsign,
        squawk: tel.squawk,
        source: "opensky",
      });
      row.lastLat = state.lat;
      row.lastLon = state.lon;
      if (tel.squawk) row.lastSquawk = tel.squawk;
    } else {
      if (state?.icao24) {
        await persistIdentity(row.id, { icao24: state.icao24, callsign: state.callsign });
        row.icao24 = state.icao24;
      }
      if (state?.squawk) {
        if (shouldAlertEmergencySquawk(row.lastSquawk, state.squawk)) {
          squawkAlertCode = state.squawk;
        }
        nextSquawk = state.squawk;
        await safeFlightUpdate(row.id, { lastSquawk: state.squawk });
        row.lastSquawk = state.squawk;
      }
      const aero = await lookupAeroLiveTelemetry(row.flightNumber, row.scheduledDep, {
        fromIata: row.departureAirport?.iata,
        toIata: prev.arrivalIata,
      });
      if (aero) {
        await persistIdentity(row.id, aero);
        if (aero.icao24) row.icao24 = aero.icao24;
        if (aero.registration) registration = aero.registration;
        if (aero.gate) nextGate = aero.gate;
        if (aero.terminal) terminal = aero.terminal;
        if (aero.arrivalGate) arrivalGate = aero.arrivalGate;
        if (aero.arrivalTerminal) arrivalTerminal = aero.arrivalTerminal;
        if (aero.estimatedDep) estimatedDep = new Date(aero.estimatedDep);
        if (aero.estimatedArr) estimatedArr = new Date(aero.estimatedArr);
        if (aero.actualDep) actualDep = new Date(aero.actualDep);
        if (aero.actualArr) actualArr = new Date(aero.actualArr);
        if (aero.delayMinutes != null) nextDelay = aero.delayMinutes;
        if (aero.scheduledArr && !row.scheduledArr) {
          row.scheduledArr = new Date(aero.scheduledArr);
        }
        await applyArrivalIata(aero.toIata);
        if (aero.status) {
          nextStatus = mergeAeroFlightStatus({
            current: nextStatus,
            aeroStatus: aero.status,
            destinationChanged: Boolean(
              aero.toIata && prev.arrivalIata && aero.toIata !== prev.arrivalIata,
            ),
            actualArr,
          });
        }
        if (aero.lat != null && aero.lon != null) {
          // Location without onGround — do not resurrect terminal statuses.
          if (!isTerminalStatus(nextStatus)) {
            nextStatus = FlightStatus.EN_ROUTE;
          }
          lastStatusSource = "aerodatabox";
          gotFix = true;
          await persistLiveFix(row.id, {
            lat: aero.lat,
            lon: aero.lon,
            altitudeFt: aero.altitudeFt,
            velocityKts: aero.velocityKts,
            heading: aero.heading,
            onGround: false,
            icao24: aero.icao24,
            callsign: aero.callsign,
            source: "aerodatabox",
          });
          row.lastLat = aero.lat;
          row.lastLon = aero.lon;
        }
      }
    }
    if (!gotFix) {
      const lastAt = row.lastPositionAt;
      const lastAgeMs = lastAt ? Date.now() - lastAt.getTime() : null;
      const lastFresh = lastAgeMs != null && lastAgeMs >= 0 && lastAgeMs <= LIVE_FIX_STALE_MS;
      if (!lastFresh) {
        const fr24 = await fetchFr24LivePosition({
          flightId: row.id,
          icao24: row.icao24,
          callsign: row.callsign,
          flightNumber: row.flightNumber,
          registration,
          lastLat: row.lastLat,
          lastLon: row.lastLon,
        });
        if (fr24) {
          lastOnGround = fr24.onGround;
          nextStatus = fr24.onGround ? statusAfterGroundFix(nextStatus) : FlightStatus.EN_ROUTE;
          lastStatusSource = "fr24";
          gotFix = true;
          await persistLiveFix(row.id, {
            lat: fr24.lat,
            lon: fr24.lon,
            altitudeFt: fr24.altitudeFt,
            velocityKts: fr24.velocityKts,
            heading: fr24.heading,
            onGround: fr24.onGround,
            icao24: fr24.icao24,
            callsign: fr24.callsign,
            source: "fr24",
            observedAt: fr24.observedAt,
          });
          row.lastLat = fr24.lat;
          row.lastLon = fr24.lon;
          row.lastPositionAt = fr24.observedAt;
        }
      }
    }

    // Landed evidence from schedule/ADS-B even when a stale airborne fix exists.
    if (!isTerminalStatus(nextStatus)) {
      const now = new Date();
      if (actualArr && actualArr.getTime() <= now.getTime()) {
        nextStatus = destinationChanged ? FlightStatus.DIVERTED : FlightStatus.LANDED;
      } else if (lastOnGround) {
        nextStatus = statusAfterGroundFix(nextStatus);
      } else if (!gotFix) {
        const eta = actualArr ?? estimatedArr ?? row.scheduledArr;
        if (eta && eta < now) nextStatus = FlightStatus.LANDED;
      }
    }

    // Alternate airport + on ground / arrived → diverted (not plain landed).
    if (
      destinationChanged &&
      (nextStatus === FlightStatus.LANDED || lastOnGround || (actualArr && actualArr <= new Date()))
    ) {
      nextStatus = FlightStatus.DIVERTED;
    }
  }

  const schedule: PollScheduleInput = {
    status: nextStatus,
    scheduledDep: row.scheduledDep,
    actualDep,
    estimatedDep,
    scheduledArr: estimatedArr ?? row.scheduledArr,
    estimatedArr,
    lastLat: row.lastLat,
    lastLon: row.lastLon,
    lastPositionAt: row.lastPositionAt,
    actualArr,
    departureAirport: row.departureAirport,
    arrivalAirport,
  };
  const finalPhase = resolvePollPhase(schedule);
  const nextAt = nextPollAt(schedule);

  await safeFlightUpdate(row.id, {
    status: nextStatus,
    gate: nextGate,
    delayMinutes: nextDelay,
    scheduledArr: row.scheduledArr,
    estimatedDep,
    estimatedArr,
    actualDep,
    actualArr,
    terminal,
    arrivalGate,
    arrivalTerminal,
    aircraftType,
    registration,
    lastStatusSource,
    lastSquawk: nextSquawk,
    pollPhase: finalPhase,
    nextPollAt: nextAt,
    ...(nextArrivalAirportId !== row.arrivalAirportId
      ? { arrivalAirportId: nextArrivalAirportId }
      : {}),
  });

  const userIds = row.userFlights.filter((uf) => uf.pushAlerts).map((uf) => uf.userId);
  const flightForAlert = {
    ...row,
    status: nextStatus,
    gate: nextGate,
    terminal,
    arrivalGate,
    arrivalTerminal,
    delayMinutes: nextDelay,
    estimatedDep,
    estimatedArr,
    actualDep,
    actualArr,
    arrivalAirport,
  };

  if (nextGate && nextGate !== prev.gate && userIds.length) {
    await notifyUsers({
      userIds,
      kind: "gate",
      flight: flightForAlert,
      gate: nextGate,
      terminal,
    });
  }

  if (destinationChanged && userIds.length && nextStatus !== FlightStatus.CANCELLED) {
    await notifyUsers({
      userIds,
      kind: "status",
      flight: flightForAlert,
      status: FlightStatus.DIVERTED,
      delayMinutes: nextDelay,
    });
  } else if (nextStatus !== prev.status && userIds.length) {
    await notifyUsers({
      userIds,
      kind: "status",
      flight: flightForAlert,
      status: nextStatus,
      delayMinutes: nextDelay,
    });
  }

  if (squawkAlertCode && userIds.length) {
    await notifyUsers({
      userIds,
      kind: "squawk",
      flight: flightForAlert,
      squawk: squawkAlertCode,
    });
  }

  const timesChanged =
    estimatedDep?.getTime() !== row.estimatedDep?.getTime() ||
    estimatedArr?.getTime() !== row.estimatedArr?.getTime() ||
    actualDep?.getTime() !== row.actualDep?.getTime() ||
    actualArr?.getTime() !== row.actualArr?.getTime();
  if (timesChanged && finalPhase !== PollPhase.COMPLETE) {
    for (const uf of row.userFlights) {
      await scheduleUserFlightReminders({
        userFlightId: uf.id,
        flightId: row.id,
        userId: uf.userId,
        scheduledDep: row.scheduledDep,
        scheduledArr: row.scheduledArr,
        estimatedDep,
        estimatedArr,
        actualDep,
        actualArr,
        preflightWindowHours: env.preflightWindowHours,
      });
    }
  }

  if (finalPhase !== PollPhase.COMPLETE && nextAt) {
    await scheduleFlightPoll(row.id, nextAt);
  }

  if (finalPhase === PollPhase.COMPLETE && row.userFlights.some((uf) => uf.trackDaily)) {
    const { advanceRecurringFlights } = await import("./recurrence");
    const seen = new Set<string>();
    for (const uf of row.userFlights) {
      if (!uf.trackDaily || seen.has(uf.userId)) continue;
      seen.add(uf.userId);
      await advanceRecurringFlights({
        userId: uf.userId,
        flightNumber: row.flightNumber,
        fromIata: row.departureAirport?.iata ?? null,
        toIata: arrivalAirport?.iata ?? null,
      });
    }
  }
}

/** Detail-page / local-dev: fetch ADS-B now if the airborne poll is due. */
export async function refreshLiveTelemetry(flightId: string) {
  const flight = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!flight) return;
  const phase = resolvePollPhase(flight);
  if (phase !== PollPhase.AIRBORNE) return;
  const due = !flight.nextPollAt || flight.nextPollAt.getTime() <= Date.now();
  const neverSeen = !flight.lastPositionAt && !flight.icao24;
  if (!due && !neverSeen) return;
  try {
    await pollFlight(flightId);
  } catch (err) {
    if (isPrismaUnknownArgError(err)) return;
    throw err;
  }
}

/** Same path as the flight detail page: refresh if due, then return latest row. */
export async function loadLiveUserFlight(userId: string, flightId: string) {
  const existing = await getUserFlight(userId, flightId);
  if (!existing) return null;
  try {
    await refreshLiveTelemetry(existing.flight.id);
  } catch {
    // Live refresh is best-effort; a stale Prisma client must not 500 this page.
  }
  return (await getUserFlight(userId, flightId)) ?? existing;
}
