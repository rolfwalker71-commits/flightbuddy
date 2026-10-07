import { AirplanesLive } from "./airplanes.ts";
import { createSender } from "./apns.ts";
import { config } from "./config.ts";
import { Store, openDb } from "./db.ts";
import { createApi } from "./http.ts";
import { DemoTraffic } from "./demo.ts";
import { Monitor } from "./monitor.ts";

const store = new Store(openDb());
const demo = config.trafficSource === "demo";
const airplanes = demo ? null : new AirplanesLive();
const sender = createSender();
const monitor = new Monitor(store, airplanes ?? new DemoTraffic(), sender);
const server = createApi(store, monitor, airplanes, sender);
if (demo) console.warn("TRAFFIC_SOURCE=demo: simulierter Verkehr (SWR8 / DLH7XK ZRH → LHR), keine echten Flugdaten.");

if (!config.apiToken) console.warn("API_TOKEN ist nicht gesetzt: alle Endpunkte ausser /v1/health werden abgelehnt.");
server.listen(config.port, () => console.log(`FlightBuddy-Server auf Port ${config.port}`));
monitor.start();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { monitor.stop(); server.close(() => process.exit(0)); });
}
