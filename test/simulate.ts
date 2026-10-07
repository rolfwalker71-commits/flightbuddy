// Spielt einen kompletten Flug durch (Boden → Start → Notfall-Squawk → Anflug → Landung) mit Fake-Verkehr
// und einem Dry-Run-APNs-Sender. Prüft Reihenfolge und Einmaligkeit der Meldungen.
import assert from "node:assert/strict";
import type { TrafficSource } from "../src/airplanes.ts";
import { DryRunSender } from "../src/apns.ts";
import { Store, openDb } from "../src/db.ts";
import { Monitor } from "../src/monitor.ts";
import type { Aircraft } from "../src/logic.ts";
import { DEMO, DemoTraffic } from "../src/demo.ts";

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
// --- Szenario B: Live Activity per Push starten (App geschlossen) ---
{
  let planeB: Aircraft | null = null;
  const trafficB: TrafficSource = {
    async byHex(h) { return planeB && h.includes(planeB.hex) ? [planeB] : []; },
    async byCallsign() { return []; }, async byRegistration() { return []; },
  };
  const storeB = new Store(openDb(":memory:"));
  const senderB = new DryRunSender();
  const monB = new Monitor(storeB, trafficB, senderB);
  storeB.upsertDevice("devtoken-with-start", "sandbox");
  storeB.setStartToken("devtoken-with-start", "starttoken0001");
  storeB.upsertDevice("devtoken-no-start", "sandbox");
  const mk = (id: string, dev: string, hex: string) => storeB.upsertWatch({ id, device_token: dev, hex, callsign: null, reg: null, title: "DLH7XK",
    airline_iata: "LH", airline_name: "Lufthansa", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "LHR", dest_lat: LHR.lat, dest_lon: LHR.lon, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  mk("watch-withstart-1", "devtoken-with-start", "aaa111");
  mk("watch-nostart-0002", "devtoken-no-start", "aaa111");
  const starts = () => senderB.sent.filter((p) => p.kind === "liveactivity" && (p.payload.aps as any).event === "start");

  planeB = { ...base, hex: "aaa111", callsign: "DLH7XK" };
  await monB.tick();
  assert.equal(starts().length, 0, "am Boden darf keine Activity gestartet werden");

  planeB = { ...planeB, onGround: false, altitudeFt: 3000, groundSpeedKts: 220, lat: 47.5, lon: 8.2, verticalRateFpm: 2200 };
  await monB.tick();
  assert.equal(starts().length, 1, "genau eine Start-Push erwartet (nur das Gerät mit Start-Token)");
  const st = starts()[0]!;
  assert.equal(st.deviceToken, "starttoken0001");
  assert.equal(st.env, "sandbox");
  const aps = st.payload.aps as any;
  assert.equal(aps["attributes-type"], "FlightActivityAttributes");
  assert.equal(aps.attributes.watchId, "watch-withstart-1");
  assert.equal(aps.attributes.airlineIATA, "LH");
  assert.ok(aps["content-state"].phaseLabel && "emergency" in aps["content-state"]);

  await monB.tick();
  assert.equal(starts().length, 1, "nicht ein zweites Mal starten");

  // Die App meldet nach dem Start das Token der Activity: ab jetzt gehen Updates dorthin.
  storeB.setActivityToken("watch-withstart-1", "activitytoken0001");
  planeB = { ...planeB, altitudeFt: 20000, lat: 49, lon: 5, verticalRateFpm: 1800 };
  const w = storeB.getWatch("watch-withstart-1")!; w.last_activity_push = 0; storeB.save(w);
  const before = senderB.sent.length;
  await monB.tick();
  const upd = senderB.sent.slice(before).filter((p) => p.kind === "liveactivity");
  assert.equal(upd.length, 1);
  assert.equal(upd[0]!.deviceToken, "activitytoken0001");
  assert.equal((upd[0]!.payload.aps as any).event, "update");
  assert.equal(starts().length, 1);
  console.log("OK: Live Activity wird per Push gestartet (einmal, nur mit Start-Token), danach aktualisiert.");
}


// --- Szenario C: Demo-Verkehr durchläuft alle Ereignisse mit dem echten Monitor ---
{
  let clock = 1_000_000;
  const store = new Store(openDb(":memory:"));
  const sender = new DryRunSender();
  const mon = new Monitor(store, new DemoTraffic(() => clock), sender);
  store.upsertDevice("devtoken-demo", "sandbox");
  store.setStartToken("devtoken-demo", "starttokendemo");
  store.upsertWatch({ id: "watch-demo-0001", device_token: "devtoken-demo", hex: null, callsign: "SWR8", reg: null, title: "SWR8",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "LHR", dest_lat: LHR.lat, dest_lon: LHR.lon, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  const titles: string[] = [];
  for (let t = 0; t <= DEMO.landedAt + 30; t += 5) {
    clock = 1_000_000 + t * 1000;
    const w = store.getWatch("watch-demo-0001")!; w.last_activity_push = 0; store.save(w);
    const n = sender.sent.length;
    await mon.tick();
    for (const p of sender.sent.slice(n)) if (p.kind === "alert") titles.push((p.payload.aps as any).alert.title);
    if (t === 60) store.setActivityToken("watch-demo-0001", "activitytokendemo"); // App meldet das Token nach dem Start
  }
  assert.deepEqual(titles.map((x) => x.replace(/\d+ Min\./, "n Min.")),
    ["SWR8 ist gestartet", "Notfall-Squawk 7700", "SWR8 landet in ca. n Min.", "SWR8 ist gelandet"]);
  const starts = sender.sent.filter((p) => p.kind === "liveactivity" && (p.payload.aps as any).event === "start");
  const ends = sender.sent.filter((p) => p.kind === "liveactivity" && (p.payload.aps as any).event === "end");
  assert.equal(starts.length, 1); assert.equal(ends.length, 1);
  console.log("OK: Demo-Flug löst Start, Squawk, Anflug und Landung genau einmal aus.");
}
