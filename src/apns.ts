import { createPrivateKey, sign } from "node:crypto";
import http2 from "node:http2";
import { config, loadApnsKey } from "./config.ts";

export type PushKind = "alert" | "liveactivity";

export type PushRequest = {
  kind: PushKind;
  deviceToken: string; // bei liveactivity: Push-Token der Activity
  env: "sandbox" | "production";
  payload: Record<string, unknown>;
  priority?: 5 | 10;
  collapseId?: string;
};

export type PushResult = { ok: boolean; status: number; reason?: string; gone?: boolean };

export interface PushSender {
  send(req: PushRequest): Promise<PushResult>;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export class ApnsSender implements PushSender {
  private sessions = new Map<string, http2.ClientHttp2Session>();
  private jwt: { token: string; at: number } | null = null;
  private readonly key: ReturnType<typeof createPrivateKey>;

  constructor(pem: string) {
    this.key = createPrivateKey(pem);
  }

  private token(): string {
    if (this.jwt && Date.now() - this.jwt.at < 50 * 60_000) return this.jwt.token;
    const header = b64url(JSON.stringify({ alg: "ES256", kid: config.apns.keyId }));
    const claims = b64url(JSON.stringify({ iss: config.apns.teamId, iat: Math.floor(Date.now() / 1000) }));
    const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key: this.key, dsaEncoding: "ieee-p1363" });
    const token = `${header}.${claims}.${b64url(sig)}`;
    this.jwt = { token, at: Date.now() };
    return token;
  }

  private session(env: string): http2.ClientHttp2Session {
    const host = env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    const existing = this.sessions.get(host);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = http2.connect(host);
    s.on("error", () => this.sessions.delete(host));
    s.on("close", () => this.sessions.delete(host));
    this.sessions.set(host, s);
    return s;
  }

  send(req: PushRequest): Promise<PushResult> {
    return new Promise((resolve) => {
      const topic = req.kind === "liveactivity" ? `${config.apns.topic}.push-type.liveactivity` : config.apns.topic;
      const stream = this.session(req.env).request({
        ":method": "POST",
        ":path": `/3/device/${req.deviceToken}`,
        authorization: `bearer ${this.token()}`,
        "apns-topic": topic,
        "apns-push-type": req.kind === "liveactivity" ? "liveactivity" : "alert",
        "apns-priority": String(req.priority ?? 10),
        ...(req.collapseId ? { "apns-collapse-id": req.collapseId } : {}),
        "content-type": "application/json",
      });
      let status = 0;
      let body = "";
      stream.setTimeout(10_000, () => stream.close());
      stream.on("response", (h) => { status = Number(h[":status"] ?? 0); });
      stream.on("data", (c: Buffer) => { body += c.toString(); });
      stream.on("error", () => resolve({ ok: false, status: 0, reason: "network" }));
      stream.on("end", () => {
        const reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
        const gone = status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
        resolve({ ok: status === 200, status, reason, gone });
      });
      stream.end(JSON.stringify(req.payload));
    });
  }
}

/** Ohne APNs-Schlüssel: nichts senden, nur protokollieren. */
export class DryRunSender implements PushSender {
  readonly sent: PushRequest[] = [];
  async send(req: PushRequest): Promise<PushResult> {
    this.sent.push(req);
    console.log(`[dry-run apns] ${req.kind} → …${req.deviceToken.slice(-6)} ${JSON.stringify(req.payload).slice(0, 220)}`);
    return { ok: true, status: 200 };
  }
}

export function createSender(): PushSender {
  const pem = loadApnsKey();
  if (!pem) {
    console.warn("APNs-Schlüssel nicht konfiguriert: Dry-Run, es werden keine Pushes gesendet.");
    return new DryRunSender();
  }
  return new ApnsSender(pem);
}
