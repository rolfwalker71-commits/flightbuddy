import { Queue } from "bullmq";
import { getRedis } from "./redis";

export const FLIGHT_POLL_QUEUE = "flight-poll";
export const REMINDER_QUEUE = "flight-reminders";

export type ReminderKind = "preflight" | "gate_close" | "arrival_soon";

let pollQueue: Queue | undefined;
let reminderQueue: Queue | undefined;

export function getPollQueue() {
  pollQueue ??= new Queue(FLIGHT_POLL_QUEUE, { connection: getRedis() });
  return pollQueue;
}

export function getReminderQueue() {
  reminderQueue ??= new Queue(REMINDER_QUEUE, { connection: getRedis() });
  return reminderQueue;
}

export async function scheduleFlightPoll(flightId: string, runAt?: Date | null) {
  const queue = getPollQueue();
  const delay = runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0;
  await queue.add(
    "poll",
    { flightId },
    {
      jobId: `poll-${flightId}`,
      delay,
      removeOnComplete: 200,
      removeOnFail: 200,
    },
  );
}

export async function scheduleFlightReminder(opts: {
  kind: ReminderKind;
  userFlightId: string;
  flightId: string;
  userId: string;
  runAt: Date;
}) {
  const delay = Math.max(0, opts.runAt.getTime() - Date.now());
  if (delay === 0 && opts.runAt.getTime() < Date.now() - 5 * 60 * 1000) return;
  await getReminderQueue().add(
    opts.kind,
    {
      userFlightId: opts.userFlightId,
      flightId: opts.flightId,
      userId: opts.userId,
      kind: opts.kind,
    },
    {
      jobId: `${opts.kind}-${opts.userFlightId}`,
      delay,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}

/** @deprecated use scheduleFlightReminder({ kind: "preflight", ... }) */
export async function schedulePreflightReminder(opts: {
  userFlightId: string;
  flightId: string;
  userId: string;
  runAt: Date;
}) {
  await scheduleFlightReminder({ ...opts, kind: "preflight" });
}

export async function scheduleUserFlightReminders(opts: {
  userFlightId: string;
  flightId: string;
  userId: string;
  scheduledDep: Date;
  scheduledArr?: Date | null;
  estimatedDep?: Date | null;
  estimatedArr?: Date | null;
  actualDep?: Date | null;
  actualArr?: Date | null;
  preflightWindowHours: number;
}) {
  const dep = opts.actualDep ?? opts.estimatedDep ?? opts.scheduledDep;
  const arr = opts.actualArr ?? opts.estimatedArr ?? opts.scheduledArr ?? null;

  await scheduleFlightReminder({
    kind: "preflight",
    userFlightId: opts.userFlightId,
    flightId: opts.flightId,
    userId: opts.userId,
    runAt: new Date(dep.getTime() - opts.preflightWindowHours * 60 * 60 * 1000),
  });

  await scheduleFlightReminder({
    kind: "gate_close",
    userFlightId: opts.userFlightId,
    flightId: opts.flightId,
    userId: opts.userId,
    runAt: new Date(dep.getTime() - 45 * 60 * 1000),
  });

  if (arr) {
    await scheduleFlightReminder({
      kind: "arrival_soon",
      userFlightId: opts.userFlightId,
      flightId: opts.flightId,
      userId: opts.userId,
      runAt: new Date(arr.getTime() - 30 * 60 * 1000),
    });
  }
}

export async function cancelFlightPoll(flightId: string) {
  try {
    await getPollQueue().remove(`poll-${flightId}`);
  } catch {
    // Redis may be down; the worker already no-ops missing flights.
  }
}

export async function cancelFlightReminders(userFlightId: string) {
  for (const kind of ["preflight", "gate_close", "arrival_soon"] as const) {
    try {
      await getReminderQueue().remove(`${kind}-${userFlightId}`);
    } catch {
      // leftover jobs are skipped if the row is gone
    }
  }
}

/** @deprecated use cancelFlightReminders */
export async function cancelPreflightReminder(userFlightId: string) {
  await cancelFlightReminders(userFlightId);
}
