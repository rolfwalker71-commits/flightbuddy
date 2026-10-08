// Prüft die Fahrplan-Anbindung (AeroDataBox) ohne Netzwerk: Zeiten, Status, Taktung, Meldungen, Sicherungen, Schnittstellen.
import assert from "node:assert/strict";
import { DryRunSender } from "../src/apns.ts";
import { config } from "../src/config.ts";
import { Store, openDb } from "../src/db.ts";
import { createApi } from "../src/http.ts";
import { Monitor } from "../src/monitor.ts";
import { AeroDataBox, ScheduleMonitor, checkInterval, localDate, mapAeroStatus, parseAeroTime } from "../src/schedule.ts";

const H = 3600_000;
const dep = Date.parse("2026-10-28T12:05:00Z"); // 13:05 Uhr in Zürich (Winterzeit)

// 1) Hilfsfunktionen
assert.equal(parseAeroTime("2026-10-28 12:05Z"), dep);
assert.equal(parseAeroTime({ utc: "2026-10-28 12:05Z", local: "x" }), dep);
assert.equal(parseAeroTime(undefined), null);
assert.equal(mapAeroStatus("Canceled"), "cancelled"); assert.equal(mapAeroStatus("CanceledUncertain"), "cancelled");
assert.equal(mapAeroStatus("Diverted"), "diverted"); assert.equal(mapAeroStatus("Arrived"), "landed");
assert.equal(mapAeroStatus("EnRoute"), "departed"); assert.equal(mapAeroStatus("Expected"), "scheduled");
assert.equal(localDate(Date.parse("2026-10-27T23:30:00Z"), "Europe/Zurich"), "2026-10-28", "Datum in Ortszeit, nicht UTC");
assert.equal(checkInterval(100 * H), 24 * H); assert.equal(checkInterval(30 * H), 6 * H);
assert.equal(checkInterval(10 * H), 3 * H); assert.equal(checkInterval(3 * H), 45 * 60_000); assert.equal(checkInterval(0.5 * H), 20 * 60_000);
console.log("OK: Fahrplan-Hilfsfunktionen (Zeitformat, Status, Ortsdatum, Takt)");

// 2) Fake-AeroDataBox
type Resp = { status: number; body?: unknown };
let reply: Resp = { status: 200, body: [] };
let requests: string[] = [];
const flight = (over: Record<string, unknown> = {}, dp: Record<string, unknown> = {}) => ({
  number: "LX 64", status: "Expected", airline: { name: "Swiss" },
  departure: { airport: { iata: "ZRH" }, scheduledTime: { utc: "2026-10-28 12:05Z" }, revisedTime: { utc: "2026-10-28 12:05Z" }, ...dp },
  arrival: { airport: { iata: "MIA" } }, ...over,
});
const fakeFetch = (async (url: string | URL | Request) => {
  requests.push(String(url));
  return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "x-ratelimit-api-units-remaining": "570" } });
}) as typeof fetch;
let clock = dep - 30 * H;
const now = () => clock;

const store = new Store(openDb(":memory:"));
const sender = new DryRunSender();
const api = new AeroDataBox("key", "https://x.test", fakeFetch, now);
const sm = new ScheduleMonitor(store, api, sender, now);
store.upsertDevice("devtoken-sched", "sandbox");
const mk = (id: string, over: Record<string, unknown> = {}) => store.upsertWatch({
  id, device_token: "devtoken-sched", hex: null, callsign: "SWR64", reg: null, title: "LX64", airline_iata: "LX", airline_name: "Swiss",
  origin_iata: "ZRH", origin_lat: 47.46, origin_lon: 8.55, dest_iata: "MIA", dest_lat: 25.79, dest_lon: -80.29,
  alert_squawk: 1, alert_takeoff: 1, alert_landing: 1, alert_approach: 1, sched_dep: dep, origin_tz: "Europe/Zurich", dest_tz: "America/New_York",
  flight_number: "LX64", alert_reminder: 1, alert_schedule: 1, ...over });
const alerts = () => sender.sent.filter((p) => p.kind === "alert").map((p) => (p.payload.aps as any).alert as { title: string; body: string });

mk("watch-sched-0001");
reply = { status: 200, body: [flight()] };
assert.equal(await sm.tick(), 1, "erste Prüfung sofort");
assert.match(requests[0]!, /\/flights\/number\/LX64\/2026-10-28\?dateLocalRole=Both$/, "Flugnummer ohne Leerzeichen, Datum in Ortszeit");
assert.equal(alerts().length, 0, "planmässiger Flug: keine Meldung");
assert.equal(await sm.tick(), 0, "nicht fällig: keine Abfrage");
assert.equal(store.getWatch("watch-sched-0001")!.next_check, clock + 6 * H, "30 Stunden vorher: alle 6 Stunden");

// 3) Verspätung: erste Meldung ab 15 Min., danach ab 10 Min. Änderung
clock += 6 * H;
reply = { status: 200, body: [flight({}, { revisedTime: { utc: "2026-10-28 12:30Z" } })] };
await sm.tick();
assert.equal(alerts().length, 1); assert.equal(alerts()[0]!.title, "LX64: Abflug 25 Min. später");
assert.match(alerts()[0]!.body, /Neu 13:30 Uhr \(statt 13:05\) · ZRH → MIA/);
clock += 6 * H; await sm.tick();
assert.equal(alerts().length, 1, "gleiche Verspätung nicht noch einmal melden");
clock += 3 * H; reply = { status: 200, body: [flight({}, { revisedTime: { utc: "2026-10-28 12:45Z" } })] }; await sm.tick();
assert.equal(alerts().length, 2); assert.equal(alerts()[1]!.title, "LX64: Abflug 40 Min. später");
clock += 3 * H; reply = { status: 200, body: [flight({}, { revisedTime: { utc: "2026-10-28 12:50Z" } })] }; await sm.tick();
assert.equal(alerts().length, 2, "5 Minuten Änderung ist keine Meldung wert");
console.log("OK: Verspätungsmeldung (ab 15 Min., danach ab 10 Min. Änderung, keine Wiederholung)");

// 4) Gate: erstmalig, dann Wechsel
clock = dep - 8 * H; reply = { status: 200, body: [flight({}, { revisedTime: { utc: "2026-10-28 12:50Z" }, gate: "B42", terminal: "1" })] }; await sm.tick();
assert.equal(alerts().at(-1)!.title, "LX64: Gate B42"); assert.match(alerts().at(-1)!.body, /Terminal 1 · Abflug 13:50 Uhr/);
const n = alerts().length;
clock = dep - 5 * H; await sm.tick(); assert.equal(alerts().length, n, "gleiches Gate: keine Meldung");
clock = dep - 3 * H; reply = { status: 200, body: [flight({}, { revisedTime: { utc: "2026-10-28 12:50Z" }, gate: "B44", terminal: "1" })] }; await sm.tick();
assert.equal(alerts().at(-1)!.title, "LX64: Gate neu B44"); assert.match(alerts().at(-1)!.body, /vorher B42/);
console.log("OK: Gate-Meldung (erste Zuteilung, Wechsel, keine Wiederholung)");

// 5) Annullierung genau einmal
clock = dep - 2 * H; reply = { status: 200, body: [flight({ status: "Canceled" })] }; await sm.tick();
assert.equal(alerts().at(-1)!.title, "LX64 wurde annulliert");
const m = alerts().length; requests = []; clock = dep - 1 * H; await sm.tick(); assert.equal(alerts().length, m); assert.equal(requests.length, 0, "annulliert: keine weiteren Abfragen");
assert.equal(store.getWatch("watch-sched-0001")!.sched_status, "cancelled");
console.log("OK: Annullierung wird einmal gemeldet");

// 6) Abbruch nach dem Abflug, andere Szenarien
clock = dep + 90 * 60_000; requests = []; await sm.tick(); assert.equal(requests.length, 0, "nach dem Abflug keine Abfragen mehr");

clock = dep - 30 * H; sender.sent.length = 0; requests = [];
mk("watch-sched-0002", { alert_schedule: 0 });
reply = { status: 200, body: [flight({}, { revisedTime: { utc: "2026-10-28 13:30Z" }, gate: "A1" })] };
await sm.tick();
assert.equal(alerts().length, 0, "Schalter aus: keine Meldung");
assert.equal(store.getWatch("watch-sched-0002")!.gate, "A1", "Zustand wird trotzdem gespeichert");

clock = dep - 40 * H; mk("watch-sched-0003");
reply = { status: 204 };
requests = []; await sm.tick();
assert.ok(store.getWatch("watch-sched-0003")!.next_check >= clock + 6 * H, "keine Daten: höchstens alle 6 Stunden nachfragen");

reply = { status: 500 }; clock += 7 * H; await sm.tick();
assert.ok(store.getWatch("watch-sched-0003")!.next_check <= clock + H, "Fehler: in einer Stunde erneut versuchen");
console.log("OK: Schalter aus, keine Daten, Serverfehler");

// 7) Falscher Abflughafen wird ignoriert
mk("watch-sched-0004");
reply = { status: 200, body: [flight({}, { airport: { iata: "GVA" }, gate: "Z9" }), flight({}, { gate: "B1" })] };
clock = dep - 25 * H; await sm.tick();
assert.equal(store.getWatch("watch-sched-0004")!.gate, "B1", "gleicher Abflughafen hat Vorrang");

// 8) Monatslimit
store.setSetting(`aerodatabox.calls.${new Date(clock).toISOString().slice(0, 7)}`, String(config.aerodatabox.maxCallsPerMonth));
mk("watch-sched-0005"); requests = []; reply = { status: 200, body: [] };
assert.equal(await sm.tick(), 0); assert.equal(requests.length, 0, "Monatslimit stoppt die Abfragen");
assert.match(api.lastError ?? "", /Monatslimit/);
console.log("OK: Auswahl nach Abflughafen und Monatslimit");

// 9) Schnittstellen: Schlüssel prüfen, Status abrufen, Health
config.apiToken = "t";
let keyOk = true;
const api2 = new AeroDataBox("", "https://x.test", (async (_u: string | URL | Request, init?: RequestInit) => {
  const k = (init?.headers as Record<string, string>)["x-api-market-key"];
  return new Response(k === "good" ? "[]" : "", { status: k === "good" ? 200 : 401 });
}) as typeof fetch, now);
const sm2 = new ScheduleMonitor(store, api2, sender, now);
const mon = new Monitor(store, { byHex: async () => [], byCallsign: async () => [], byRegistration: async () => [], near: async () => [], searchCallsign: async () => ({ aircraft: [], partial: false }) }, sender, now);
const server = createApi(store, mon, { source: "test", airplanes: null, opensky: null, aero: api2, schedule: sm2 }, sender, { byHex: async () => [], byCallsign: async () => [], byRegistration: async () => [], near: async () => [], searchCallsign: async () => ({ aircraft: [], partial: false }) });
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const call = (method: string, path: string, body?: unknown, auth = true) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: auth ? { Authorization: "Bearer t" } : {}, body: body ? JSON.stringify(body) : undefined });
assert.equal((await call("PUT", "/v1/settings/aerodatabox", { apiKey: "bad" })).status, 400, "ungültiger Schlüssel wird abgelehnt");
assert.equal(api2.configured, false);
assert.equal((await call("PUT", "/v1/settings/aerodatabox", { apiKey: "good" })).status, 200);
assert.equal(api2.configured, true); assert.equal(store.getSetting("aerodatabox.key"), "good");
const health = JSON.stringify(await (await call("GET", "/v1/health", undefined, false)).json());
assert.ok(health.includes('"schedule":{"configured":true') && !health.includes("good"), "Health zeigt Zustand, nie den Schlüssel");
assert.equal((await call("PUT", "/v1/settings/aerodatabox", { apiKey: "bad" })).status, 400);
assert.equal(api2.configured, true, "funktionierender Schlüssel bleibt nach falscher Eingabe");
assert.equal((await call("PUT", "/v1/settings/aerodatabox", { apiKey: "x" }, false)).status, 401);
const st = await (await call("GET", "/v1/watches/watch-sched-0001")).json() as any;
assert.equal(st.flightNumber, "LX64"); assert.equal(st.status, "cancelled"); assert.equal(st.gate, null, "letzte Antwort hatte kein Gate"); assert.equal(st.delayMinutes, 0);
assert.equal((await call("GET", "/v1/watches/watch-unknown-9999")).status, 404);
assert.equal((await call("DELETE", "/v1/settings/aerodatabox")).status, 200); assert.equal(api2.configured, false);
server.close();
console.log("OK: AeroDataBox-Schnittstellen (Schlüssel prüfen, Status, Health ohne Geheimnisse)");
void keyOk;
// Ankunftsprognose: revised vor predicted vor geplant; unterwegs stündlich prüfen
{
  const { mapFlight } = await import("../src/schedule.ts");
  const f = mapFlight({ number: "LX 64", status: "EnRoute", departure: { scheduledTime: "2026-10-28 12:05Z" },
    arrival: { airport: { iata: "MIA" }, scheduledTime: { utc: "2026-10-28 23:00Z" }, predictedTime: { utc: "2026-10-28 23:25Z" } } });
  assert.equal(f.revArr, Date.parse("2026-10-28T23:25:00Z"));
  assert.equal(mapFlight({ arrival: { scheduledTime: "2026-10-28 23:00Z" } }).revArr, Date.parse("2026-10-28T23:00:00Z"));
  assert.equal(mapFlight({}).revArr, null);
  assert.equal(checkInterval(-5 * 60_000), 3600_000);
  console.log("OK: Ankunftsprognose (AeroDataBox)");
}
process.exit(0);

