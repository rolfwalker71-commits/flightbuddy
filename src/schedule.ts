import type { PushSender } from "./apns.ts";
import { config } from "./config.ts";
import type { Store, Watch } from "./db.ts";

const DEFAULT_BASE = "https://prod.api.market/api/v1/aedbx/aerodatabox";
const H = 3600_000;

export type ScheduleStatus = "scheduled" | "cancelled" | "diverted" | "departed" | "landed" | "unknown";

export type ScheduleInfo = {
  number: string;
  rawStatus: string | null;
  status: ScheduleStatus;
  fromIata: string | null;
  toIata: string | null;
  schedDep: number | null;
  revDep: number | null;
  gate: string | null;
  terminal: string | null;
};

type Clock = string | { utc?: string; local?: string } | undefined;

/** AeroDataBox liefert «2026-10-28 11:05Z» oder {utc, local}. */
export function parseAeroTime(c: Clock): number | null {
  const raw = typeof c === "string" ? c : c?.utc;
  if (!raw) return null;
  const t = Date.parse(raw.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isNaN(t) ? null : t;
}

export function mapAeroStatus(raw: string | null | undefined): ScheduleStatus {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("divert")) return "diverted";
  if (s.includes("landed") || s.includes("arrived")) return "landed";
  if (s.includes("enroute") || s.includes("en route") || s.includes("depart") || s.includes("airborne")) return "departed";
  if (s.includes("expected") || s.includes("schedul") || s.includes("on time") || s.includes("delay") || s.includes("board")) return "scheduled";
  return "unknown";
}

type Raw = {
  number?: string; status?: string;
  departure?: { airport?: { iata?: string }; scheduledTime?: Clock; revisedTime?: Clock; predictedTime?: Clock; terminal?: string; gate?: string };
  arrival?: { airport?: { iata?: string } };
};

export function mapFlight(r: Raw): ScheduleInfo {
  const d = r.departure ?? {};
  return {
    number: (r.number ?? "").replace(/\s+/g, "").toUpperCase(),
    rawStatus: r.status ?? null,
    status: mapAeroStatus(r.status),
    fromIata: d.airport?.iata ?? null,
    toIata: r.arrival?.airport?.iata ?? null,
    schedDep: parseAeroTime(d.scheduledTime),
    revDep: parseAeroTime(d.revisedTime) ?? parseAeroTime(d.predictedTime),
    gate: d.gate?.trim() || null,
    terminal: d.terminal?.trim() || null,
  };
}

export class AeroDataBox {
  lastOk: number | null = null;
  lastError: string | null = null;
  unitsRemaining: number | null = null;
  private blockedUntil = 0;

  constructor(
    private key = config.aerodatabox.key,
    private base = config.aerodatabox.baseUrl || DEFAULT_BASE,
    private doFetch: typeof fetch = fetch,
    private now: () => number = () => Date.now(),
  ) {}

  get configured() { return !!this.key; }
  setKey(key: string) { this.key = key; this.blockedUntil = 0; this.lastError = null; this.unitsRemaining = null; }

  /** Flüge zu Flugnummer und lokalem Abflugdatum. Leere Liste heisst: noch keine Daten (zu weit voraus oder unbekannt). */
  async lookup(number: string, dateLocal: string): Promise<ScheduleInfo[]> {
    if (!this.key) throw new Error("AeroDataBox nicht konfiguriert");
    if (this.now() < this.blockedUntil) throw new Error("AeroDataBox: Pause wegen Kontingent");
    const res = await this.doFetch(`${this.base}/flights/number/${encodeURIComponent(number)}/${dateLocal}?dateLocalRole=Both`, {
      headers: { "x-api-market-key": this.key, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const left = res.headers.get("x-ratelimit-api-units-remaining") ?? res.headers.get("x-api-units-remaining");
    if (left != null && Number.isFinite(Number(left))) this.unitsRemaining = Number(left);
    if (res.status === 401 || res.status === 403) {
      this.lastError = `HTTP ${res.status}: Schlüssel ungültig oder nicht abonniert`;
      throw new Error(this.lastError);
    }
    if (res.status === 429 || res.status === 402) {
      this.blockedUntil = this.now() + 6 * H;
      this.lastError = `HTTP ${res.status}: Kontingent erschöpft`;
      throw new Error(this.lastError);
    }
    // 204/404: keine Daten. 400: meist Datum ausserhalb des Zeitraums, den der Anbieter kennt; auch das ist «noch keine Daten».
    if (res.status === 204 || res.status === 404 || res.status === 400) { this.lastOk = this.now(); this.lastError = null; return []; }
    if (!res.ok) { this.lastError = `HTTP ${res.status}`; throw new Error(this.lastError); }
    this.lastOk = this.now();
    this.lastError = null;
    const body = (await res.json()) as Raw[] | { flights?: Raw[] };
    return (Array.isArray(body) ? body : body.flights ?? []).map(mapFlight);
  }
}

const hhmm = (ms: number, tz: string) => new Date(ms).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: tz });

/** « (09:40 Heimzeit)», wenn die Heimzeitzone zur Zeit des Flughafens abweicht; sonst leer. */
export function homeSuffix(ms: number, tz: string): string {
  const home = hhmm(ms, config.displayTz);
  return home === hhmm(ms, tz) ? "" : ` (${home} Heimzeit)`;
}

/** Tag des Abflugs in der Ortszeit des Abflughafens als yyyy-mm-dd. */
export function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Abstand zwischen zwei Prüfungen: weit vor dem Abflug selten, kurz davor häufiger (schont das Kontingent). */
export function checkInterval(msToDeparture: number): number {
  const h = msToDeparture / H;
  if (h > 72) return 24 * H;
  if (h > 24) return 6 * H;
  if (h > 6) return 3 * H;
  if (h > 1) return 45 * 60_000;
  return 20 * 60_000;
}

const MAX_CALLS_PER_MONTH = () => config.aerodatabox.maxCallsPerMonth;
const STOP_AFTER_DEP_MS = 30 * 60_000;

export class ScheduleMonitor {
  private timer: NodeJS.Timeout | null = null;
  lastTick: number | null = null;

  constructor(private store: Store, private api: AeroDataBox, private push: PushSender, private now: () => number = () => Date.now()) {}

  start() { this.timer = setInterval(() => void this.tick().catch((e) => console.error("Fahrplan-Prüfung:", e)), 5 * 60_000); }
  stop() { if (this.timer) clearInterval(this.timer); }

  callsThisMonth(): number {
    return Number(this.store.getSetting(`aerodatabox.calls.${new Date(this.now()).toISOString().slice(0, 7)}`) ?? 0);
  }
  private countCall() {
    this.store.setSetting(`aerodatabox.calls.${new Date(this.now()).toISOString().slice(0, 7)}`, String(this.callsThisMonth() + 1));
  }

  async tick(): Promise<number> {
    this.lastTick = this.now();
    if (!this.api.configured) return 0;
    let checked = 0;
    for (const w of this.store.activeWatches()) {
      if (!w.flight_number || w.sched_dep == null) continue;
      if (w.sched_status === "cancelled") continue; // annullierte Flüge nicht weiter abfragen (schont das Kontingent)
      const effective = w.dep_rev ?? w.sched_dep;
      if (this.now() > Math.max(w.sched_dep, effective) + STOP_AFTER_DEP_MS) continue;
      if (this.now() < w.next_check) continue;
      if (this.callsThisMonth() >= MAX_CALLS_PER_MONTH()) { this.api.lastError = "Monatslimit der Abfragen erreicht"; return checked; }
      await this.check(w);
      checked++;
    }
    return checked;
  }

  private async check(w: Watch) {
    const now = this.now();
    const tz = w.origin_tz ?? config.displayTz;
    const info = await this.fetch(w, tz);
    w.last_check = now;
    if (info === "error") { w.next_check = now + H; this.store.saveSchedule(w); return; }
    if (!info) { w.next_check = now + Math.max(checkInterval(w.sched_dep! - now), 6 * H); this.store.saveSchedule(w); return; }

    w.sched_status = info.status;
    w.dep_rev = info.revDep;
    w.gate = info.gate;
    w.terminal = info.terminal;
    if (w.alert_schedule) await this.notify(w, info, tz);
    w.next_check = now + checkInterval((w.dep_rev ?? w.sched_dep!) - now);
    this.store.saveSchedule(w);
  }

  private async fetch(w: Watch, tz: string): Promise<ScheduleInfo | null | "error"> {
    try {
      this.countCall();
      const list = await this.api.lookup(w.flight_number!, localDate(w.sched_dep!, tz));
      const near = list.filter((f) => f.schedDep == null || Math.abs(f.schedDep - w.sched_dep!) < 12 * H);
      const sameOrigin = w.origin_iata ? near.filter((f) => f.fromIata === w.origin_iata) : near;
      const pool = sameOrigin.length ? sameOrigin : near;
      return pool.sort((a, b) => Math.abs((a.schedDep ?? 0) - w.sched_dep!) - Math.abs((b.schedDep ?? 0) - w.sched_dep!))[0] ?? null;
    } catch { return "error"; }
  }

  private async notify(w: Watch, f: ScheduleInfo, tz: string) {
    const route = w.origin_iata && w.dest_iata ? `${w.origin_iata} → ${w.dest_iata}` : "";
    const effective = f.revDep ?? w.sched_dep!;

    if ((f.status === "cancelled" || f.status === "diverted") && w.notified_status !== f.status) {
      w.notified_status = f.status;
      await this.alert(w, `${w.title} wurde ${f.status === "cancelled" ? "annulliert" : "umgeleitet"}`, route, "schedule-status");
      return;
    }
    // Verspätung: erste Meldung ab 15 Minuten, danach bei jeder weiteren Änderung ab 10 Minuten.
    const ref = w.notified_dep ?? w.sched_dep!;
    const delta = Math.round((effective - ref) / 60_000);
    if (Math.abs(delta) >= (w.notified_dep == null ? 15 : 10)) {
      w.notified_dep = effective;
      const total = Math.round((effective - w.sched_dep!) / 60_000);
      const late = total >= 0;
      await this.alert(w,
        total === 0 ? `${w.title} startet wieder planmässig` : `${w.title}: Abflug ${Math.abs(total)} Min. ${late ? "später" : "früher"}`,
        `Neu ${hhmm(effective, tz)} Uhr${homeSuffix(effective, tz)} (statt ${hhmm(w.sched_dep!, tz)})${route ? ` · ${route}` : ""}`, "schedule-delay");
    }
    if (f.gate && f.gate !== w.notified_gate) {
      const before = w.notified_gate;
      w.notified_gate = f.gate;
      await this.alert(w, before ? `${w.title}: Gate neu ${f.gate}` : `${w.title}: Gate ${f.gate}`,
        `${f.terminal ? `Terminal ${f.terminal} · ` : ""}${before ? `vorher ${before} · ` : ""}Abflug ${hhmm(effective, tz)} Uhr${homeSuffix(effective, tz)}`, "schedule-gate");
    }
  }

  private async alert(w: Watch, title: string, body: string, kind: string) {
    const device = this.store.getDevice(w.device_token);
    if (!device) return;
    const res = await this.push.send({
      kind: "alert", deviceToken: w.device_token, env: device.env, collapseId: `${w.id}-${kind}`.slice(0, 64),
      payload: {
        aps: { alert: { title, body }, sound: "default", "interruption-level": "time-sensitive", "mutable-content": 1, "thread-id": w.id },
        watchId: w.id, kind, airlineIATA: w.airline_iata, airlineName: w.airline_name,
      },
    });
    if (res.gone) this.store.deleteDevice(w.device_token);
  }
}
