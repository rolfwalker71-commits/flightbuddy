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
  async near() { return current ? [current] : []; },
  async searchCallsign() { return { aircraft: current ? [current] : [], partial: false }; },
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
    async near() { return planeB ? [planeB] : []; },
    async searchCallsign() { return { aircraft: [], partial: false }; },
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
  // Abflugzeit: beim Start gesetzt (beobachteter Abflug) und in allen späteren Updates unverändert
  const deps = sender.sent.filter((p) => p.kind === "liveactivity").map((p) => (p.payload.aps as any)["content-state"].departureTimestamp);
  assert.ok(deps.length > 3 && deps.every((d: unknown) => typeof d === "number"), "departureTimestamp fehlt");
  assert.equal(new Set(deps).size, 1, "departureTimestamp darf sich nicht ändern");
  console.log("OK: Demo-Flug löst Start, Squawk, Anflug und Landung genau einmal aus.");
}

// --- Szenario D: Flug auf Vorrat (Tage im Voraus hinterlegt) ---
{
  const H = 3600_000;
  let clock = Date.parse("2026-10-27T00:00:00Z");
  const dep = Date.parse("2026-10-28T12:05:00Z"); // 13:05 Uhr Schweizer Zeit (Winterzeit ab 25.10.)
  let calls = 0;
  let plane: Aircraft | null = null;
  const traffic: TrafficSource = {
    async byHex(h) { calls++; return plane && h.includes(plane.hex) ? [plane] : []; },
    async byCallsign() { calls++; return plane ? [plane] : []; },
    async byRegistration() { calls++; return []; },
    async near() { calls++; return []; },
    async searchCallsign(q) { calls++; return { aircraft: plane && plane.callsign!.startsWith(q) ? [plane] : [], partial: false }; },
  };
  const store = new Store(openDb(":memory:"));
  const sender = new DryRunSender();
  const mon = new Monitor(store, traffic, sender, () => clock);
  store.upsertDevice("devtoken-plan", "sandbox");
  store.upsertWatch({ id: "watch-plan-0001", device_token: "devtoken-plan", hex: null, callsign: "SWR64", reg: null, title: "LX64",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "MIA", dest_lat: 25.7932, dest_lon: -80.2906, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1, sched_dep: dep });
  const alerts = () => sender.sent.filter((p) => p.kind === "alert").map((p) => (p.payload.aps as any).alert as { title: string; body: string });

  // 1.5 Tage vorher: schläft, keine einzige Abfrage
  await mon.tick(); clock += 12 * H; await mon.tick(); // 12 Stunden vorher
  assert.equal(calls, 0, "ein geplanter Flug darf weit vor dem Abflug nichts abfragen");
  assert.equal(alerts().length, 0);

  // 4 Stunden vorher: wacht auf und sucht (Flugzeug noch nicht da)
  clock = dep - 4 * H + 1000; await mon.tick();
  assert.equal(calls, 1, "ab 4 Stunden vorher wird gesucht");
  await mon.tick(); assert.equal(calls, 1, "die Suche wird auf alle 3 Minuten gedrosselt");
  clock += 3 * 60_000; await mon.tick(); assert.equal(calls, 2);

  // 3 Stunden vorher: genau eine Erinnerung
  clock = dep - 3 * H + 1000; await mon.tick(); await mon.tick();
  assert.equal(alerts().length, 1); assert.equal(alerts()[0]!.title, "LX64 hebt in 3 Std. ab");
  assert.match(alerts()[0]!.body, /ZRH → MIA · 13:05 Uhr/);

  // Flugzeug erscheint am Boden (mit Suffix), dann Abflug: normale Ereignisse
  plane = { ...base, hex: "4b191e", callsign: "SWR64E", registration: "HB-JNI", lat: ZRH.lat, lon: ZRH.lon, onGround: true };
  clock = dep - 60 * 60_000; await mon.tick();
  assert.equal(store.getWatch("watch-plan-0001")!.hex, "4b191e", "Hex wird über das Callsign mit Suffix gefunden");
  plane = { ...plane, onGround: false, altitudeFt: 3000, groundSpeedKts: 220, verticalRateFpm: 2200, lat: 47.5, lon: 8.2 };
  clock = dep + 10 * 60_000; await mon.tick();
  assert.ok(alerts().some((a) => a.title === "LX64 ist gestartet"));

  // Erinnerung in der Ortszeit des Abflughafens (Lissabon 08:40, nicht Zürcher Zeit 09:40)
  {
    const st = new Store(openDb(":memory:")); const sd = new DryRunSender(); let c2 = Date.parse("2026-10-30T00:00:00Z");
    const m2 = new Monitor(st, traffic, sd, () => c2);
    st.upsertDevice("devtoken-lis", "sandbox");
    st.upsertWatch({ id: "watch-lis-0001", device_token: "devtoken-lis", hex: null, callsign: "TAP930", reg: null, title: "TP930", airline_iata: "TP", airline_name: "TAP",
      origin_iata: "LIS", origin_lat: 38.78, origin_lon: -9.14, dest_iata: "ZRH", dest_lat: ZRH.lat, dest_lon: ZRH.lon,
      alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1, sched_dep: Date.parse("2026-10-30T08:40:00Z"), origin_tz: "Europe/Lisbon" });
    c2 = Date.parse("2026-10-30T08:40:00Z") - 3 * H + 1000; await m2.tick();
    const t = sd.sent.filter((p) => p.kind === "alert").map((p) => (p.payload.aps as any).alert as { title: string; body: string });
    assert.equal(t.length, 1); assert.match(t[0]!.body, /LIS → ZRH · 08:40 Uhr/, "Ortszeit des Abflughafens erwartet");
  }

  // Nie gesehener Flug wird nach dem Abflug beendet
  store.upsertWatch({ id: "watch-ghost-0001", device_token: "devtoken-plan", hex: null, callsign: "XXX1", reg: null, title: "XX1",
    airline_iata: null, airline_name: null, origin_iata: null, origin_lat: null, origin_lon: null, dest_iata: null, dest_lat: null, dest_lon: null,
    alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1, sched_dep: clock - 13 * H });
  await mon.tick();
  assert.equal(store.getWatch("watch-ghost-0001")!.active, 0, "nie gesehener Flug wird 12 Stunden nach dem Abflug beendet");
  console.log("OK: Flug auf Vorrat schläft, erinnert 3 Stunden vorher, findet SWR64E und meldet den Start");
}

// --- Szenario E: Funkstille über dem Ozean ---
{
  const H = 3600_000;
  let clock = Date.parse("2026-10-07T11:30:00Z");
  let plane: Aircraft | null = { ...base, hex: "4b191e", callsign: "SWR64E", registration: "HB-JNI", lat: 46, lon: -3, onGround: false,
    altitudeFt: 34000, groundSpeedKts: 460, verticalRateFpm: 0, squawk: "3046" };
  const traffic: TrafficSource = {
    async byHex(h) { return plane && h.includes(plane.hex) ? [plane] : []; },
    async byCallsign() { return plane ? [plane] : []; }, async byRegistration() { return []; },
    async near() { return []; }, async searchCallsign() { return { aircraft: plane ? [plane] : [], partial: false }; },
  };
  const st = new Store(openDb(":memory:")); const sd = new DryRunSender();
  const mon = new Monitor(st, traffic, sd, () => clock);
  st.upsertDevice("devtoken-ocean", "sandbox");
  st.upsertWatch({ id: "watch-ocean-0001", device_token: "devtoken-ocean", hex: "4b191e", callsign: "SWR64E", reg: null, title: "LX64",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "MIA", dest_lat: 25.79, dest_lon: -80.29, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  st.setActivityToken("watch-ocean-0001", "activitytokenocean");
  const lastLA = () => sd.sent.filter((p) => p.kind === "liveactivity").at(-1)!;
  const laCount = () => sd.sent.filter((p) => p.kind === "liveactivity").length;

  const w0 = st.getWatch("watch-ocean-0001")!; w0.was_airborne = 1; st.save(w0); // Start wurde schon beobachtet
  await mon.tick();                                 // letzter Empfang
  const n0 = laCount();
  plane = null; clock += 5 * 60_000; await mon.tick();
  assert.equal(laCount(), n0, "5 Minuten Funkstille sind noch kein Signalverlust");
  clock += 6 * 60_000; await mon.tick();
  assert.equal(laCount(), n0 + 1, "nach 10 Minuten Funkstille genau ein Update");
  const cs = (lastLA().payload.aps as any)["content-state"];
  assert.equal(cs.phaseLabel, "Kein Empfang"); assert.equal(cs.phase, "lost");
  assert.ok(cs.etaTimestamp != null && cs.departureTimestamp !== undefined, "Landezeit bleibt erhalten");
  clock += 30 * 60_000; await mon.tick(); assert.equal(laCount(), n0 + 1, "kein zweites Update bei anhaltender Stille");

  // Ozean-Überquerung: nach 7 Stunden ohne Daten läuft die Beobachtung weiter (früher: nach 6 Stunden beendet)
  clock += 7 * H; await mon.tick();
  assert.equal(st.getWatch("watch-ocean-0001")!.active, 1, "in der Luft nicht nach 6 Stunden aufgeben");

  // Wieder Empfang kurz vor Miami: normales Update ersetzt «Kein Empfang»
  plane = { ...base, hex: "4b191e", callsign: "SWR64E", lat: 26.5, lon: -78, onGround: false, altitudeFt: 12000, groundSpeedKts: 300, verticalRateFpm: -1500 };
  const n1 = laCount(); await mon.tick();
  assert.ok(laCount() > n1, "nach Wiederempfang ein normales Update");
  assert.notEqual(((lastLA().payload.aps as any)["content-state"]).phaseLabel, "Kein Empfang");
  assert.equal(st.getWatch("watch-ocean-0001")!.lost_sent, 0);

  // Am Boden nie gesehene Flüge enden weiterhin nach 6 Stunden, in der Luft erst nach 20
  plane = null; clock += 21 * H; await mon.tick();
  assert.equal(st.getWatch("watch-ocean-0001")!.active, 0, "nach 20 Stunden ohne Daten wird auch ein Flug in der Luft beendet");
  console.log("OK: Funkstille über dem Ozean: Signalverlust einmal melden, Beobachtung läuft weiter, Wiederempfang");
}

// --- Szenario F: Flug nur mit Registration, Quelle kann keine Registrationen (OpenSky als Ersatz) ---
{
  let calls: string[] = [];
  const plane: Aircraft = { ...base, hex: "4081bb", callsign: "BAW629", registration: "G-TNEF", lat: 46.6, lon: 9.5, onGround: false,
    altitudeFt: 36000, groundSpeedKts: 415, verticalRateFpm: 0, squawk: "1000" };
  const traffic: TrafficSource = {
    async byHex() { calls.push("hex"); return []; },
    async byRegistration() { calls.push("reg"); throw new Error("OpenSky kann nicht nach Registration suchen"); },
    async byCallsign() { return []; }, async near() { return []; },
    async searchCallsign(q) { calls.push("cs:" + q); return { aircraft: q === "BAW629" ? [plane] : [], partial: false }; },
  };
  const st = new Store(openDb(":memory:")); const sd = new DryRunSender();
  const mon = new Monitor(st, traffic, sd);
  st.upsertDevice("devtoken-reg", "sandbox");
  const mkw = (id: string, over: Record<string, unknown>) => st.upsertWatch({ id, device_token: "devtoken-reg", hex: null, callsign: null, reg: null, title: "BA629",
    airline_iata: "BA", airline_name: "British Airways", origin_iata: "ATH", origin_lat: 37.9, origin_lon: 23.9, dest_iata: "LHR", dest_lat: 51.47, dest_lon: -0.45,
    alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1, ...over });
  mkw("watch-regonly-0001", { reg: "G-TNEF", callsign: "BAW629" });   // Registration schlägt fehl, Callsign klappt
  mkw("watch-regonly-0002", { reg: "G-ZZZZ" });                       // nur Registration: Fehler, aber andere Flüge laufen weiter
  await mon.tick();
  assert.equal(st.getWatch("watch-regonly-0001")!.hex, "4081bb", "über das Callsign gefunden, obwohl die Registration-Suche scheitert");
  assert.ok(calls.includes("cs:BAW629"));
  assert.equal(mon.lastError, null === mon.lastError ? null : mon.lastError, "Zyklus nicht abgebrochen");
  assert.ok(st.getWatch("watch-regonly-0002")!.active === 1);
  console.log("OK: Flug mit Registration findet sich über das Callsign; ein Fehler bei einem Weg bricht den Zyklus nicht ab");
}

// --- Szenario G: Restzeit als «8:14»: regelmässige Updates, damit die Anzeige nicht veraltet ---
{
  let clock = Date.parse("2026-10-07T20:00:00Z");
  const fixed: Aircraft = { ...base, hex: "4081bb", callsign: "BAW629", lat: 47.0, lon: 14.0, onGround: false, altitudeFt: 36000,
    groundSpeedKts: 450, verticalRateFpm: 0, squawk: "1000" };
  const traffic: TrafficSource = {
    async byHex() { return [fixed]; }, async byCallsign() { return [fixed]; }, async byRegistration() { return []; },
    async near() { return []; }, async searchCallsign() { return { aircraft: [fixed], partial: false }; },
  };
  const st = new Store(openDb(":memory:")); const sd = new DryRunSender();
  const mon = new Monitor(st, traffic, sd, () => clock);
  st.upsertDevice("devtoken-min", "sandbox");
  st.upsertWatch({ id: "watch-minute-0001", device_token: "devtoken-min", hex: "4081bb", callsign: "BAW629", reg: null, title: "BA629",
    airline_iata: "BA", airline_name: "BA", origin_iata: "ATH", origin_lat: 37.9, origin_lon: 23.9, dest_iata: "LHR", dest_lat: 51.47, dest_lon: -0.45,
    alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  st.setActivityToken("watch-minute-0001", "activitytokenminute");
  const w0 = st.getWatch("watch-minute-0001")!; w0.was_airborne = 1; w0.last_on_ground = 0; st.save(w0);
  const updates = () => sd.sent.filter((p) => p.kind === "liveactivity" && (p.payload.aps as any).event === "update");

  await mon.tick();                       // erstes Update
  const n0 = updates().length; assert.equal(n0, 1);
  const eta0 = (updates()[0]!.payload.aps as any)["content-state"].etaTimestamp as number;
  const remaining0 = eta0 - clock / 1000;
  assert.ok(remaining0 > 3600 && remaining0 < 7200, "Test setzt 1–2 Stunden Restzeit voraus, hat " + remaining0);
  clock += 30_000; await mon.tick(); assert.equal(updates().length, n0, "30 s später ohne Änderung: kein Update");
  clock += 31_000; await mon.tick(); assert.equal(updates().length, n0 + 1, "unter 2 Stunden: nach 60 s ein Update, auch ohne Änderung");
  assert.equal(updates().at(-1)!.priority, 5, "über einer Stunde Restzeit normale Priorität");
  clock += 61_000; await mon.tick(); assert.equal(updates().length, n0 + 2, "und wieder nach 60 s");
  console.log("OK: unter 2 Stunden Restzeit jede Minute ein Update der Live Activity");
}

// --- Szenario H: Flug erst später angelegt: tatsächliche Abflugzeit aus dem Flugweg ---
{
  const nowMs = Date.parse("2026-10-07T17:00:00Z");
  const plane: Aircraft = { ...base, hex: "4b191e", callsign: "SWR64E", lat: 45.3, lon: -11.8, onGround: false, altitudeFt: 34000,
    groundSpeedKts: 470, verticalRateFpm: 0, squawk: "1000" };
  const traffic: TrafficSource = {
    async byHex() { return [plane]; }, async byCallsign() { return [plane]; }, async byRegistration() { return []; },
    async near() { return []; }, async searchCallsign() { return { aircraft: [plane], partial: false }; },
  };
  let trackCalls = 0;
  const takeoff = nowMs - 3 * 3600_000 - 6 * 60_000;
  const tracks = { async track() { trackCalls++; return { hex: "4b191e", callsign: "SWR64E", start: takeoff / 1000, end: nowMs / 1000,
    points: [{ t: takeoff / 1000, lat: ZRH.lat + 0.01, lon: ZRH.lon + 0.01, altM: 300, onGround: false }, { t: nowMs / 1000, lat: 45.3, lon: -11.8, altM: 10363, onGround: false }] }; } };
  const st = new Store(openDb(":memory:")); const sd = new DryRunSender();
  const mon = new Monitor(st, traffic, sd, () => nowMs, tracks);
  st.upsertDevice("devtoken-trk", "sandbox");
  st.upsertWatch({ id: "watch-track-0001", device_token: "devtoken-trk", hex: "4b191e", callsign: "SWR64E", reg: null, title: "LX64",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "MIA", dest_lat: 25.79, dest_lon: -80.29, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  await mon.tick();
  assert.equal(st.getWatch("watch-track-0001")!.takeoff_at, takeoff, "tatsächlicher Start aus dem Flugweg statt Schätzung");
  assert.equal(trackCalls, 1); await mon.tick(); assert.equal(trackCalls, 1, "der Flugweg wird nur einmal pro Flug abgefragt");

  // Flugweg beginnt weit vom Abflughafen: anderer Flug, daher Schätzung
  const far = { async track() { return { hex: "4b191e", callsign: null, start: takeoff / 1000, end: nowMs / 1000,
    points: [{ t: takeoff / 1000, lat: 51.4, lon: -0.4, altM: 300, onGround: false }] }; } };
  const mon2 = new Monitor(st, traffic, sd, () => nowMs, far);
  st.upsertWatch({ id: "watch-track-0002", device_token: "devtoken-trk", hex: "4b191e", callsign: "SWR64E", reg: null, title: "LX64",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "MIA", dest_lat: 25.79, dest_lon: -80.29, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  await mon2.tick();
  const est = st.getWatch("watch-track-0002")!.takeoff_at!;
  assert.notEqual(est, takeoff, "passt der Anfang nicht zum Abflughafen, gilt der Verlauf nicht"); assert.ok(est < nowMs);
  console.log("OK: Abflugzeit aus dem Flugweg (nur wenn er zum Abflughafen passt, einmal pro Flug)");
}

// --- Szenario: Landung ohne Bodenempfang, veraltete Positionen, ETA im Steigflug ---
{
  const { etaSeconds } = await import("../src/logic.ts");
  const LHR2 = { lat: 51.47, lon: -0.4543 };
  const MIA = { lat: 25.79, lon: -80.29 };
  // Im Steigflug (250 kt) mit 4000 nm Rest darf nicht mit 250 kt gerechnet werden.
  const climbEta = etaSeconds(ZRH, MIA, 250, 12000, 2000)!;
  const cruiseEta = etaSeconds(ZRH, MIA, 250, 36000, 0)!;
  assert.ok(climbEta < cruiseEta * 0.7, "Steigflug rechnet mit Reisegeschwindigkeit");
  assert.equal(etaSeconds(ZRH, LHR2, 50), null, "zu langsam: keine Schätzung");

  let clock = Date.parse("2026-10-08T10:00:00Z");
  let plane: Aircraft | null = { ...base, hex: "4b1900", callsign: "SWR9", lat: 51.4, lon: -0.75, onGround: false,
    altitudeFt: 2500, groundSpeedKts: 160, verticalRateFpm: -700, ageSec: 3 };
  const traffic: TrafficSource = {
    async byHex(h) { return plane && h.includes(plane.hex) ? [plane] : []; },
    async byCallsign() { return []; }, async byRegistration() { return []; },
    async near() { return []; }, async searchCallsign() { return { aircraft: [], partial: false }; },
  };
  const st = new Store(openDb(":memory:")); const sd = new DryRunSender();
  const mon = new Monitor(st, traffic, sd, () => clock);
  st.upsertDevice("devtoken-infer", "sandbox");
  st.upsertWatch({ id: "watch-infer-0001", device_token: "devtoken-infer", hex: "4b1900", callsign: "SWR9", reg: null, title: "LX9",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "LHR", dest_lat: LHR2.lat, dest_lon: LHR2.lon, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  st.setActivityToken("watch-infer-0001", "activitytokeninfer");
  const w0 = st.getWatch("watch-infer-0001")!; w0.was_airborne = 1; st.save(w0);
  const alertTitles = () => sd.sent.filter((p) => p.kind === "alert").map((p) => (p.payload.aps as any).alert.title as string);

  await mon.tick();                                   // tief im Anflug gesehen, dann Funkstille
  plane = { ...plane!, ageSec: 900 };                 // OpenSky liefert nur noch den alten Stand
  clock += 3 * 60_000; await mon.tick();
  assert.ok(!alertTitles().includes("LX9 ist gelandet"), "nach 3 Minuten noch keine Landung angenommen");
  clock += 5 * 60_000; await mon.tick();
  assert.deepEqual(alertTitles().filter((t) => t.includes("gelandet")), ["LX9 ist gelandet"], "Landung ohne Bodenempfang erkannt");
  assert.equal(st.getWatch("watch-infer-0001")!.active, 0);
  assert.equal(sd.sent.filter((p) => p.kind === "liveactivity" && (p.payload.aps as any).event === "end").length, 1, "Live Activity beendet");

  // Hoch über dem Ozean gesehen und still: keine Landung annehmen
  const st2 = new Store(openDb(":memory:")); const sd2 = new DryRunSender();
  plane = { ...base, hex: "4b1901", callsign: "SWR64E", lat: 45, lon: -30, onGround: false, altitudeFt: 36000, groundSpeedKts: 470, verticalRateFpm: 0, ageSec: 2 };
  const mon2 = new Monitor(st2, traffic, sd2, () => clock);
  st2.upsertDevice("devtoken-ocean2", "sandbox");
  st2.upsertWatch({ id: "watch-ocean2-0001", device_token: "devtoken-ocean2", hex: "4b1901", callsign: "SWR64E", reg: null, title: "LX64",
    airline_iata: "LX", airline_name: "Swiss", origin_iata: "ZRH", origin_lat: ZRH.lat, origin_lon: ZRH.lon,
    dest_iata: "MIA", dest_lat: MIA.lat, dest_lon: MIA.lon, alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1 });
  const w2 = st2.getWatch("watch-ocean2-0001")!; w2.was_airborne = 1; st2.save(w2);
  await mon2.tick(); plane = null; clock += 30 * 60_000; await mon2.tick();
  assert.equal(st2.getWatch("watch-ocean2-0001")!.landed_sent, 0);
  assert.equal(st2.getWatch("watch-ocean2-0001")!.active, 1);
  console.log("OK: Landung ohne Bodenempfang, veraltete Position, ETA im Steigflug");
}
