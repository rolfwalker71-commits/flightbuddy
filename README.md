# FlightBuddy

Self-hosted, multi-user flight tracker inspired by Flighty. Dark PWA for desktop and mobile.

**Stack:** Next.js App Router · Tailwind · Auth.js · Prisma · PostgreSQL/PostGIS · Redis/BullMQ · MapLibre · Web Push · GHCR

## Run locally

```bash
cp .env.example .env
# set AUTH_SECRET — openssl rand -base64 32
docker compose up -d postgres redis
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

In a second terminal:

```bash
npm run dev:worker
```

Open http://localhost:3377 and create the first account — that user becomes **admin**.

## Docker

Production compose uses only the GHCR image (no `build:` in `docker-compose.yml`).

```bash
# local image
docker compose -f docker-compose.yml -f docker-compose.build.yml build

export AUTH_SECRET=$(openssl rand -base64 32)
docker compose up -d
```

On a remote host after GitHub Actions has published `ghcr.io/rolfwalker71-commits/flightbuddy:latest`:

```bash
docker compose pull && docker compose up -d
```

Do not run `docker compose up --build` on the server.

## API keys

| Service | Required? | Where to register | Env vars |
|---|---|---|---|
| **OpenSky Network** | Recommended | [Create an OpenSky account](https://opensky-network.org/index.php?option=com_users&view=registration) | `OPENSKY_USERNAME`, `OPENSKY_PASSWORD` |
| **AeroDataBox (RapidAPI)** | Optional | [AeroDataBox on RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) | `AERODATABOX_KEY` |
| **Web Push VAPID** | Automatic | Keys are generated on first boot and stored in `AppSetting`. Optional env override. | — |
| **OurAirports / OpenFlights** | No signup | Imported from Settings (admin) | — |
| **Carto / OSM tiles** | No signup | Used client-side for the dark map | — |

Anonymous OpenSky works but is heavily rate-limited. A free OpenSky login is the most important registration.

## Polling

Adaptive poll cycle. OpenSky is never queried faster than `OPENSKY_MIN_INTERVAL_MS` (default 90s); if the cycle is faster (10s/30s climb/approach), AeroDataBox location is used while OpenSky is in cooldown. Never faster than the AeroDataBox 1.2s throttle.

- Far from departure: every 8 hours
- Pre-flight window (default 2h): every 15 minutes; last 45 min before dep: every 3 minutes
- En route climb (first 10 min after actual/estimated/scheduled dep, or very low progress if no dep time): every 10 seconds
- En route climb (first 10–20 min after dep, or low progress if no dep time): every 30 seconds
- En route approach (last 10 min to ETA, or progress ≥ ~90% if no ETA): every 10 seconds
- En route approach (last 10–20 min to ETA, or progress ≥ ~80% if no ETA): every 30 seconds
- Cruise: every 3 minutes
- Landed / cancelled: polling stops
