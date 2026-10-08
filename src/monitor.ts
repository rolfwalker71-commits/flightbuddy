import type { TrafficSource } from "./airplanes.ts";
import type { Track } from "./opensky.ts";
import type { PushSender } from "./apns.ts";
import type { Store, Watch } from "./db.ts";
import { config } from "./config.ts";
import { homeSuffix } from "./schedule.ts";
import {
  EMERGENCY, PHASE_LABEL, STALE_POSITION_SEC, distanceNm, etaSeconds, phaseOf, progress, shouldAlertSquawk, squawkMeaning,
  type Aircraft,
} from "./logic.ts";

const APPROACH_MINUTES = 20;
const ACTIVITY_MIN_INTERVAL_MS = 15_000;
const UNSEEN_GIVE_UP_MS = 6 * 3600_000;
/** In der Luft bleibt ein Flug lange ohne Daten (Ozean: kein Bodenempfang), bevor wir ihn aufgeben. */
const AIRBORNE_GIVE_UP_MS = 20 * 3600_000;
/** Nach so langer Funkstille wird die Live Activity einmal auf «Kein Empfang» gesetzt. */
const SIGNAL_LOST_AFTER_MS = 10 * 60_000;
/** Geplante Flüge schlafen bis kurz vor dem Abflug; das Flugzeug erscheint meist 1–2 Stunden vorher im ADS-B-Netz. */
export const WAKE_BEFORE_DEP_MS = 4 * 3600_000;
const REMINDER_BEFORE_DEP_MS = 3 * 3600_000;
const GIVE_UP_AFTER_DEP_MS = 12 * 3600_000;
const RESOLVE_RETRY_MS = 3 * 60_000;
/**
 * Viele Flughäfen werden am Boden nicht empfangen: das Flugzeug verschwindet im Sinkflug und wird nie «am Boden» gesehen.
 * War es zuletzt tief und nahe am Ziel und bleibt danach so lange still, gilt es als gelandet.
 */
const LANDED_INFER_AFTER_MS = 6 * 60_000;
const LANDED_INFER_MAX_ALT_FT = 4000;
const LANDED_INFER_MAX_DIST_NM = 25;

const alt = (ft: number | null) => (ft == null ? "–" : `${Math.round(ft).toLocaleString("de-CH")} ft`);

export class Monitor {
  private timer: NodeJS.Timeout | null = null;
  lastTick: number | null = null;
  lastError: string | null = null;

  private lastResolveTry = new Map<string, number>();
  /** Letzte frisch empfangene Höhe/Distanz je Flug (für die Landungsschätzung ohne Bodenempfang). */
  private lastLow = new Map<string, { altFt: number | null; distNm: number | null; vrFpm: number | null }>();

  constructor(
    private store: Store,
    private traffic: TrafficSource,
    private push: PushSender,
    private now: () => number = () => Date.now(),
    /** Quelle für den bisherigen Flugweg (OpenSky); optional. */
    private tracks?: { track(hex: string): Promise<Track | null> },
    /** Mindestabstand der Abfragen während eines Flugs (OpenSky hat ein Tageskontingent). */
    private minActivePollMs: () => number = () => 0,
  ) {}

  start() {
    const loop = async () => {
      let next = config.pollIdleMs;
      try {
        const busy = await this.tick();
        if (busy) next = Math.max(config.pollActiveMs, this.minActivePollMs());
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
    const now = this.now();
    const all = this.store.activeWatches();
    this.lastTick = now;
    // Geplante Flüge schlafen bis 4 Stunden vor dem Abflug; wer lange nach dem Abflug nie gesehen wurde, wird beendet.
    const watches: Watch[] = [];
    for (const w of all) {
      if (w.sched_dep != null) {
        if (now < w.sched_dep - WAKE_BEFORE_DEP_MS) continue;
        if (w.last_seen == null && now > w.sched_dep + GIVE_UP_AFTER_DEP_MS) { w.active = 0; this.store.save(w); continue; }
        if (!w.reminder_sent && now >= w.sched_dep - REMINDER_BEFORE_DEP_MS && now < w.sched_dep) {
          w.reminder_sent = 1;
          if (w.alert_reminder) await this.reminder(w);
          this.store.save(w);
        }
      }
      watches.push(w);
    }
    if (!watches.length) return false;

    const found = new Map<string, Aircraft>();
    const hexes = [...new Set(watches.map((w) => w.hex).filter((h): h is string => !!h))];
    for (let i = 0; i < hexes.length; i += 50) {
      for (const ac of await this.traffic.byHex(hexes.slice(i, i + 50))) found.set(ac.hex, ac);
    }
    let busy = false;
    for (const w of watches) {
      let ac = w.hex ? found.get(w.hex) : undefined;
      // Eine alte Position ist kein Empfang: sonst bliebe ein längst verschwundenes Flugzeug «live» (und eine Landung unbemerkt).
      if (ac && ac.ageSec != null && ac.ageSec > STALE_POSITION_SEC) ac = undefined;
      if (!ac && !w.hex && now - (this.lastResolveTry.get(w.id) ?? 0) >= RESOLVE_RETRY_MS) {
        this.lastResolveTry.set(w.id, now);
        // Erst Registration, dann Callsign. Ein Fehler bei einem Weg (zum Beispiel Registration ohne airplanes.live) darf weder
        // den anderen Weg noch die übrigen Flüge dieses Zyklus verhindern.
        for (const attempt of [
          w.reg ? () => this.traffic.byRegistration(w.reg!) : null,
          w.callsign ? async () => (await this.traffic.searchCallsign(w.callsign!)).aircraft : null,
        ]) {
          if (!attempt) continue;
          try { ac = (await attempt())[0]; if (ac) break; }
          catch (e) { this.lastError = e instanceof Error ? e.message : String(e); }
        }
      }
      await this.handle(w, ac);
      if (w.was_airborne && !w.landed_sent) busy = true;
    }
    return busy;
  }

  private async handle(w: Watch, ac: Aircraft | undefined) {
    const now = this.now();
    if (!ac) {
      const flying = w.was_airborne === 1 && !w.landed_sent;
      if (w.last_seen && now - w.last_seen > (flying ? AIRBORNE_GIVE_UP_MS : UNSEEN_GIVE_UP_MS)) {
        w.active = 0;
        this.store.save(w);
        return;
      }
      if (flying && await this.inferLanding(w)) return;
      if (flying && !w.lost_sent && w.last_seen && now - w.last_seen > SIGNAL_LOST_AFTER_MS) await this.signalLost(w);
      return;
    }
    w.lost_sent = 0; // wieder Empfang: das nächste normale Update ersetzt «Kein Empfang»
    w.last_seen = now;
    if (!w.hex) w.hex = ac.hex;

    const dest = w.dest_lat != null && w.dest_lon != null ? { lat: w.dest_lat, lon: w.dest_lon } : null;
    const origin = w.origin_lat != null && w.origin_lon != null ? { lat: w.origin_lat, lon: w.origin_lon } : null;
    const cur = { lat: ac.lat, lon: ac.lon };
    const toDest = dest ? distanceNm(cur, dest) : null;
    const eta = dest ? etaSeconds(cur, dest, ac.groundSpeedKts, ac.altitudeFt, ac.verticalRateFpm) : null;
    const phase = phaseOf(ac, toDest);
    this.lastLow.set(w.id, { altFt: ac.altitudeFt, distNm: toDest, vrFpm: ac.verticalRateFpm });
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
      else if (await this.takeoffFromTrack(w, ac.hex, origin)) { /* tatsächlicher Start aus dem Flugweg gesetzt */ }
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
      etaTimestamp: eta != null ? Math.floor(this.now() / 1000 + eta) : null, // Sekunden seit 1970
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
          timestamp: Math.floor(this.now() / 1000), event: "start",
          "content-state": this.buildState(w, ac, phase, toDest, origin, dest, eta),
          "attributes-type": "FlightActivityAttributes",
          attributes: {
            watchId: w.id, title: w.title, originIATA: w.origin_iata, destinationIATA: w.dest_iata,
            airlineIATA: w.airline_iata, airlineName: w.airline_name, destinationTimeZone: w.dest_tz,
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
    const now = this.now();
    const state = this.buildState(w, ac, phase, toDest, origin, dest, eta);
    const sig = `${state.phase}|${Math.round((state.altitudeFt ?? 0) / 500)}|${Math.round((state.speedKts ?? 0) / 10)}|${Math.round((state.progress ?? 0) * 100)}|${state.emergency}`;
    // Die Restzeit steht als «8:14» im Display und wird bei jedem Update neu berechnet. Damit sie nicht veraltet, kommt unter zwei
    // Stunden jede Minute ein Update, sonst alle fünf Minuten, auch wenn sich sonst nichts geändert hat.
    const remainingSec = state.etaTimestamp != null ? state.etaTimestamp - Math.floor(now / 1000) : null;
    const refreshMs = remainingSec != null && remainingSec < 7200 ? 60_000 : 300_000;
    const due = remainingSec != null && now - w.last_activity_push >= refreshMs;
    if (!ending && ((sig === w.last_activity_sig && !due) || now - w.last_activity_push < ACTIVITY_MIN_INTERVAL_MS)) return;

    const device = this.store.getDevice(w.device_token);
    if (!device) return;
    const ts = Math.floor(now / 1000);
    const aps: Record<string, unknown> = { timestamp: ts, event: ending ? "end" : "update", "content-state": state };
    if (ending) aps["dismissal-date"] = ts + 600;
    if (!ending && state.emergency) aps.alert = { title: `Notfall ${ac.squawk}`, body: w.title };
    const res = await this.push.send({
      kind: "liveactivity", deviceToken: w.activity_token, env: device.env, payload: { aps },
      // In der letzten Stunde sofort zustellen: dort zählt jede Minute.
      priority: ending || state.emergency || (remainingSec != null && remainingSec < 3600) ? 10 : 5,
    });
    if (res.ok) {
      w.last_activity_push = now;
      w.last_activity_sig = sig;
      w.last_state = JSON.stringify(state);
    } else if (res.gone) {
      w.activity_token = null;
    }
  }

  /**
   * Landung ohne Bodenempfang: zuletzt tief, im Sinkflug und nahe am Ziel gesehen, seither still.
   * Meldet die Landung und beendet die Live Activity. Gibt true zurück, wenn der Flug damit abgeschlossen ist.
   */
  private async inferLanding(w: Watch): Promise<boolean> {
    const now = this.now();
    const last = this.lastLow.get(w.id);
    if (w.landed_sent || !w.last_seen || !last || now - w.last_seen < LANDED_INFER_AFTER_MS) return false;
    if (last.altFt == null || last.altFt > LANDED_INFER_MAX_ALT_FT) return false;
    if (last.distNm == null || last.distNm > LANDED_INFER_MAX_DIST_NM) return false;
    if ((last.vrFpm ?? 0) > 500) return false; // steigt noch: kommt von einem Start, nicht von einer Landung
    w.landed_sent = 1;
    const route = w.origin_iata && w.dest_iata ? `${w.origin_iata} → ${w.dest_iata}` : "";
    if (w.alert_landing) {
      await this.alert(w, { title: `${w.title} ist gelandet`, body: route, level: "active", kind: "landing" });
    }
    if (w.activity_token && w.last_state) {
      const device = this.store.getDevice(w.device_token);
      if (device) {
        const ts = Math.floor(now / 1000);
        const state = { ...JSON.parse(w.last_state), phase: "ground", phaseLabel: PHASE_LABEL.ground, altitudeFt: 0 };
        const res = await this.push.send({
          kind: "liveactivity", deviceToken: w.activity_token, env: device.env, priority: 10,
          payload: { aps: { timestamp: ts, event: "end", "content-state": state, "dismissal-date": ts + 600 } },
        });
        if (res.gone) w.activity_token = null;
      }
    }
    this.lastLow.delete(w.id);
    w.active = 0;
    this.store.save(w);
    return true;
  }

  /**
   * Das Flugzeug sendet nicht mehr (zum Beispiel über dem Ozean). Die Live Activity zeigt das einmal an und behält die
   * zuletzt berechnete Landezeit, deren Zähler weiterläuft.
   */
  private async signalLost(w: Watch) {
    w.lost_sent = 1;
    if (w.activity_token && w.last_state) {
      const device = this.store.getDevice(w.device_token);
      if (device) {
        const state = { ...JSON.parse(w.last_state), phase: "lost", phaseLabel: "Kein Empfang" };
        const ts = Math.floor(this.now() / 1000);
        const res = await this.push.send({
          kind: "liveactivity", deviceToken: w.activity_token, env: device.env, priority: 5,
          payload: { aps: { timestamp: ts, event: "update", "content-state": state } },
        });
        if (res.gone) w.activity_token = null;
      }
    }
    this.store.save(w);
  }

  /**
   * Wurde der Start nicht beobachtet (Flug erst später angelegt), liefert der bisherige Flugweg die tatsächliche Abflugzeit.
   * Gilt nur, wenn der erste Punkt zum Abflughafen passt und nicht älter als 24 Stunden ist. Einmal pro Flug.
   */
  private async takeoffFromTrack(w: Watch, hex: string, origin: { lat: number; lon: number } | null): Promise<boolean> {
    if (!this.tracks || w.track_checked) return false;
    w.track_checked = 1;
    try {
      const tr = await this.tracks.track(hex);
      const first = tr?.points[0];
      if (!tr || !first) return false;
      const ageMs = this.now() - first.t * 1000;
      if (ageMs < 0 || ageMs > 24 * 3600_000) return false;
      if (origin && distanceNm(origin, { lat: first.lat, lon: first.lon }) > 80) return false; // anderer Flug oder Zwischenlandung
      w.takeoff_at = first.t * 1000;
      return true;
    } catch {
      return false;
    }
  }

  /** Erinnerung drei Stunden vor dem geplanten Abflug. */
  private async reminder(w: Watch) {
    const tz = w.origin_tz ?? config.displayTz;
    const at = new Date(w.sched_dep!).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    const route = w.origin_iata && w.dest_iata ? `${w.origin_iata} → ${w.dest_iata} · ` : "";
    await this.alert(w, { title: `${w.title} hebt in 3 Std. ab`, body: `${route}${at} Uhr${homeSuffix(w.sched_dep!, tz)}`, level: "active", kind: "reminder" });
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
