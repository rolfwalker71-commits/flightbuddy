import { FlightStatus, PollPhase } from "@prisma/client";
import { isPrismaUnknownArgError, prisma, safeFlightUpdate } from "./db";
import { notifyUsers } from "./push";
import { lookupAeroLiveTelemetry, pickAeroForScheduledDep, searchAeroDataBox } from "./aerodatabox";
import { candidateCallsigns, fetchOpenSkyStates, openSkyToTelemetry } from "./opensky";
import { fetchFr24LivePosition } from "./fr24";
import { LIVE_FIX_STALE_MS } from "./flight-interpolate";
import { nextPollAt, resolvePollPhase, type PollScheduleInput } from "./flight-status";
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

  const prev = {
    status: flight.status,
    gate: flight.gate,
    delayMinutes: flight.delayMinutes,
  };

  const phase = resolvePollPhase(flight);
  let nextStatus = flight.status;
  let nextGate = flight.gate;
  let nextDelay = flight.delayMinutes;
  let estimatedDep = flight.estimatedDep;
  let estimatedArr = flight.estimatedArr;
  let actualDep = flight.actualDep;
  let actualArr = flight.actualArr;
  let terminal = flight.terminal;
  let arrivalGate = flight.arrivalGate;
  let arrivalTerminal = flight.arrivalTerminal;
  let aircraftType = flight.aircraftType;
  let registration = flight.registration;
  let lastStatusSource = flight.lastStatusSource;
  let nextSquawk = flight.lastSquawk ?? null;
  let squawkAlertCode: string | null = null;

  if (phase === PollPhase.INACTIVE || phase === PollPhase.PREFLIGHT || phase === PollPhase.AIRBORNE) {
    const aero = await searchAeroDataBox(flight.flightNumber, flight.scheduledDep);
    const match = pickAeroForScheduledDep(aero, flight.scheduledDep, {
      fromIata: flight.departureAirport?.iata,
      toIata: flight.arrivalAirport?.iata,
    });
    if (match) {
      if (match.status !== FlightStatus.UNKNOWN) nextStatus = match.status;
      nextGate = match.gate ?? nextGate;
      nextDelay = match.delayMinutes ?? nextDelay;
      estimatedDep = match.estimatedDep ? new Date(match.estimatedDep) : estimatedDep;
      estimatedArr = match.estimatedArr ? new Date(match.estimatedArr) : estimatedArr;
      actualDep = match.actualDep ? new Date(match.actualDep) : actualDep;
      actualArr = match.actualArr ? new Date(match.actualArr) : actualArr;
      if (match.scheduledArr && !flight.scheduledArr) {
        flight.scheduledArr = new Date(match.scheduledArr);
      }
      terminal = match.terminal ?? terminal;
      arrivalGate = match.arrivalGate ?? arrivalGate;
      arrivalTerminal = match.arrivalTerminal ?? arrivalTerminal;
      aircraftType = match.aircraftType ?? aircraftType;
      registration = match.registration ?? registration;
      lastStatusSource = "aerodatabox";
      await persistIdentity(flight.id, {
        icao24: match.icao24,
        callsign: match.callsign,
        aircraftType: match.aircraftType,
        registration: match.registration,
      });
      if (match.icao24) flight.icao24 = match.icao24;
      if (match.callsign) flight.callsign = match.callsign;
    }
  }

  const airborneNow = resolvePollPhase({
    ...flight,
    status: nextStatus,
    actualDep,
  });

  if (airborneNow === PollPhase.AIRBORNE) {
    let gotFix = false;
    // OpenSky is gated by OPENSKY_MIN_INTERVAL_MS (default 90s). On cooldown
    // fetchOpenSkyStates returns null; AeroDataBox location is the fallback.
    const state = await fetchOpenSkyStates({
      icao24: flight.icao24,
      origin: flight.departureAirport,
      dest: flight.arrivalAirport,
      current:
        flight.lastLat != null && flight.lastLon != null
          ? { lat: flight.lastLat, lon: flight.lastLon }
          : null,
      callsigns: candidateCallsigns({
        flightNumber: flight.flightNumber,
        airlineIata: flight.airlineIata,
        airlineIcao: flight.airlineIcao ?? flight.airline?.icao,
      }),
    });
    if (state?.lat != null && state.lon != null) {
      const tel = openSkyToTelemetry(state);
      nextStatus = tel.onGround && nextStatus === FlightStatus.EN_ROUTE
        ? FlightStatus.LANDED
        : tel.status;
      lastStatusSource = "opensky";
      gotFix = true;
      if (tel.squawk) {
        if (shouldAlertEmergencySquawk(flight.lastSquawk, tel.squawk)) {
          squawkAlertCode = tel.squawk;
        }
        nextSquawk = tel.squawk;
      }
      await persistLiveFix(flight.id, {
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
      flight.lastLat = state.lat;
      flight.lastLon = state.lon;
      if (tel.squawk) flight.lastSquawk = tel.squawk;
    } else {
      if (state?.icao24) {
        await persistIdentity(flight.id, { icao24: state.icao24, callsign: state.callsign });
        flight.icao24 = state.icao24;
      }
      if (state?.squawk) {
        if (shouldAlertEmergencySquawk(flight.lastSquawk, state.squawk)) {
          squawkAlertCode = state.squawk;
        }
        nextSquawk = state.squawk;
        await safeFlightUpdate(flight.id, { lastSquawk: state.squawk });
        flight.lastSquawk = state.squawk;
      }
      const aero = await lookupAeroLiveTelemetry(flight.flightNumber, flight.scheduledDep, {
        fromIata: flight.departureAirport?.iata,
        toIata: flight.arrivalAirport?.iata,
      });
      if (aero) {
        await persistIdentity(flight.id, aero);
        if (aero.icao24) flight.icao24 = aero.icao24;
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
        if (aero.scheduledArr && !flight.scheduledArr) {
          flight.scheduledArr = new Date(aero.scheduledArr);
        }
        if (aero.lat != null && aero.lon != null) {
          nextStatus = FlightStatus.EN_ROUTE;
          lastStatusSource = "aerodatabox";
          gotFix = true;
          await persistLiveFix(flight.id, {
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
          flight.lastLat = aero.lat;
          flight.lastLon = aero.lon;
        }
      }
    }
    if (!gotFix) {
      const lastAt = flight.lastPositionAt;
      const lastAgeMs = lastAt ? Date.now() - lastAt.getTime() : null;
      const lastFresh = lastAgeMs != null && lastAgeMs >= 0 && lastAgeMs <= LIVE_FIX_STALE_MS;
      if (!lastFresh) {
        const fr24 = await fetchFr24LivePosition({
          flightId: flight.id,
          icao24: flight.icao24,
          callsign: flight.callsign,
          flightNumber: flight.flightNumber,
          registration,
          lastLat: flight.lastLat,
          lastLon: flight.lastLon,
        });
        if (fr24) {
          nextStatus =
            fr24.onGround && nextStatus === FlightStatus.EN_ROUTE
              ? FlightStatus.LANDED
              : FlightStatus.EN_ROUTE;
          lastStatusSource = "fr24";
          gotFix = true;
          await persistLiveFix(flight.id, {
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
          flight.lastLat = fr24.lat;
          flight.lastLon = fr24.lon;
          flight.lastPositionAt = fr24.observedAt;
        }
      }
    }
    if (
      !gotFix &&
      nextStatus !== FlightStatus.LANDED &&
      nextStatus !== FlightStatus.CANCELLED &&
      nextStatus !== FlightStatus.DIVERTED
    ) {
      const eta = actualArr ?? estimatedArr ?? flight.scheduledArr;
      if (eta && eta < new Date()) {
        nextStatus = FlightStatus.LANDED;
      }
    }
  }

  const schedule: PollScheduleInput = {
    status: nextStatus,
    scheduledDep: flight.scheduledDep,
    actualDep,
    estimatedDep,
    scheduledArr: estimatedArr ?? flight.scheduledArr,
    estimatedArr,
    lastLat: flight.lastLat,
    lastLon: flight.lastLon,
    lastPositionAt: flight.lastPositionAt,
    actualArr,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
  };
  const finalPhase = resolvePollPhase(schedule);
  const nextAt = nextPollAt(schedule);

  await safeFlightUpdate(flight.id, {
    status: nextStatus,
    gate: nextGate,
    delayMinutes: nextDelay,
    scheduledArr: flight.scheduledArr,
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
  });

  const userIds = flight.userFlights.filter((uf) => uf.pushAlerts).map((uf) => uf.userId);
  const flightForAlert = {
    ...flight,
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

  if (nextStatus !== prev.status && userIds.length) {
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
    estimatedDep?.getTime() !== flight.estimatedDep?.getTime() ||
    estimatedArr?.getTime() !== flight.estimatedArr?.getTime() ||
    actualDep?.getTime() !== flight.actualDep?.getTime() ||
    actualArr?.getTime() !== flight.actualArr?.getTime();
  if (timesChanged && finalPhase !== PollPhase.COMPLETE) {
    for (const uf of flight.userFlights) {
      await scheduleUserFlightReminders({
        userFlightId: uf.id,
        flightId: flight.id,
        userId: uf.userId,
        scheduledDep: flight.scheduledDep,
        scheduledArr: flight.scheduledArr,
        estimatedDep,
        estimatedArr,
        actualDep,
        actualArr,
        preflightWindowHours: env.preflightWindowHours,
      });
    }
  }

  if (finalPhase !== PollPhase.COMPLETE && nextAt) {
    await scheduleFlightPoll(flight.id, nextAt);
  }

  if (finalPhase === PollPhase.COMPLETE && flight.userFlights.some((uf) => uf.trackDaily)) {
    const { advanceRecurringFlights } = await import("./recurrence");
    const seen = new Set<string>();
    for (const uf of flight.userFlights) {
      if (!uf.trackDaily || seen.has(uf.userId)) continue;
      seen.add(uf.userId);
      await advanceRecurringFlights({
        userId: uf.userId,
        flightNumber: flight.flightNumber,
        fromIata: flight.departureAirport?.iata ?? null,
        toIata: flight.arrivalAirport?.iata ?? null,
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
