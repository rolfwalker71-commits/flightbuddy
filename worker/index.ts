import { Worker } from "bullmq";
import { PollPhase } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { FLIGHT_POLL_QUEUE, REMINDER_QUEUE, scheduleFlightPoll, type ReminderKind } from "@/lib/queue";
import { pollFlight } from "@/lib/polling";
import { notifyUsers } from "@/lib/push";
import { pollTrackedAircraft } from "@/lib/tracked-aircraft";
import { openSkyConfig } from "@/lib/server-env";

async function recoverDueFlights() {
  const due = await prisma.flight.findMany({
    where: {
      pollPhase: { not: PollPhase.COMPLETE },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
    },
    select: { id: true, nextPollAt: true },
    take: 50,
  });
  for (const flight of due) {
    await scheduleFlightPoll(flight.id, flight.nextPollAt);
  }
}

const pollWorker = new Worker(
  FLIGHT_POLL_QUEUE,
  async (job) => {
    const flightId = String(job.data.flightId ?? "");
    if (!flightId) return;
    await pollFlight(flightId);
  },
  { connection: getRedis(), concurrency: 2 },
);

const reminderWorker = new Worker(
  REMINDER_QUEUE,
  async (job) => {
    const data = job.data as {
      userId: string;
      flightId: string;
      kind?: ReminderKind;
    };
    const kind: ReminderKind =
      data.kind ??
      (job.name === "gate_close" || job.name === "arrival_soon" || job.name === "preflight"
        ? (job.name as ReminderKind)
        : "preflight");
    const { userId, flightId } = data;
    const stillTracked = await prisma.userFlight.findFirst({
      where: { userId, flightId, pushAlerts: true },
      select: { id: true },
    });
    if (!stillTracked) return;
    const flight = await prisma.flight.findUnique({
      where: { id: flightId },
      include: { departureAirport: true, arrivalAirport: true },
    });
    if (!flight || flight.pollPhase === PollPhase.COMPLETE) return;

    if (kind === "arrival_soon") {
      const alreadyLanded =
        flight.status === "LANDED" || flight.actualArr != null || flight.lastOnGround === true;
      if (alreadyLanded) return;
    }
    if (kind === "gate_close" || kind === "preflight") {
      const alreadyGone =
        flight.status === "DEPARTED" ||
        flight.status === "EN_ROUTE" ||
        flight.status === "LANDED" ||
        flight.actualDep != null;
      if (alreadyGone) return;
    }

    await notifyUsers({
      userIds: [userId],
      kind,
      flight,
    });
  },
  { connection: getRedis(), concurrency: 4 },
);

pollWorker.on("failed", (job, err) => {
  console.error("[poll] failed", job?.id, err.message);
});
reminderWorker.on("failed", (job, err) => {
  console.error("[reminder] failed", job?.id, err.message);
});

async function recoverRecurringFlights() {
  try {
    const { advanceRecurringFlights } = await import("@/lib/recurrence");
    await advanceRecurringFlights();
  } catch (err) {
    console.error("[recurrence] recover failed", err);
  }
}

void (async () => {
  const { ensureWebPushConfigured } = await import("@/lib/vapid");
  await ensureWebPushConfigured();
  await recoverDueFlights();
  await recoverRecurringFlights();
  console.log("FlightBuddy worker ready");
})();

setInterval(() => {
  void recoverDueFlights();
}, 5 * 60 * 1000);

setInterval(() => {
  void recoverRecurringFlights();
}, 15 * 60 * 1000);

const objectPollMs = Math.min(90_000, Math.max(30_000, openSkyConfig().minIntervalMs));

async function pollSavedObjects() {
  try {
    await pollTrackedAircraft();
  } catch (err) {
    console.error("[objects] poll failed", err);
  }
}

void pollSavedObjects();
setInterval(() => {
  void pollSavedObjects();
}, objectPollMs);

function shutdown() {
  void Promise.all([pollWorker.close(), reminderWorker.close()]).then(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
