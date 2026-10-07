import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AirplanesLive } from "./airplanes.ts";
import { config } from "./config.ts";
import type { Store } from "./db.ts";
import type { PushSender } from "./apns.ts";
import type { Monitor } from "./monitor.ts";

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

export function createApi(store: Store, monitor: Monitor, airplanes: AirplanesLive | null, push: PushSender): Server {
  return createServer(async (req, res) => {
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
          airplanes: airplanes ? { lastOk: airplanes.lastOk, lastError: airplanes.lastError } : null,
        });
      }
      if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

      if (req.method === "PUT" && path === "/v1/devices") {
        const b = await readJson(req);
        const token = str(b.deviceToken, 200);
        if (!token || !/^[0-9a-f]+$/i.test(token)) return json(res, 400, { error: "deviceToken" });
        store.upsertDevice(token, b.environment === "sandbox" ? "sandbox" : "production");
        return json(res, 200, { ok: true });
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
            alert_squawk: flag(a.squawk), alert_takeoff: flag(a.takeoff), alert_landing: flag(a.landing), alert_approach: flag(a.approach),
          });
          return json(res, 200, { ok: true });
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
