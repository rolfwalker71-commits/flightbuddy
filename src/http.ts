import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AirplanesLive, TrafficSource } from "./airplanes.ts";
import type { OpenSky } from "./opensky.ts";
import { toPublic, trafficMeta } from "./traffic.ts";
import { localDate } from "./schedule.ts";
import { config } from "./config.ts";
import type { Store } from "./db.ts";
import type { PushSender } from "./apns.ts";
import type { Monitor } from "./monitor.ts";
import type { AeroDataBox, ScheduleMonitor } from "./schedule.ts";

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64_000) throw new Error("payload too large");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const str = (v: unknown, max = 64): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const flag = (v: unknown, d = 1): number => (typeof v === "boolean" ? (v ? 1 : 0) : d);

function authorized(req: IncomingMessage): boolean {
  if (!config.apiToken) return false; // ohne API_TOKEN lehnt der Server alles ausser /health ab
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
  const want = Buffer.from(config.apiToken);
  return given.length === want.length && timingSafeEqual(given, want);
}

type TrafficInfo = { source: string; airplanes: AirplanesLive | null; opensky: OpenSky | null; aero?: AeroDataBox; schedule?: ScheduleMonitor };

function validTz(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > 64) return null;
  try { new Intl.DateTimeFormat("de-CH", { timeZone: v }); return v; } catch { return null; }
}

export function createApi(store: Store, monitor: Monitor, info: TrafficInfo, push: PushSender, traffic: TrafficSource): Server {
  const airplanes = info.airplanes;
  // Kurzer Cache: Karte und Suche der App sollen die Quelle (Limit bzw. Credits) nicht mehrfach belasten.
  const cache = new Map<string, { at: number; data: unknown }>();
  const cached = async <T,>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > ttlMs) cache.delete(k);
    return data;
  };
  return createServer(async (req, res) => {
    // Eine Protokollzeile pro Anfrage der App (ohne Token): so lässt sich sehen, ob und was die App abfragt.
    const started = Date.now();
    res.on("finish", () => {
      const u = new URL(req.url ?? "/", "http://x");
      if (u.pathname === "/v1/health") return;
      const q = u.pathname.startsWith("/v1/resolve") || u.pathname.startsWith("/v1/traffic") ? u.search : "";
      console.log(`${new Date().toISOString()} ${req.method} ${u.pathname}${q} → ${res.statusCode} ${Date.now() - started} ms`);
    });
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;

      if (req.method === "GET" && path === "/v1/health") {
        return json(res, 200, {
          ok: true,
          apiTokenConfigured: !!config.apiToken,
          lastTick: monitor.lastTick,
          monitorError: monitor.lastError,
          apns: push.info,
          watches: store.activeWatches().length,
          airplanes: airplanes ? { lastOk: airplanes.lastOk, lastError: airplanes.lastError } : { demo: info.source === "demo" },
          schedule: info.aero ? {
            configured: info.aero.configured, lastOk: info.aero.lastOk, lastError: info.aero.lastError,
            callsThisMonth: info.schedule?.callsThisMonth() ?? 0, unitsRemaining: info.aero.unitsRemaining,
          } : null,
          traffic: {
            source: info.source,
            opensky: info.opensky
              ? { configured: info.opensky.configured, source: info.opensky.source, lastOk: info.opensky.lastOk, lastError: info.opensky.lastError, credits: info.opensky.creditsRemaining }
              : null,
          },
        });
      }
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

      if (req.method === "PUT" && path === "/v1/devices") {
        const b = await readJson(req);
        const token = str(b.deviceToken, 200);
        if (!token || !/^[0-9a-f]+$/i.test(token)) return json(res, 400, { error: "deviceToken" });
        store.upsertDevice(token, b.environment === "sandbox" ? "sandbox" : "production");
        const startToken = str(b.pushToStartToken, 400);
        if (startToken && /^[0-9a-f]+$/i.test(startToken)) store.setStartToken(token, startToken);
        return json(res, 200, { ok: true });
      }

      // --- OpenSky-Zugangsdaten aus der App (nur schreibend: der Server gibt das Secret nie zurück) ---
      if (path === "/v1/settings/opensky" && info.opensky) {
        const os = info.opensky;
        if (req.method === "PUT") {
          const b = await readJson(req);
          const id = typeof b.clientId === "string" ? b.clientId.trim() : "";
          const secret = typeof b.clientSecret === "string" ? b.clientSecret.trim() : "";
          if (!id || !secret || id.length > 200 || secret.length > 200 || /\s/.test(id + secret)) return json(res, 400, { error: "clientId und clientSecret erforderlich (ohne Leerzeichen)" });
          const prev = { id: store.getSetting("opensky.clientId"), secret: store.getSetting("opensky.clientSecret"), source: os.source };
          os.setCredentials(id, secret, "app");
          try {
            await os.verify();
          } catch (e) {
            // Zurück zum bisherigen Stand: falsche Eingaben dürfen funktionierende Daten nicht überschreiben.
            if (prev.id && prev.secret) os.setCredentials(prev.id, prev.secret, "app");
            else os.setCredentials(config.opensky.clientId, config.opensky.clientSecret, config.opensky.clientId ? "env" : null);
            return json(res, 400, { error: e instanceof Error ? e.message : "OpenSky lehnt die Zugangsdaten ab" });
          }
          store.setSetting("opensky.clientId", id);
          store.setSetting("opensky.clientSecret", secret);
          return json(res, 200, { ok: true, configured: true, source: "app" });
        }
        if (req.method === "DELETE") {
          store.deleteSetting("opensky.clientId"); store.deleteSetting("opensky.clientSecret");
          os.setCredentials(config.opensky.clientId, config.opensky.clientSecret, config.opensky.clientId ? "env" : null);
          return json(res, 200, { ok: true, configured: os.configured, source: os.source });
        }
      }

      // --- AeroDataBox-Schlüssel aus der App (nur schreibend; Verspätung, Gate, Annullierung) ---
      if (path === "/v1/settings/aerodatabox" && info.aero) {
        const aero = info.aero;
        if (req.method === "PUT") {
          const b = await readJson(req);
          const key = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
          if (!key || key.length > 200 || /\s/.test(key)) return json(res, 400, { error: "apiKey erforderlich (ohne Leerzeichen)" });
          const prev = store.getSetting("aerodatabox.key") ?? config.aerodatabox.key;
          aero.setKey(key);
          try {
            // Eine einzige Abfrage prüft den Schlüssel: 401/403 heisst ungültig, «keine Daten» heisst gültig.
            await aero.lookup("LX1", localDate(Date.now(), config.displayTz));
          } catch (e) {
            aero.setKey(prev);
            return json(res, 400, { error: e instanceof Error ? e.message : "AeroDataBox lehnt den Schlüssel ab" });
          }
          store.setSetting("aerodatabox.key", key);
          return json(res, 200, { ok: true, configured: true });
        }
        if (req.method === "DELETE") {
          store.deleteSetting("aerodatabox.key");
          aero.setKey(config.aerodatabox.key);
          return json(res, 200, { ok: true, configured: aero.configured });
        }
      }

      // --- Verkehr für die App (das iPhone hat keinen direkten Zugang zu airplanes.live) ---
      if (req.method === "GET" && path.startsWith("/v1/traffic/")) {
        const [, , , kind, rest = ""] = path.split("/");
        const arg = decodeURIComponent(rest);
        let list;
        if (kind === "near") {
          const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
          const radius = Math.min(250, Math.max(1, Number(url.searchParams.get("radius") ?? 50)));
          if (![lat, lon, radius].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(res, 400, { error: "lat/lon/radius" });
          list = await cached(`near:${lat.toFixed(1)}:${lon.toFixed(1)}:${Math.round(radius / 10)}`, 5_000, () => traffic.near(lat, lon, radius));
        } else if (kind === "hex" && /^[0-9a-f]{6}$/i.test(arg)) {
          list = await cached(`hex:${arg}`, 4_000, () => traffic.byHex([arg]));
        } else if (kind === "reg" && /^[A-Za-z0-9-]{2,12}$/.test(arg)) {
          list = await cached(`reg:${arg.toUpperCase()}`, 4_000, () => traffic.byRegistration(arg));
        } else if (kind === "callsign" && /^[A-Za-z0-9]{2,10}$/.test(arg)) {
          list = await cached(`cs:${arg.toUpperCase()}`, 4_000, async () => (await traffic.byCallsign(arg)));
        } else return json(res, 400, { error: "unbekannte Abfrage" });
        return json(res, 200, { aircraft: list.map(toPublic), ...trafficMeta(traffic, info.source) });
      }

      if (req.method === "GET" && path === "/v1/resolve") {
        const q = (url.searchParams.get("q") ?? "").trim().toUpperCase().replace(/\s+/g, "");
        if (!/^[A-Z0-9-]{2,12}$/.test(q)) return json(res, 400, { error: "q" });
        const result = await cached(`resolve:${q}`, 20_000, async () => {
          if (/^[0-9A-F]{6}$/.test(q) && /\d/.test(q) && !/^[A-Z]{3}\d/.test(q)) return { aircraft: await traffic.byHex([q.toLowerCase()]), partial: false };
          if (q.includes("-")) return { aircraft: await traffic.byRegistration(q), partial: false };
          return traffic.searchCallsign(q);
        });
        return json(res, 200, { aircraft: result.aircraft.map(toPublic), partial: result.partial });
      }

      if (req.method === "POST" && path === "/v1/test-push") {
        const b = await readJson(req);
        const token = str(b.deviceToken, 200);
        if (!token || !/^[0-9a-f]+$/i.test(token)) return json(res, 400, { error: "deviceToken" });
        const env = b.environment === "sandbox" ? "sandbox" : b.environment === "production" ? "production" : (store.getDevice(token)?.env ?? "production");
        const result = await push.send({
          kind: "alert", deviceToken: token, env, collapseId: "test-push",
          payload: {
            aps: { alert: { title: str(b.title, 60) ?? "FlightBuddy Test", body: str(b.body, 150) ?? "Push-Verbindung funktioniert." },
                   sound: "default", "mutable-content": 1 },
            kind: "test", airlineIATA: str(b.airlineIATA, 3), airlineName: str(b.airlineName, 80),
          },
        });
        // Apple-Antwort 1:1 durchreichen, damit Fehler wie BadDeviceToken / TopicDisallowed sichtbar sind.
        return json(res, 200, { dryRun: push.info.mode === "dry-run", environment: env, ...result });
      }

      const m = path.match(/^\/v1\/watches\/([A-Za-z0-9-]{8,64})(\/live-activity)?$/);
      if (m) {
        const id = m[1]!;
        if (m[2]) {
          if (req.method === "PUT") {
            const token = str((await readJson(req)).pushToken, 400);
            if (!token || !store.getWatch(id)) return json(res, 400, { error: "pushToken or unknown watch" });
            store.setActivityToken(id, token);
            return json(res, 200, { ok: true });
          }
          if (req.method === "DELETE") {
            store.setActivityToken(id, null);
            return json(res, 200, { ok: true });
          }
        } else if (req.method === "PUT") {
          const b = await readJson(req);
          const device = str(b.deviceToken, 200);
          const title = str(b.title, 40);
          if (!device || !title || !store.getDevice(device)) return json(res, 400, { error: "deviceToken (nicht registriert) and title required" });
          const hex = str(b.hex, 6)?.toLowerCase() ?? null;
          const callsign = str(b.callsign, 10)?.toUpperCase() ?? null;
          const reg = str(b.registration, 12)?.toUpperCase() ?? null;
          if (!hex && !callsign && !reg) return json(res, 400, { error: "hex, callsign or registration required" });
          const o = (b.origin ?? {}) as Record<string, unknown>;
          const d = (b.destination ?? {}) as Record<string, unknown>;
          const a = (b.alerts ?? {}) as Record<string, unknown>;
          store.upsertWatch({
            id, device_token: device, hex, callsign, reg, title,
            airline_iata: str(b.airlineIATA, 3), airline_name: str(b.airlineName, 80),
            origin_iata: str(o.iata, 3), origin_lat: num(o.lat), origin_lon: num(o.lon),
            dest_iata: str(d.iata, 3), dest_lat: num(d.lat), dest_lon: num(d.lon),
            sched_dep: (() => { const t = num(b.scheduledDeparture); return t != null && t > 1e9 && t < 4e9 ? Math.round(t * 1000) : null; })(),
            origin_tz: validTz(o.tz), dest_tz: validTz(d.tz),
            flight_number: (() => { const n = str(b.flightNumber, 10)?.toUpperCase().replace(/[^A-Z0-9]/g, ""); return n && /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(n) ? n : null; })(),
            alert_reminder: flag(a.reminder), alert_schedule: flag(a.schedule),
            alert_squawk: flag(a.squawk), alert_takeoff: flag(a.takeoff), alert_landing: flag(a.landing), alert_approach: flag(a.approach),
          });
          return json(res, 200, { ok: true });
        } else if (req.method === "GET") {
          const w = store.getWatch(id);
          if (!w) return json(res, 404, { error: "unbekannt" });
          const dep = w.dep_rev ?? w.sched_dep;
          return json(res, 200, {
            flightNumber: w.flight_number, status: w.sched_status, gate: w.gate, terminal: w.terminal,
            scheduledDeparture: w.sched_dep, revisedDeparture: w.dep_rev,
            delayMinutes: w.sched_dep != null && dep != null ? Math.round((dep - w.sched_dep) / 60_000) : null,
            checkedAt: w.last_check,
          });
        } else if (req.method === "DELETE") {
          store.deleteWatch(id);
          return json(res, 200, { ok: true });
        }
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : "bad request" });
    }
  });
}
