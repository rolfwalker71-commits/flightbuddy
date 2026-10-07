// Prüft die Datenquellen ohne Netzwerk: OpenSky (Umrechnung, Token, Limits), Suffix-Suche, Ausweichquelle, HTTP-Schnittstellen.
import assert from "node:assert/strict";
import type { TrafficSource } from "../src/airplanes.ts";
import { DryRunSender } from "../src/apns.ts";
import { Store, openDb } from "../src/db.ts";
import { createApi } from "../src/http.ts";
import { Monitor } from "../src/monitor.ts";
import { OpenSky, matchesCallsign, toAircraft } from "../src/opensky.ts";
import { FallbackTraffic, trafficMeta } from "../src/traffic.ts";
import type { Aircraft } from "../src/logic.ts";

// 1) Echte Zeile von SWR64E (LX64) vom 07.10.2026 15:04
const row = ["4b191e", "SWR64E  ", "Switzerland", 1791378282, 1791378282, -2.9605, 46.0278, 10363.2, false, 236.74, 271.62, 0, null, 10972.8, "3046", false, 0, 6];
const a = toAircraft(row)!;
assert.equal(a.hex, "4b191e"); assert.equal(a.callsign, "SWR64E");
assert.equal(Math.round(a.altitudeFt!), 34000); assert.equal(Math.round(a.groundSpeedKts!), 460);
assert.equal(a.squawk, "3046"); assert.equal(a.onGround, false); assert.equal(a.registration, null);
assert.equal(toAircraft(["abc123", null, "x", 0, 0, null, null, 0, false, 0, 0, 0, null, 0, null, false, 0, 0]), null, "ohne Position verwerfen");
const g = toAircraft(["abc123", "TEST1   ", "x", 0, 0, 8.5, 47.4, 120, true, 5, 90, 0, null, 0, "7700", false, 0, 0])!;
assert.equal(g.altitudeFt, 0); assert.equal(g.onGround, true); assert.equal(g.squawk, "7700");
console.log("OK: OpenSky-Umrechnung (m→ft, m/s→kt)");

// 2) Suffix-Regel
assert.ok(matchesCallsign("SWR64E", "SWR64")); assert.ok(matchesCallsign("SWR64", "SWR64"));
assert.ok(!matchesCallsign("SWR640", "SWR64"), "SWR640 ist ein anderer Flug");
assert.ok(!matchesCallsign("SWR6", "SWR64")); assert.ok(!matchesCallsign(null, "SWR64"));
console.log("OK: Callsign-Suffix (SWR64 findet SWR64E, nicht SWR640)");

// 3) OpenSky-Client mit Fake-Netzwerk: Token wiederverwenden, bei 401 erneuern, bei 429 pausieren
let calls: string[] = [];
let tokenN = 0;
let mode: "ok" | "expire" | "limit" = "ok";
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url); calls.push(u);
  if (u.includes("openid-connect/token")) {
    const body = String(init?.body);
    assert.match(body, /grant_type=client_credentials/); assert.match(body, /client_id=cid/);
    tokenN++;
    return new Response(JSON.stringify({ access_token: `tok${tokenN}`, expires_in: 1800 }), { status: 200 });
  }
  const auth = (init?.headers as Record<string, string>).Authorization;
  if (mode === "expire" && auth === "Bearer tok1") return new Response("", { status: 401 });
  if (mode === "limit") return new Response("", { status: 429, headers: { "x-rate-limit-retry-after-seconds": "90" } });
  return new Response(JSON.stringify({ time: 1, states: [row] }), { status: 200, headers: { "x-rate-limit-remaining": "3990" } });
}) as typeof fetch;
let clock = 0;
const os = new OpenSky("cid", "secret", fakeFetch, () => clock);
assert.equal((await os.byHex(["4b191e", "3c6444"])).length, 1);
assert.ok(calls.some((c) => c.includes("icao24=4b191e&icao24=3c6444")), "mehrere icao24 in einer Abfrage");
await os.byHex(["4b191e"]);
assert.equal(tokenN, 1, "Token muss wiederverwendet werden");
assert.equal(os.creditsRemaining, 3990);
mode = "expire"; clock += 1_900_000; // Token abgelaufen
await os.byHex(["4b191e"]);
assert.equal(tokenN, 2, "abgelaufener Token wird erneuert");
mode = "expire"; (os as any).token = { value: "tok1", expiresAt: clock + 1e9 }; // Server meldet 401 trotz gültiger Laufzeit
assert.equal((await os.byHex(["4b191e"])).length, 1); assert.equal(tokenN, 3, "bei 401 einmal neu anmelden");
mode = "limit";
await assert.rejects(() => os.byHex(["4b191e"]), /429/);
const before = calls.length;
await assert.rejects(() => os.byHex(["4b191e"]), /Pause/); assert.equal(calls.length, before, "während der Pause keine Abfrage");
clock += 91_000; mode = "ok";
assert.equal((await os.byHex(["4b191e"])).length, 1, "nach der Pause wieder möglich");
const noCreds = new OpenSky("", "", fakeFetch);
await assert.rejects(() => noCreds.byHex(["4b191e"]), /nicht konfiguriert/);
console.log("OK: OpenSky-Token (wiederverwenden, erneuern, 401, 429-Pause)");

// 4) Globale Suche: ein Schnappschuss für mehrere Suchen, Suffix-tolerant
calls = []; mode = "ok";
const os2 = new OpenSky("cid", "secret", fakeFetch, () => clock);
const r1 = await os2.searchCallsign("swr64"); const r2 = await os2.searchCallsign("SWR64");
assert.equal(r1.aircraft[0]?.callsign, "SWR64E"); assert.equal(r2.aircraft.length, 1);
assert.equal(calls.filter((c) => c.includes("/states/all")).length, 1, "ein globaler Abruf, danach Cache");
console.log("OK: OpenSky-Suche SWR64 → SWR64E mit einem Abruf");

// 5) Ausweichquelle: Fehler → zweite Quelle, leeres Ergebnis bleibt leer
const plane: Aircraft = { ...a, registration: "HB-JNI", type: "B77W" };
const failing: TrafficSource = { byHex: async () => { throw new Error("403"); }, byCallsign: async () => { throw new Error("403"); },
  byRegistration: async () => { throw new Error("403"); }, near: async () => { throw new Error("403"); }, searchCallsign: async () => { throw new Error("403"); } };
const working: TrafficSource = { byHex: async () => [plane], byCallsign: async () => [plane], byRegistration: async () => [],
  near: async () => [plane], searchCallsign: async () => ({ aircraft: [plane], partial: false }) };
const empty: TrafficSource = { ...working, byCallsign: async () => [] };
const fb = new FallbackTraffic(failing, working);
assert.equal((await fb.byHex(["4b191e"]))[0]?.hex, "4b191e"); assert.equal(fb.lastUsed, "secondary");
assert.equal((await new FallbackTraffic(empty, working).byCallsign("X")).length, 0, "leeres Ergebnis ist kein Fehler");
await assert.rejects(() => new FallbackTraffic(failing, failing).byHex(["a"]), /403.*Ausweichquelle: 403/, "beide Gründe nennen");
// Registration-Suche über OpenSky ist ein Fehler mit Erklärung, keine leere Liste
await assert.rejects(() => new FallbackTraffic(failing, new OpenSky("cid", "secret", fakeFetch, () => clock)).byRegistration("G-TNEF"), /Registration/);
await assert.rejects(() => new OpenSky("cid", "secret", fakeFetch, () => clock).byRegistration("G-TNEF"), /nicht nach Registration/);
console.log("OK: Ausweichquelle bei Fehlern");

// 6) HTTP-Schnittstellen
process.env.API_TOKEN = "t";
const { config } = await import("../src/config.ts"); config.apiToken = "t";
const store = new Store(openDb(":memory:"));
const sender = new DryRunSender();
const mon = new Monitor(store, working, sender);
const osApi = new OpenSky("", "", (async (url: string | URL | Request, init?: RequestInit) => {
  if (String(url).includes("openid-connect/token")) {
    return String(init?.body).includes("client_id=good") ? new Response(JSON.stringify({ access_token: "t", expires_in: 1800 })) : new Response("", { status: 401 });
  }
  return new Response(JSON.stringify({ states: [] }));
}) as typeof fetch);
const server = createApi(store, mon, { source: "test", airplanes: null, opensky: osApi }, sender, working);
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const get = (p: string, auth = true) => fetch(`http://127.0.0.1:${port}${p}`, { headers: auth ? { Authorization: "Bearer t" } : {} });
assert.equal((await get("/v1/resolve?q=SWR64", false)).status, 401);
const res = await (await get("/v1/resolve?q=swr64")).json() as any;
assert.equal(res.aircraft[0].callsign, "SWR64E"); assert.equal(res.aircraft[0].registration, "HB-JNI"); assert.equal(res.partial, false);
assert.equal((await (await get("/v1/resolve?q=4b191e")).json() as any).aircraft[0].hex, "4b191e");
assert.equal((await get("/v1/resolve?q=%3Cscript%3E")).status, 400);
const near = await (await get("/v1/traffic/near?lat=47.4&lon=8.5&radius=50")).json() as any;
assert.equal(near.aircraft.length, 1); assert.equal(near.source, "airplanes"); assert.equal(near.refreshSeconds, 10);
// Antwortet die Ausweichquelle OpenSky, soll die App seltener fragen (Tageskontingent)
const fbTraffic = new FallbackTraffic(failing, working);
await fbTraffic.near(47, 8, 50);
assert.deepEqual(trafficMeta(fbTraffic, "auto"), { source: "opensky", refreshSeconds: 30 });
assert.deepEqual(trafficMeta(working, "opensky"), { source: "opensky", refreshSeconds: 30 });
assert.equal((await get("/v1/traffic/near?lat=999&lon=8&radius=50")).status, 400);
assert.equal((await get("/v1/traffic/hex/zzzzzz")).status, 400);
const health = await (await get("/v1/health", false)).json() as any;
assert.equal(health.traffic.source, "test");
// OpenSky-Zugangsdaten aus der App: prüfen, speichern, nie zurückgeben
const put = (body: unknown) => fetch(`http://127.0.0.1:${port}/v1/settings/opensky`, { method: "PUT", headers: { Authorization: "Bearer t" }, body: JSON.stringify(body) });
assert.equal(osApi.configured, false);
assert.equal((await put({ clientId: "bad", clientSecret: "wrong" })).status, 400, "falsche Daten ablehnen");
assert.equal(osApi.configured, false, "falsche Daten dürfen nicht übernommen werden");
assert.equal(store.getSetting("opensky.clientId"), undefined);
assert.equal((await put({ clientId: "has space", clientSecret: "x" })).status, 400);
assert.equal((await put({ clientId: "good", clientSecret: "s3cret" })).status, 200);
assert.equal(osApi.configured, true); assert.equal(osApi.source, "app");
assert.equal(store.getSetting("opensky.clientSecret"), "s3cret");
const h2 = JSON.stringify(await (await get("/v1/health", false)).json());
assert.ok(h2.includes('"configured":true') && !h2.includes("s3cret") && !h2.includes("good"), "Health darf keine Zugangsdaten enthalten");
assert.equal((await put({ clientId: "bad", clientSecret: "wrong" })).status, 400);
assert.equal(osApi.configured, true, "funktionierende Daten bleiben nach falscher Eingabe erhalten");
assert.equal((await fetch(`http://127.0.0.1:${port}/v1/settings/opensky`, { method: "DELETE", headers: { Authorization: "Bearer t" } })).status, 200);
assert.equal(osApi.configured, false); assert.equal(store.getSetting("opensky.clientId"), undefined);
assert.equal((await fetch(`http://127.0.0.1:${port}/v1/settings/opensky`, { method: "PUT", body: "{}" })).status, 401);
server.close();
console.log("OK: OpenSky-Zugangsdaten per App: prüfen, speichern, nie zurückgeben, löschen");
console.log("OK: HTTP /v1/resolve, /v1/traffic/*, Health, Eingabeprüfung");
process.exit(0);
