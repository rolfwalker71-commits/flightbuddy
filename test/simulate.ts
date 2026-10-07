// Spielt einen kompletten Flug durch (Boden → Start → Notfall-Squawk → Anflug → Landung) mit Fake-Verkehr
// und einem Dry-Run-APNs-Sender. Prüft Reihenfolge und Einmaligkeit der Meldungen.
import assert from "node:assert/strict";
import type { TrafficSource } from "../src/airplanes.ts";
import { DryRunSender } from "../src/apns.ts";
import { Store, openDb } from "../src/db.ts";
import { Monitor } from "../src/monitor.ts";
import type { Aircraft } from "../src/logic.ts";

const ZRH = { lat: 47.4647, lon: 8.5492 };
const LHR = { lat: 51.47, lon: -0.4543 };

let current: Aircraft | null = null;
const traffic: TrafficSource = {
  async byHex(hexes) { return current && hexes.includes(current.hex) ? [current] : []; },
  async byCallsign(cs) { return current && current.callsign === cs ? [current] : []; },
  async byRegistration() { return []; },
};

const base: Aircraft = { hex: "4b1814", callsign: "SWR8", registration: "HB-JNA", lat: ZRH.lat, lon: ZRH.lon,
  altitudeFt: 0, groundSpeedKts: 5, track: 270, verticalRateFpm: 0, squawk: "1000", onGround: true };

const store = new Store(openDb(":memory:"));
const sender = new DryRunSender();
const monitor = new Monitor(store, traffic, sender);

store.upsertDevice("aabbccddeeff00112233", "sandbox");
store.upsertWatch({ id: "watch-0001", device_token: "aabbccddeeff00112233", hex: null, callsign: "SWR8", reg: null, title: "SWR8",
  airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
  dest_iata: "LHR", dest_lat: LHR.lat, dest_lon: LHR.lon, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
store.setActivityToken("watch-0001", "deadbeefactivity");

const step = async (label: string, ac: Aircraft | null) => {
  current = ac;
  // Live-Activity-Drosselung für den Test aufheben
  const w = store.getWatch("watch-0001")!; w.last_activity_push = 0; store.save(w);
  const before = sender.sent.length;
  await monitor.tick();
  const alerts = sender.sent.slice(before).filter((p) => p.kind === "alert").map((p) => (p.payload.aps as any).alert.title as string);
  console.log(`— ${label}: ${alerts.length ? alerts.join(" | ") : "keine Meldung"}`);
  return alerts;
};

assert.deepEqual(await step("am Boden", base), []);
assert.deepEqual(await step("Start", { ...base, onGround: false, altitudeFt: 2500, groundSpeedKts: 180, lat: 47.5, lon: 8.3, verticalRateFpm: 2500 }), ["SWR8 ist gestartet"]);
assert.deepEqual(await step("Reiseflug", { ...base, onGround: false, altitudeFt: 36000, groundSpeedKts: 430, lat: 49.5, lon: 4, verticalRateFpm: 0 }), []);
assert.deepEqual(await step("Notfall 7700", { ...base, onGround: false, altitudeFt: 36000, groundSpeedKts: 430, lat: 49.8, lon: 3, squawk: "7700" }), ["Notfall-Squawk 7700"]);
assert.deepEqual(await step("Notfall bleibt", { ...base, onGround: false, altitudeFt: 36000, groundSpeedKts: 430, lat: 49.7, lon: 3.5, squawk: "7700" }), []);
const approach = await step("Anflug (~12 Min.)", { ...base, onGround: false, altitudeFt: 9000, groundSpeedKts: 300, lat: 51.2, lon: -2.0, verticalRateFpm: -1500, squawk: "1000" });
assert.equal(approach.length, 1); assert.match(approach[0]!, /^SWR8 landet in ca\. \d+ Min\.$/);
assert.deepEqual(await step("noch im Anflug", { ...base, onGround: false, altitudeFt: 4000, groundSpeedKts: 200, lat: 51.4, lon: -0.8, verticalRateFpm: -800 }), []);
assert.deepEqual(await step("Landung", { ...base, onGround: true, lat: LHR.lat, lon: LHR.lon }), ["SWR8 ist gelandet"]);

const w = store.getWatch("watch-0001")!;
assert.equal(w.active, 0, "Watch nach Landung noch aktiv");
const ends = sender.sent.filter((p) => p.kind === "liveactivity" && (p.payload.aps as any).event === "end");
assert.equal(ends.length, 1, "Live Activity muss genau einmal beendet werden");

// zweiter Zyklus nach Landung: nichts mehr
const n = sender.sent.length; await monitor.tick(); assert.equal(sender.sent.length, n);
console.log(`OK: ${sender.sent.length} Pushes, Ablauf wie erwartet.`);
