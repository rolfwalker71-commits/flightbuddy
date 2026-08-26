import IORedis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };

export function getRedis() {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return globalForRedis.redis;
}
