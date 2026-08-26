import { prisma } from "./db";
import { SEED_AIRLINES, SEED_AIRPORTS, SEED_ROUTES } from "./master-data";

const OURAIRPORTS = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OPENFLIGHTS_AIRLINES = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";
const OPENFLIGHTS_ROUTES = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat";

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export async function seedCoreMasterData() {
  for (const a of SEED_AIRPORTS) {
    await prisma.airport.upsert({
      where: { iata: a.iata },
      update: { ...a, source: "bundled" },
      create: { ...a, source: "bundled" },
    });
  }
  for (const a of SEED_AIRLINES) {
    await prisma.airline.upsert({
      where: { iata: a.iata },
      update: { ...a, source: "bundled" },
      create: { ...a, source: "bundled" },
    });
  }
  if ((await prisma.route.count()) === 0) {
    await prisma.route.createMany({
      data: SEED_ROUTES.map((r) => ({ ...r, source: "bundled" })),
    });
  }
  await backfillSeedAirportTimezones();
  return {
    airports: await prisma.airport.count(),
    airlines: await prisma.airline.count(),
    routes: await prisma.route.count(),
  };
}

/** Restore IANA zones on bundled airports without overwriting an existing zone. */
export async function backfillSeedAirportTimezones() {
  let updated = 0;
  for (const airport of SEED_AIRPORTS) {
    if (!airport.timezone) continue;
    const result = await prisma.airport.updateMany({
      where: { iata: airport.iata, timezone: null },
      data: { timezone: airport.timezone },
    });
    updated += result.count;
  }
  return updated;
}

export async function importOpenData(kind: "airports" | "airlines" | "routes" | "all" = "all") {
  const result = { airports: 0, airlines: 0, routes: 0 };

  if (kind === "airports" || kind === "all") {
    const text = await fetch(OURAIRPORTS).then((r) => r.text());
    const lines = text.split("\n").slice(1);
    const seedTz = new Map<string, string>();
    for (const airport of SEED_AIRPORTS) {
      if (airport.timezone) seedTz.set(airport.iata, airport.timezone);
    }
    const rows = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const c = parseCsvLine(line);
      const type = c[2];
      const iata = c[13] && c[13] !== "\\N" ? c[13] : null;
      const icao = c[12] && c[12] !== "\\N" ? c[12] : null;
      if (type !== "large_airport" && type !== "medium_airport") continue;
      if (!iata && !icao) continue;
      const lat = Number(c[4]);
      const lon = Number(c[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      rows.push({
        iata,
        icao,
        name: c[3] || "Unknown",
        city: c[10] || null,
        country: c[8] || null,
        lat,
        lon,
        timezone: iata ? seedTz.get(iata) : undefined,
        source: "ourairports",
      });
    }
    for (const row of rows) {
      const { timezone, ...rest } = row;
      const update = timezone ? { ...rest, timezone } : rest;
      const create = { ...rest, timezone: timezone ?? null };
      if (row.iata) {
        await prisma.airport.upsert({
          where: { iata: row.iata },
          update,
          create,
        });
      } else if (row.icao) {
        await prisma.airport.upsert({
          where: { icao: row.icao },
          update,
          create,
        });
      }
      result.airports += 1;
    }
  }

  if (kind === "airlines" || kind === "all") {
    const text = await fetch(OPENFLIGHTS_AIRLINES).then((r) => r.text());
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const c = line.split(",").map((s) => s.replace(/^"|"$/g, ""));
      const name = c[1];
      const iata = c[3] && c[3] !== "\\N" && c[3] !== "-" ? c[3] : null;
      const icao = c[4] && c[4] !== "\\N" && c[4] !== "-" ? c[4] : null;
      const active = c[7] === "Y";
      if (!active || (!iata && !icao)) continue;
      const data = {
        name,
        iata,
        icao,
        callsign: c[5] !== "\\N" ? c[5] : null,
        country: c[6] !== "\\N" ? c[6] : null,
        active: true,
        source: "openflights",
      };
      if (iata) {
        await prisma.airline.upsert({ where: { iata }, update: data, create: data });
      } else if (icao) {
        await prisma.airline.upsert({ where: { icao }, update: data, create: data });
      }
      result.airlines += 1;
    }
  }

  if (kind === "routes" || kind === "all") {
    const text = await fetch(OPENFLIGHTS_ROUTES).then((r) => r.text());
    const batch: { airlineIata: string | null; airlineIcao: string | null; fromIata: string; toIata: string; source: string }[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const c = line.split(",");
      const airlineIata = c[0] && c[0] !== "\\N" ? c[0] : null;
      const fromIata = c[2];
      const toIata = c[4];
      if (!fromIata || !toIata || fromIata === "\\N" || toIata === "\\N") continue;
      batch.push({
        airlineIata,
        airlineIcao: null,
        fromIata,
        toIata,
        source: "openflights",
      });
    }
    const slice = batch.slice(0, 25000);
    await prisma.route.deleteMany({ where: { source: "openflights" } });
    for (let i = 0; i < slice.length; i += 1000) {
      await prisma.route.createMany({ data: slice.slice(i, i + 1000) });
    }
    result.routes = slice.length;
  }

  return result;
}
