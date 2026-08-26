import { getRedis } from "./redis";

export async function takeToken(opts: {
  key: string;
  minIntervalMs: number;
}): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const redis = getRedis();
  const now = Date.now();
  const lastRaw = await redis.get(opts.key);
  const last = lastRaw ? Number(lastRaw) : 0;
  const elapsed = now - last;
  if (last && elapsed < opts.minIntervalMs) {
    return { allowed: false, retryAfterMs: opts.minIntervalMs - elapsed };
  }
  await redis.set(opts.key, String(now), "PX", opts.minIntervalMs);
  return { allowed: true, retryAfterMs: 0 };
}
