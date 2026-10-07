import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

export type Watch = {
  id: string;
  device_token: string;
  hex: string | null;
  callsign: string | null;
  reg: string | null;
  title: string;
  airline_iata: string | null;
  airline_name: string | null;
  origin_iata: string | null;
  origin_lat: number | null;
  origin_lon: number | null;
  dest_iata: string | null;
  dest_lat: number | null;
  dest_lon: number | null;
  alert_squawk: number;
  alert_takeoff: number;
  alert_landing: number;
  alert_approach: number;
  activity_token: string | null;
  last_seen: number | null;
  last_on_ground: number | null;
  was_airborne: number;
  takeoff_sent: number;
  approach_sent: number;
  landed_sent: number;
  last_squawk: string | null;
  last_activity_push: number;
  last_activity_sig: string | null;
  active: number;
  start_sent: number;
  takeoff_at: number | null;
  sched_dep: number | null;
  origin_tz: string | null;
  dest_tz: string | null;
  flight_number: string | null;
  alert_reminder: number;
  alert_schedule: number;
  sched_status: string | null;
  dep_rev: number | null;
  gate: string | null;
  terminal: string | null;
  notified_dep: number | null;
  notified_gate: string | null;
  notified_status: string | null;
  next_check: number;
  last_check: number | null;
  last_state: string | null;
  lost_sent: number;
  reminder_sent: number;
  created_at: number;
};

export type Device = { token: string; env: "sandbox" | "production"; start_token: string | null };

export function openDb(path = config.dbPath): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
      token TEXT PRIMARY KEY, env TEXT NOT NULL DEFAULT 'production', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watches (
      id TEXT PRIMARY KEY,
      device_token TEXT NOT NULL REFERENCES devices(token) ON DELETE CASCADE,
      hex TEXT, callsign TEXT, reg TEXT, title TEXT NOT NULL,
      airline_iata TEXT, airline_name TEXT,
      origin_iata TEXT, origin_lat REAL, origin_lon REAL,
      dest_iata TEXT, dest_lat REAL, dest_lon REAL,
      alert_squawk INTEGER NOT NULL DEFAULT 1, alert_takeoff INTEGER NOT NULL DEFAULT 1,
      alert_landing INTEGER NOT NULL DEFAULT 1, alert_approach INTEGER NOT NULL DEFAULT 1,
      activity_token TEXT,
      last_seen INTEGER, last_on_ground INTEGER, was_airborne INTEGER NOT NULL DEFAULT 0,
      takeoff_sent INTEGER NOT NULL DEFAULT 0, approach_sent INTEGER NOT NULL DEFAULT 0, landed_sent INTEGER NOT NULL DEFAULT 0,
      last_squawk TEXT, last_activity_push INTEGER NOT NULL DEFAULT 0, last_activity_sig TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS watches_active ON watches(active);
    CREATE INDEX IF NOT EXISTS watches_device ON watches(device_token);
  `);
  // Spalten, die nach der ersten Version dazukamen (SQLite kennt kein ADD COLUMN IF NOT EXISTS).
  for (const sql of [
    "ALTER TABLE devices ADD COLUMN start_token TEXT",
    "ALTER TABLE watches ADD COLUMN start_sent INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE watches ADD COLUMN takeoff_at INTEGER",
    "ALTER TABLE watches ADD COLUMN sched_dep INTEGER",
    "ALTER TABLE watches ADD COLUMN origin_tz TEXT",
    "ALTER TABLE watches ADD COLUMN dest_tz TEXT",
    "ALTER TABLE watches ADD COLUMN flight_number TEXT",
    "ALTER TABLE watches ADD COLUMN alert_reminder INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE watches ADD COLUMN alert_schedule INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE watches ADD COLUMN sched_status TEXT",
    "ALTER TABLE watches ADD COLUMN dep_rev INTEGER",
    "ALTER TABLE watches ADD COLUMN gate TEXT",
    "ALTER TABLE watches ADD COLUMN terminal TEXT",
    "ALTER TABLE watches ADD COLUMN notified_dep INTEGER",
    "ALTER TABLE watches ADD COLUMN notified_gate TEXT",
    "ALTER TABLE watches ADD COLUMN notified_status TEXT",
    "ALTER TABLE watches ADD COLUMN next_check INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE watches ADD COLUMN last_check INTEGER",
    "ALTER TABLE watches ADD COLUMN last_state TEXT",
    "ALTER TABLE watches ADD COLUMN lost_sent INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE watches ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { db.exec(sql); } catch { /* Spalte existiert bereits */ }
  }
  return db;
}

export class Store {
  constructor(readonly db: DatabaseSync) {}

  getSetting(key: string): string | undefined {
    return (this.db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined)?.value;
  }
  setSetting(key: string, value: string) {
    this.db.prepare(`INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
  }
  deleteSetting(key: string) {
    this.db.prepare(`DELETE FROM settings WHERE key=?`).run(key);
  }

  upsertDevice(token: string, env: "sandbox" | "production") {
    this.db
      .prepare(`INSERT INTO devices(token, env, created_at) VALUES(?,?,?)
                ON CONFLICT(token) DO UPDATE SET env=excluded.env`)
      .run(token, env, Date.now());
  }

  getDevice(token: string): Device | undefined {
    return this.db.prepare(`SELECT token, env, start_token FROM devices WHERE token=?`).get(token) as Device | undefined;
  }

  setStartToken(token: string, startToken: string | null) {
    this.db.prepare(`UPDATE devices SET start_token=? WHERE token=?`).run(startToken, token);
  }

  deleteDevice(token: string) {
    this.db.prepare(`DELETE FROM devices WHERE token=?`).run(token);
  }

  upsertWatch(w: Pick<Watch, "id" | "device_token" | "hex" | "callsign" | "reg" | "title" | "airline_iata" | "airline_name"
    | "origin_iata" | "origin_lat" | "origin_lon" | "dest_iata" | "dest_lat" | "dest_lon"
    | "alert_squawk" | "alert_takeoff" | "alert_landing" | "alert_approach">
    & Partial<Pick<Watch, "sched_dep" | "origin_tz" | "dest_tz" | "flight_number" | "alert_reminder" | "alert_schedule">>) {
    const v: Record<string, string | number | null> = {
      id: w.id, device_token: w.device_token, hex: w.hex, callsign: w.callsign, reg: w.reg, title: w.title,
      airline_iata: w.airline_iata, airline_name: w.airline_name,
      origin_iata: w.origin_iata, origin_lat: w.origin_lat, origin_lon: w.origin_lon,
      dest_iata: w.dest_iata, dest_lat: w.dest_lat, dest_lon: w.dest_lon,
      alert_squawk: w.alert_squawk, alert_takeoff: w.alert_takeoff, alert_landing: w.alert_landing, alert_approach: w.alert_approach,
      alert_reminder: w.alert_reminder ?? 1, alert_schedule: w.alert_schedule ?? 1,
      sched_dep: w.sched_dep ?? null, origin_tz: w.origin_tz ?? null, dest_tz: w.dest_tz ?? null,
      flight_number: w.flight_number ?? null, created_at: Date.now(),
    };
    const cols = Object.keys(v);
    // Bei erneutem Abgleich bleibt der Zustand erhalten; ändern sich Flugnummer oder Abflug, wird neu geprüft.
    const update = cols.filter((c) => c !== "id" && c !== "created_at" && c !== "hex")
      .map((c) => `${c}=excluded.${c}`).join(", ");
    this.db.prepare(
      `INSERT INTO watches(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})
       ON CONFLICT(id) DO UPDATE SET hex=COALESCE(excluded.hex, watches.hex), ${update},
         next_check=CASE WHEN excluded.flight_number IS NOT watches.flight_number OR excluded.sched_dep IS NOT watches.sched_dep THEN 0 ELSE watches.next_check END,
         active=1`,
    ).run(...Object.values(v));
  }

  /** Fahrplanzustand (AeroDataBox) speichern. */
  saveSchedule(w: Watch) {
    this.db.prepare(
      `UPDATE watches SET sched_status=?, dep_rev=?, gate=?, terminal=?, notified_dep=?, notified_gate=?, notified_status=?, next_check=?, last_check=? WHERE id=?`,
    ).run(w.sched_status, w.dep_rev, w.gate, w.terminal, w.notified_dep, w.notified_gate, w.notified_status, w.next_check, w.last_check, w.id);
  }

  deleteWatch(id: string) {
    this.db.prepare(`DELETE FROM watches WHERE id=?`).run(id);
  }

  setActivityToken(id: string, token: string | null) {
    this.db.prepare(`UPDATE watches SET activity_token=? WHERE id=?`).run(token, id);
  }

  activeWatches(): Watch[] {
    return this.db.prepare(`SELECT * FROM watches WHERE active=1`).all() as Watch[];
  }

  getWatch(id: string): Watch | undefined {
    return this.db.prepare(`SELECT * FROM watches WHERE id=?`).get(id) as Watch | undefined;
  }

  save(w: Watch) {
    this.db
      .prepare(
        `UPDATE watches SET hex=?, last_seen=?, last_on_ground=?, was_airborne=?, takeoff_sent=?, approach_sent=?,
           landed_sent=?, last_squawk=?, last_activity_push=?, last_activity_sig=?, active=?, activity_token=?, start_sent=?, takeoff_at=?, reminder_sent=?, last_state=?, lost_sent=? WHERE id=?`,
      )
      .run(w.hex, w.last_seen, w.last_on_ground, w.was_airborne, w.takeoff_sent, w.approach_sent, w.landed_sent,
        w.last_squawk, w.last_activity_push, w.last_activity_sig, w.active, w.activity_token, w.start_sent, w.takeoff_at, w.reminder_sent, w.last_state, w.lost_sent, w.id);
  }
}
