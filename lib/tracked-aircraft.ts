import { prisma } from "./db";
import { objectLabel, resolveOperator } from "./operator";
import { fetchOpenSkyByIcao24s, openSkyToTelemetry } from "./opensky";
import { notifyUsers } from "./push";
import { buildObjectAlertCopy } from "./alert-copy";
import type {
  TrackedAircraftHistory,
  TrackedAircraftInput,
  TrackedAircraftView,
} from "./tracked-aircraft-types";

export type {
  TrackedAircraftEventView,
  TrackedAircraftHistory,
  TrackedAircraftInput,
  TrackedAircraftView,
} from "./tracked-aircraft-types";
export { displayTrackedCallsign } from "./tracked-aircraft-types";

const ABSENT_RESET_MS = 15 * 60 * 1000;
const AIRBORNE_DEBOUNCE_MS = 10 * 60 * 1000;

export function normalizeIcao24(value: string) {
  return value.replace(/[^a-f0-9]/gi, "").toLowerCase();
}

export function toTrackedView(row: {
  id: string;
  icao24: string;
  callsign: string;
  operator: string | null;
  airlineIata: string | null;
  createdAt: Date;
  starts?: number;
  landings?: number;
  lastEventAt?: Date | null;
}): TrackedAircraftView {
  return {
    id: row.id,
    icao24: row.icao24,
    callsign: row.callsign,
    operator: row.operator,
    airlineIata: row.airlineIata,
    createdAt: row.createdAt,
    starts: row.starts,
    landings: row.landings,
    lastEventAt: row.lastEventAt,
  };
}

export async function listTrackedAircraft(userId: string): Promise<TrackedAircraftView[]> {
  const rows = await prisma.trackedAircraft.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      events: { select: { phase: true, recordedAt: true }, orderBy: { recordedAt: "desc" } },
    },
  });
  return rows.map((row) =>
    toTrackedView({
      ...row,
      starts: row.events.filter((e) => e.phase === "airborne").length,
      landings: row.events.filter((e) => e.phase === "landed").length,
      lastEventAt: row.events[0]?.recordedAt ?? null,
    }),
  );
}

export async function getTrackedAircraftHistory(
  userId: string,
  id: string,
  take = 50,
): Promise<TrackedAircraftHistory | null> {
  const row = await prisma.trackedAircraft.findFirst({
    where: { id, userId },
    include: {
      events: { orderBy: { recordedAt: "desc" }, take },
    },
  });
  if (!row) return null;
  const starts = await prisma.trackedAircraftEvent.count({
    where: { trackedAircraftId: row.id, phase: "airborne" },
  });
  const landings = await prisma.trackedAircraftEvent.count({
    where: { trackedAircraftId: row.id, phase: "landed" },
  });
  return {
    aircraft: toTrackedView({
      ...row,
      starts,
      landings,
      lastEventAt: row.events[0]?.recordedAt ?? null,
    }),
    events: row.events.map((e) => ({
      id: e.id,
      phase: e.phase,
      callsign: e.callsign,
      altitudeFt: e.altitudeFt,
      velocityKts: e.velocityKts,
      lat: e.lat,
      lon: e.lon,
      recordedAt: e.recordedAt,
    })),
    stats: { starts, landings },
  };
}

async function recordObjectEvent(opts: {
  trackedAircraftId: string;
  phase: "airborne" | "landed";
  callsign: string;
  altitudeFt?: number | null;
  velocityKts?: number | null;
  lat?: number | null;
  lon?: number | null;
}) {
  await prisma.trackedAircraftEvent.create({
    data: {
      trackedAircraftId: opts.trackedAircraftId,
      phase: opts.phase,
      callsign: opts.callsign,
      altitudeFt: opts.altitudeFt ?? null,
      velocityKts: opts.velocityKts ?? null,
      lat: opts.lat ?? null,
      lon: opts.lon ?? null,
    },
  });
}

export async function saveTrackedAircraft(userId: string, input: TrackedAircraftInput) {
  const icao24 = normalizeIcao24(input.icao24);
  if (icao24.length !== 6) throw new Error("Invalid icao24");
  const callsign = objectLabel(input.callsign, icao24);
  const resolved = resolveOperator({
    callsign,
    airlineName: input.operator,
    airlineIata: input.airlineIata,
  });
  const row = await prisma.trackedAircraft.upsert({
    where: { userId_icao24: { userId, icao24 } },
    create: {
      userId,
      icao24,
      callsign,
      operator: resolved.operator,
      airlineIata: resolved.airlineIata,
    },
    update: {
      callsign,
      operator: resolved.operator,
      airlineIata: resolved.airlineIata,
    },
  });
  return toTrackedView(row);
}

export async function untrackAircraft(userId: string, id: string) {
  const row = await prisma.trackedAircraft.findFirst({ where: { id, userId } });
  if (!row) return null;
  await prisma.trackedAircraft.delete({ where: { id: row.id } });
  return toTrackedView(row);
}

export async function pollTrackedAircraft() {
  const rows = await prisma.trackedAircraft.findMany();
  if (!rows.length) return { polled: 0, notified: 0 };

  const icaos = [...new Set(rows.map((row) => row.icao24))];
  const result = await fetchOpenSkyByIcao24s(icaos);
  if (result.gated) return { polled: 0, notified: 0, retryAfterMs: result.retryAfterMs };

  const byIcao = new Map(result.states.map((state) => [state.icao24.toLowerCase(), state]));
  const now = new Date();
  let notified = 0;

  for (const row of rows) {
    const state = byIcao.get(row.icao24);
    if (!state) {
      if (row.lastOnGround === false && row.lastSeenAt && now.getTime() - row.lastSeenAt.getTime() > ABSENT_RESET_MS) {
        await prisma.trackedAircraft.update({
          where: { id: row.id },
          data: { lastOnGround: null },
        });
      }
      continue;
    }

    const tel = openSkyToTelemetry(state);
    const callsign = objectLabel(state.callsign, row.callsign || row.icao24);
    const resolved = resolveOperator({
      callsign,
      airlineName: row.operator,
      airlineIata: row.airlineIata,
    });
    const airborne = !tel.onGround;

    if (airborne) {
      const wasGroundOrUnknown = row.lastOnGround !== false;
      const debounce =
        row.lastAirborneAt != null && now.getTime() - row.lastAirborneAt.getTime() < AIRBORNE_DEBOUNCE_MS;
      await prisma.trackedAircraft.update({
        where: { id: row.id },
        data: {
          callsign,
          operator: resolved.operator,
          airlineIata: resolved.airlineIata,
          lastOnGround: false,
          lastSeenAt: now,
          lastAirborneAt: now,
        },
      });
      if (wasGroundOrUnknown && !debounce) {
        await recordObjectEvent({
          trackedAircraftId: row.id,
          phase: "airborne",
          callsign,
          altitudeFt: tel.altitudeFt,
          velocityKts: tel.velocityKts,
          lat: tel.lat,
          lon: tel.lon,
        });
        await notifyUsers({
          userIds: [row.userId],
          kind: "object",
          build: (locale, units) => {
            const copy = buildObjectAlertCopy({
              locale,
              units,
              phase: "airborne",
              callsign,
              altitudeFt: tel.altitudeFt,
              speedKts: tel.velocityKts,
            });
            return { title: copy.title, body: copy.body, kind: copy.persistKind, url: copy.url };
          },
        });
        notified += 1;
      }
      continue;
    }

    const wasAirborne = row.lastOnGround === false;
    await prisma.trackedAircraft.update({
      where: { id: row.id },
      data: {
        callsign,
        operator: resolved.operator,
        airlineIata: resolved.airlineIata,
        lastOnGround: true,
        lastSeenAt: now,
      },
    });
    if (wasAirborne) {
      await recordObjectEvent({
        trackedAircraftId: row.id,
        phase: "landed",
        callsign,
        altitudeFt: tel.altitudeFt,
        velocityKts: tel.velocityKts,
        lat: tel.lat,
        lon: tel.lon,
      });
      await notifyUsers({
        userIds: [row.userId],
        kind: "object",
        build: (locale, units) => {
          const copy = buildObjectAlertCopy({
            locale,
            units,
            phase: "landed",
            callsign,
            altitudeFt: tel.altitudeFt,
            speedKts: tel.velocityKts,
          });
          return { title: copy.title, body: copy.body, kind: copy.persistKind, url: copy.url };
        },
      });
      notified += 1;
    }
  }

  return { polled: icaos.length, notified };
}
