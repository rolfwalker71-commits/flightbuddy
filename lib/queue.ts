import { Queue } from "bullmq";
import { getRedis } from "./redis";

export const FLIGHT_POLL_QUEUE = "flight-poll";
export const REMINDER_QUEUE = "flight-reminders";

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

export async function schedulePreflightReminder(opts: {
  userFlightId: string;
  flightId: string;
  userId: string;
  runAt: Date;
}) {
  const delay = Math.max(0, opts.runAt.getTime() - Date.now());
  if (delay === 0 && opts.runAt.getTime() < Date.now() - 5 * 60 * 1000) return;
  await getReminderQueue().add(
    "preflight",
    opts,
    {
      jobId: `preflight-${opts.userFlightId}`,
      delay,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}

export async function cancelFlightPoll(flightId: string) {
  try {
    await getPollQueue().remove(`poll-${flightId}`);
  } catch {
    // Redis may be down; the worker already no-ops missing flights.
  }
}

export async function cancelPreflightReminder(userFlightId: string) {
  try {
    await getReminderQueue().remove(`preflight-${userFlightId}`);
  } catch {
    // Same as poll cancel: leftover jobs are skipped if the row is gone.
  }
}
