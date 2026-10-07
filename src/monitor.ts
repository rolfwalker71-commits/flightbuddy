import type { TrafficSource } from "./airplanes.ts";
import type { PushSender } from "./apns.ts";
import type { Store, Watch } from "./db.ts";
import { config } from "./config.ts";
import {
  EMERGENCY, PHASE_LABEL, distanceNm, etaSeconds, phaseOf, progress, shouldAlertSquawk, squawkMeaning,
  type Aircraft,
} from "./logic.ts";

const APPROACH_MINUTES = 20;
const ACTIVITY_MIN_INTERVAL_MS = 15_000;
const UNSEEN_GIVE_UP_MS = 6 * 3600_000;

const alt = (ft: number | null) => (ft == null ? "–" : `${Math.round(ft).toLocaleString("de-CH")} ft`);

export class Monitor {
  private timer: NodeJS.Timeout | null = null;
  lastTick: number | null = null;
  lastError: string | null = null;

  constructor(
    private store: Store,
    private traffic: TrafficSource,
    private push: PushSender,
  ) {}

  start() {
    const loop = async () => {
      let next = config.pollIdleMs;
      try {
        const busy = await this.tick();
        if (busy) next = config.pollActiveMs;
        this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        console.error("Monitor-Zyklus fehlgeschlagen:", this.lastError);
      }
      this.timer = setTimeout(loop, next);
    };
    void loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Ein Abfragezyklus. Gibt true zurück, wenn mindestens ein Flug in der Luft ist (häufiger abfragen). */
  async tick(): Promise<boolean> {
    const watches = this.store.activeWatches();
    this.lastTick = Date.now();
    if (!watches.length) return false;

    const found = new Map<string, Aircraft>();
    const hexes = [...new Set(watches.map((w) => w.hex).filter((h): h is string => !!h))];
    for (let i = 0; i < hexes.length; i += 50) {
      for (const ac of await this.traffic.byHex(hexes.slice(i, i + 50))) found.set(ac.hex, ac);
    }
    let busy = false;
    for (const w of watches) {
      let ac = w.hex ? found.get(w.hex) : undefined;
      if (!ac && !w.hex) {
        const list = w.reg ? await this.traffic.byRegistration(w.reg) : w.callsign ? await this.traffic.byCallsign(w.callsign) : [];
        ac = list[0];
      }
      await this.handle(w, ac);
      if (w.was_airborne && !w.landed_sent) busy = true;
    }
    return busy;
  }

  private async handle(w: Watch, ac: Aircraft | undefined) {
    const now = Date.now();
    if (!ac) {
      if (w.last_seen && now - w.last_seen > UNSEEN_GIVE_UP_MS) {
        w.active = 0;
        this.store.save(w);
      }
      return;
    }
    w.last_seen = now;
    if (!w.hex) w.hex = ac.hex;

    const dest = w.dest_lat != null && w.dest_lon != null ? { lat: w.dest_lat, lon: w.dest_lon } : null;
    const origin = w.origin_lat != null && w.origin_lon != null ? { lat: w.origin_lat, lon: w.origin_lon } : null;
    const cur = { lat: ac.lat, lon: ac.lon };
    const toDest = dest ? distanceNm(cur, dest) : null;
    const eta = dest ? etaSeconds(cur, dest, ac.groundSpeedKts) : null;
    const phase = phaseOf(ac, toDest);
    const route = w.origin_iata && w.dest_iata ? `${w.origin_iata} → ${w.dest_iata}` : "";

    // Notfall-Squawk
    if (w.alert_squawk && shouldAlertSquawk(w.last_squawk, ac.squawk) && ac.squawk) {
      await this.alert(w, {
        title: `Notfall-Squawk ${ac.squawk}`,
        body: `${w.title}: ${squawkMeaning(ac.squawk)}${route ? ` · ${route}` : ""}`,
        level: "time-sensitive", kind: `squawk-${ac.squawk}`,
      });
    }
    w.last_squawk = ac.squawk;

    // Abflugzeit für die Fortschrittsanzeige: beobachteter Start, sonst aus der geflogenen Strecke geschätzt (einmalig).
    if (!ac.onGround && w.takeoff_at == null) {
      if (w.last_on_ground === 1) w.takeoff_at = now;
      else if (origin && dest) {
        const flownNm = progress(origin, dest, cur) * distanceNm(origin, dest);
        w.takeoff_at = now - (flownNm / Math.max(ac.groundSpeedKts ?? 0, 250)) * 3600_000;
      }
    }

    // Start: nur wenn wir das Flugzeug zuvor am Boden gesehen haben
    if (!ac.onGround && w.last_on_ground === 1 && !w.takeoff_sent) {
      w.takeoff_sent = 1;
      if (w.alert_takeoff) {
        await this.alert(w, { title: `${w.title} ist gestartet`, body: route || `Höhe ${alt(ac.altitudeFt)}`, level: "active", kind: "takeoff" });
      }
    }
    if (!ac.onGround) w.was_airborne = 1;

    // Anflug: einmalig, wenn die Restzeit unter die Schwelle fällt
    if (!ac.onGround && !w.approach_sent && eta != null && eta <= APPROACH_MINUTES * 60 && w.was_airborne) {
      w.approach_sent = 1;
      if (w.alert_approach) {
        const min = Math.max(1, Math.round(eta / 60));
        await this.alert(w, { title: `${w.title} landet in ca. ${min} Min.`, body: route || (w.dest_iata ?? ""), level: "active", kind: "approach" });
      }
    }

    // Landung
    let landedNow = false;
    if (ac.onGround && w.was_airborne && !w.landed_sent) {
      w.landed_sent = 1;
      landedNow = true;
      if (w.alert_landing) {
        await this.alert(w, { title: `${w.title} ist gelandet`, body: route, level: "active", kind: "landing" });
      }
    }
    w.last_on_ground = ac.onGround ? 1 : 0;

    await this.startActivity(w, ac, phase, toDest, origin, dest, eta);
    await this.updateActivity(w, ac, phase, toDest, origin, dest, eta, landedNow);
    if (w.landed_sent) w.active = 0; // Landungsmeldung und Ende der Live Activity sind raus: nicht mehr abfragen
    this.store.save(w);
  }

  private buildState(
    w: Watch, ac: Aircraft, phase: ReturnType<typeof phaseOf>, toDest: number | null,
    origin: { lat: number; lon: number } | null, dest: { lat: number; lon: number } | null, eta: number | null,
  ) {
    return {
      phase, phaseLabel: PHASE_LABEL[phase],
      altitudeFt: ac.altitudeFt, speedKts: ac.groundSpeedKts,
      progress: origin && dest ? progress(origin, dest, { lat: ac.lat, lon: ac.lon }) : null,
      etaTimestamp: eta != null ? Math.floor(Date.now() / 1000 + eta) : null, // Sekunden seit 1970
      departureTimestamp: w.takeoff_at != null ? Math.floor(w.takeoff_at / 1000) : null,
      emergency: ac.squawk != null && EMERGENCY.has(ac.squawk),
      distanceNm: toDest,
    };
  }

  /**
   * Startet die Live Activity per Push, wenn die App sie nicht selbst gestartet hat (z. B. App geschlossen).
   * Voraussetzung: Das Gerät hat ein Push-to-Start-Token gemeldet und es gibt noch keine laufende Activity.
   */
  private async startActivity(
    w: Watch, ac: Aircraft, phase: ReturnType<typeof phaseOf>, toDest: number | null,
    origin: { lat: number; lon: number } | null, dest: { lat: number; lon: number } | null, eta: number | null,
  ) {
    if (w.activity_token || w.start_sent || w.landed_sent || ac.onGround) return;
    const device = this.store.getDevice(w.device_token);
    if (!device?.start_token) return;
    const res = await this.push.send({
      kind: "liveactivity", deviceToken: device.start_token, env: device.env, priority: 10,
      payload: {
        aps: {
          timestamp: Math.floor(Date.now() / 1000), event: "start",
          "content-state": this.buildState(w, ac, phase, toDest, origin, dest, eta),
          "attributes-type": "FlightActivityAttributes",
          attributes: {
            watchId: w.id, title: w.title, originIATA: w.origin_iata, destinationIATA: w.dest_iata,
            airlineIATA: w.airline_iata, airlineName: w.airline_name,
          },
        },
      },
    });
    if (res.ok) w.start_sent = 1;
    else if (res.gone) this.store.setStartToken(device.token, null); // Token ungültig: nicht weiter versuchen
  }

  private async updateActivity(
    w: Watch, ac: Aircraft, phase: ReturnType<typeof phaseOf>, toDest: number | null,
    origin: { lat: number; lon: number } | null, dest: { lat: number; lon: number } | null,
    eta: number | null, ending: boolean,
  ) {
    if (!w.activity_token) return;
    const now = Date.now();
    const state = this.buildState(w, ac, phase, toDest, origin, dest, eta);
    const sig = `${state.phase}|${Math.round((state.altitudeFt ?? 0) / 500)}|${Math.round((state.speedKts ?? 0) / 10)}|${Math.round((state.progress ?? 0) * 100)}|${state.emergency}`;
    if (!ending && (sig === w.last_activity_sig || now - w.last_activity_push < ACTIVITY_MIN_INTERVAL_MS)) return;

    const device = this.store.getDevice(w.device_token);
    if (!device) return;
    const ts = Math.floor(now / 1000);
    const aps: Record<string, unknown> = { timestamp: ts, event: ending ? "end" : "update", "content-state": state };
    if (ending) aps["dismissal-date"] = ts + 600;
    if (!ending && state.emergency) aps.alert = { title: `Notfall ${ac.squawk}`, body: w.title };
    const res = await this.push.send({
      kind: "liveactivity", deviceToken: w.activity_token, env: device.env, payload: { aps },
      priority: ending || state.emergency ? 10 : 5,
    });
    if (res.ok) {
      w.last_activity_push = now;
      w.last_activity_sig = sig;
    } else if (res.gone) {
      w.activity_token = null;
    }
  }

  private async alert(w: Watch, a: { title: string; body: string; level: "active" | "time-sensitive"; kind: string }) {
    const device = this.store.getDevice(w.device_token);
    if (!device) return;
    const res = await this.push.send({
      kind: "alert", deviceToken: w.device_token, env: device.env, collapseId: `${w.id}-${a.kind}`.slice(0, 64),
      payload: {
        aps: {
          alert: { title: a.title, body: a.body }, sound: "default",
          "interruption-level": a.level, "mutable-content": 1, "thread-id": w.id,
        },
        watchId: w.id, kind: a.kind, airlineIATA: w.airline_iata, airlineName: w.airline_name,
      },
    });
    if (res.gone) this.store.deleteDevice(w.device_token);
  }
}
