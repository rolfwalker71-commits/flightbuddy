import { readFileSync, statSync } from "node:fs";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  port: Number(env("PORT", "8787")),
  dbPath: env("DB_PATH", "./data/flightbuddy.sqlite"),
  apiToken: env("API_TOKEN"),
  /** "airplanes" (Standard) oder "demo": simulierter Verkehr zum Testen ohne airplanes.live. */
  trafficSource: env("TRAFFIC_SOURCE", "airplanes").toLowerCase(),
  airplanesBase: env("AIRPLANES_BASE_URL", "https://api.airplanes.live/v2"),
  contact: env("AIRPLANES_CONTACT", "rolf@rolfwalker.ch"),
  apns: {
    keyPath: env("APNS_KEY_PATH"),
    keyId: env("APNS_KEY_ID"),
    teamId: env("APNS_TEAM_ID", "9XZWUZ7Z26"),
    topic: env("APNS_TOPIC", "ch.rolfwalker.flightbuddy"),
  },
  pollActiveMs: Number(env("POLL_ACTIVE_SECONDS", "15")) * 1000,
  pollIdleMs: Number(env("POLL_IDLE_SECONDS", "60")) * 1000,
};

export type ApnsKeyResult = { pem: string } | { pem: null; reason: string };

/** Lädt den APNs-Schlüssel und nennt bei Misserfolg den genauen Grund (für das Start-Log). */
export function loadApnsKey(): ApnsKeyResult {
  const { keyPath, keyId, teamId } = config.apns;
  if (!keyPath) return { pem: null, reason: "APNS_KEY_PATH ist leer" };
  if (!keyId) return { pem: null, reason: "APNS_KEY_ID ist nicht gesetzt (Teil des Dateinamens AuthKey_<KEYID>.p8)" };
  if (!teamId) return { pem: null, reason: "APNS_TEAM_ID ist nicht gesetzt" };
  try {
    if (statSync(keyPath).isDirectory()) {
      return { pem: null, reason: `${keyPath} ist ein Ordner, keine Datei: APNS_KEY_HOST_PATH zeigt auf einen nicht vorhandenen Pfad` };
    }
    const pem = readFileSync(keyPath, "utf8");
    if (!pem.includes("BEGIN PRIVATE KEY")) return { pem: null, reason: `${keyPath} enthält keinen PEM-Schlüssel (.p8 erwartet)` };
    return { pem };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { pem: null, reason: code === "ENOENT" ? `${keyPath} existiert nicht` : code === "EACCES" ? `${keyPath} ist nicht lesbar (Dateirechte)` : String(e) };
  }
}
