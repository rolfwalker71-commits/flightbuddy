import { AirplanesLive, type TrafficSource } from "./airplanes.ts";
import { createSender } from "./apns.ts";
import { config } from "./config.ts";
import { Store, openDb } from "./db.ts";
import { DemoTraffic } from "./demo.ts";
import { createApi } from "./http.ts";
import { Monitor } from "./monitor.ts";
import { OpenSky } from "./opensky.ts";
import { AeroDataBox, ScheduleMonitor } from "./schedule.ts";
import { FallbackTraffic, trafficMeta } from "./traffic.ts";

const store = new Store(openDb());
const choice = config.trafficSource;
const airplanes = choice === "demo" || choice === "opensky" ? null : new AirplanesLive();
const opensky = choice === "airplanes" || choice === "demo" ? null : new OpenSky();

// Gespeicherte Eingabe aus der App hat Vorrang vor den Umgebungsvariablen.
const savedId = store.getSetting("opensky.clientId"), savedSecret = store.getSetting("opensky.clientSecret");
if (opensky && savedId && savedSecret) opensky.setCredentials(savedId, savedSecret, "app");

let traffic: TrafficSource;
let source: string;
const demoTraffic = choice === "demo" ? new DemoTraffic(() => Date.now(), config.demoBlackout) : null;
if (demoTraffic) { traffic = demoTraffic; source = "demo"; }
else if (choice === "opensky") { traffic = opensky!; source = "opensky"; }
else if (choice === "airplanes") { traffic = airplanes!; source = "airplanes"; }
else { traffic = new FallbackTraffic(airplanes!, opensky!); source = "auto (airplanes.live, Ausweichquelle OpenSky)"; }

const sender = createSender();
// AeroDataBox (optional): in der App gespeicherter Schlüssel hat Vorrang vor der Umgebungsvariable.
const aero = new AeroDataBox(store.getSetting("aerodatabox.key") ?? config.aerodatabox.key);
const schedule = new ScheduleMonitor(store, aero, sender);
const monitor = new Monitor(store, traffic, sender, () => Date.now(), demoTraffic ?? opensky ?? undefined,
  () => trafficMeta(traffic, source).refreshSeconds * 1000); // OpenSky: höchstens alle 30 s, sonst reicht das Tageskontingent nicht // OpenSky liefert auch den bisherigen Flugweg
const server = createApi(store, monitor, { source, airplanes, opensky, aero, schedule, tracks: demoTraffic ?? undefined }, sender, traffic);
console.log(`Datenquelle: ${source}`);
if (choice === "demo") console.warn("TRAFFIC_SOURCE=demo: simulierter Verkehr (SWR8 / DLH7XK ZRH → LHR), keine echten Flugdaten.");
if (choice === "opensky" && !opensky!.configured) console.warn("OpenSky gewählt, aber OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET fehlen.");

if (!config.apiToken) console.warn("API_TOKEN ist nicht gesetzt: alle Endpunkte ausser /v1/health werden abgelehnt.");
server.listen(config.port, () => console.log(`FlightBuddy-Server auf Port ${config.port}`));
monitor.start();
schedule.start();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { monitor.stop(); schedule.stop(); server.close(() => process.exit(0)); });
}
