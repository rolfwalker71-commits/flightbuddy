import { prisma } from "./db";
import { displayCallsign } from "./callsign";
import { objectLabel, resolveOperator } from "./operator";
import { fetchOpenSkyByIcao24s, openSkyToTelemetry } from "./opensky";
import { notifyUsers } from "./push";
import { buildObjectAlertCopy } from "./alert-copy";

const ABSENT_RESET_MS = 15 * 60 * 1000;
const AIRBORNE_DEBOUNCE_MS = 10 * 60 * 1000;

export type TrackedAircraftView = {
  id: string;
  icao24: string;
  callsign: string;
  operator: string | null;
  airlineIata: string | null;
  createdAt: Date;
};

export type TrackedAircraftInput = {
  icao24: string;
  callsign?: string | null;
  operator?: string | null;
  airlineIata?: string | null;
};

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
}): TrackedAircraftView {
  return {
    id: row.id,
    icao24: row.icao24,
    callsign: row.callsign,
    operator: row.operator,
    airlineIata: row.airlineIata,
    createdAt: row.createdAt,
  };
}

export async function listTrackedAircraft(userId: string): Promise<TrackedAircraftView[]> {
  const rows = await prisma.trackedAircraft.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toTrackedView);
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

export function displayTrackedCallsign(row: Pick<TrackedAircraftView, "callsign" | "icao24">) {
  return displayCallsign(row.callsign, row.icao24.slice(0, 6).toUpperCase());
}
