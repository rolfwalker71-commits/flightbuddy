# FlightBuddy-Server

Schlanker Begleiter der iOS-App: fragt **ausschliesslich airplanes.live** ab, erkennt Ereignisse
(Start, Anflug, Landung, Notfall-Squawk) und sendet sie per **APNs** als Push und als Live-Activity-Update.
Keine Datenbank ausser SQLite, keine Laufzeit-Abhängigkeiten (nur Node 22.13+).

```bash
cp .env.example .env      # API_TOKEN setzen: openssl rand -hex 24
npm install
npm test                  # Simulation: Boden → Start → Squawk → Anflug → Landung
set -a; . ./.env; set +a
npm start
```

## APNs einrichten (einmalig, im Apple Developer Portal)
1. Keys → «+» → *Apple Push Notifications service (APNs)* → Schlüssel laden (`AuthKey_XXXX.p8`, nur einmal herunterladbar).
2. `.p8` nach `secrets/` legen, in `.env` `APNS_KEY_PATH` und `APNS_KEY_ID` eintragen.
3. Ohne diese Werte läuft der Server im Dry-Run und loggt die Pushes nur.

## API (alle ausser /v1/health mit `Authorization: Bearer <API_TOKEN>`)
| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/v1/health` | Status, letzter airplanes.live-Zugriff |
| PUT | `/v1/devices` | `{deviceToken, environment: "sandbox"\|"production"}` |
| PUT | `/v1/watches/{uuid}` | Flug beobachten: `{deviceToken, title, hex?\|callsign?\|registration?, airlineIATA?, airlineName?, origin?:{iata,lat,lon}, destination?:{…}, alerts?:{squawk,takeoff,landing,approach}}` |
| DELETE | `/v1/watches/{uuid}` | Beobachtung beenden |
| PUT/DELETE | `/v1/watches/{uuid}/live-activity` | `{pushToken}` der Live Activity |
| GET | `/v1/resolve?q=` | Flugzeug finden (Hex, Registration oder Callsign; `SWR64` findet `SWR64E`) |
| GET | `/v1/traffic/near?lat&lon&radius`, `/v1/traffic/{hex,callsign,reg}/{wert}` | Flugdaten für die App (das iPhone braucht keinen eigenen Zugang zu airplanes.live) |
| PUT/DELETE | `/v1/settings/opensky` | OpenSky-Zugangsdaten `{clientId, clientSecret}` aus der App: werden geprüft und gespeichert, nie zurückgegeben |
| POST | `/v1/test-push` | Testmeldung an ein Gerät, Apples Antwort wird durchgereicht |

Live-Activity-Inhalt (`content-state`): `phase, phaseLabel, altitudeFt, speedKts, progress, etaTimestamp, emergency, distanceNm`.
Push-Inhalt enthält `airlineIATA`; die App lädt das Logo selbst nach (Notification Service Extension), der Server hostet keine Logos.

## airplanes.live
Der Zugriff muss vom Betreiber freigeschaltet werden (contact@airplanes.live), bis dahin liefert `/v1/health`
`lastError: "HTTP 403 …"`. Anfragen: max. 1 pro 1,1 s, Backoff bei 429, User-Agent mit Kontaktadresse.

## Betrieb auf dem Server
Der APNs-Schlüssel (`AuthKey_<KEYID>.p8`) bleibt auf dem Host und wird nur lesend eingebunden.
In `.env` stehen `API_TOKEN`, `APNS_KEY_ID` (aus dem Dateinamen), `APNS_TEAM_ID`, `APNS_TOPIC`, und für Compose
`APNS_KEY_HOST_PATH=/pfad/zur/AuthKey_<KEYID>.p8`. Die Datei `.env` ersetzt die bisherige `.env` der PWA vollständig.

```bash
docker compose pull && docker compose up -d     # Image aus GHCR (ghcr.io/rolfwalker71-commits/flightbuddy-server)
curl -s localhost:8787/v1/health
# lokal bauen statt ziehen:
# docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```
Die App muss den Server über HTTPS erreichen (Reverse-Proxy mit TLS davor). Port 8787 ist nur an localhost gebunden.

## Datenquellen
`TRAFFIC_SOURCE=auto` (Standard) fragt airplanes.live und nimmt bei einem Fehler OpenSky, sofern Zugangsdaten vorhanden sind
(`OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` oder per App gespeichert, die App-Eingabe hat Vorrang).
OpenSky kennt keine Registration; Callsigns werden über einen globalen Abruf (4 Credits, 30 s zwischengespeichert) gefunden.
`demo` simuliert einen Flug zum Testen ohne Freischaltung.
