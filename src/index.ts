import { AirplanesLive } from "./airplanes.ts";
import { createSender } from "./apns.ts";
import { config } from "./config.ts";
import { Store, openDb } from "./db.ts";
import { createApi } from "./http.ts";
import { Monitor } from "./monitor.ts";

const store = new Store(openDb());
const airplanes = new AirplanesLive();
const monitor = new Monitor(store, airplanes, createSender());
const server = createApi(store, monitor, airplanes);

if (!config.apiToken) console.warn("API_TOKEN ist nicht gesetzt: alle Endpunkte ausser /v1/health werden abgelehnt.");
server.listen(config.port, () => console.log(`FlightBuddy-Server auf Port ${config.port}`));
monitor.start();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { monitor.stop(); server.close(() => process.exit(0)); });
}
