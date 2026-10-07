import { readFileSync } from "node:fs";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  port: Number(env("PORT", "8787")),
  dbPath: env("DB_PATH", "./data/flightbuddy.sqlite"),
  apiToken: env("API_TOKEN"),
  airplanesBase: env("AIRPLANES_BASE_URL", "https://api.airplanes.live/v2"),
  contact: env("AIRPLANES_CONTACT", "rolf@rolfwalker.ch"),
  apns: {
    keyPath: env("APNS_KEY_PATH"),
    keyId: env("APNS_KEY_ID"),
    teamId: env("APNS_TEAM_ID"),
    topic: env("APNS_TOPIC", "ch.rolfwalker.flightbuddy"),
  },
  pollActiveMs: Number(env("POLL_ACTIVE_SECONDS", "15")) * 1000,
  pollIdleMs: Number(env("POLL_IDLE_SECONDS", "60")) * 1000,
};

export function loadApnsKey(): string | null {
  if (!config.apns.keyPath || !config.apns.keyId || !config.apns.teamId) return null;
  try {
    return readFileSync(config.apns.keyPath, "utf8");
  } catch {
    return null;
  }
}
