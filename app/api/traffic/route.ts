import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { fetchOpenSkyBbox, openSkyToTelemetry } from "@/lib/opensky";
import { openSkyConfig } from "@/lib/server-env";
import {
  bboxAreaSqDeg,
  callsignPrefix,
  isViewportTooLarge,
  parseViewportBounds,
  type ViewportTrafficAircraft,
} from "@/lib/viewport-traffic";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function resolveAirlines(prefixes: string[]) {
  const icaos = [...new Set(prefixes.filter((p) => p.length === 3))];
  const iatas = [...new Set(prefixes.filter((p) => p.length === 2))];
  if (!icaos.length && !iatas.length) return new Map<string, { name: string; iata: string | null }>();

  const rows = await prisma.airline.findMany({
    where: {
      OR: [
        ...(icaos.length ? [{ icao: { in: icaos } }] : []),
        ...(iatas.length ? [{ iata: { in: iatas } }] : []),
      ],
    },
    select: { icao: true, iata: true, name: true },
  });

  const byPrefix = new Map<string, { name: string; iata: string | null }>();
  for (const row of rows) {
    const info = { name: row.name, iata: row.iata };
    if (row.icao) byPrefix.set(row.icao.toUpperCase(), info);
    if (row.iata) byPrefix.set(row.iata.toUpperCase(), info);
  }
  return byPrefix;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return json({ error: "Unauthorized" }, 401);

  const box = parseViewportBounds(new URL(req.url).searchParams);
  if (!box) return json({ error: "Invalid bounds" }, 400);
  if (isViewportTooLarge(box)) {
    return json({ error: "Viewport too large", areaSqDeg: bboxAreaSqDeg(box) }, 400);
  }

  const { minIntervalMs } = openSkyConfig();
  const result = await fetchOpenSkyBbox(box);

  if (!result.gated && result.status === 429) {
    const remaining = result.remaining ?? null;
    const outOfCredits = remaining === 0;
    return json(
      {
        aircraft: [],
        remaining,
        intervalMs: minIntervalMs,
        retryAfterMs: (result.retryAfterSeconds ?? 60) * 1000,
        fetched: false,
        source: "opensky",
        exhausted: outOfCredits,
        areaSqDeg: bboxAreaSqDeg(box),
      },
      429,
    );
  }

  const airborne = result.states.filter(
    (s) => s.lat != null && s.lon != null && Number.isFinite(s.lat) && Number.isFinite(s.lon) && !s.onGround,
  );
  const airlines = result.gated
    ? new Map<string, { name: string; iata: string | null }>()
    : await resolveAirlines(
        airborne.map((s) => callsignPrefix(s.callsign)).filter((p): p is string => Boolean(p)),
      );

  const aircraft: ViewportTrafficAircraft[] = airborne.map((s) => {
    const tel = openSkyToTelemetry(s);
    const prefix = callsignPrefix(s.callsign);
    const airline = prefix ? airlines.get(prefix) : undefined;
    return {
      icao24: s.icao24,
      callsign: s.callsign,
      airlineName: airline?.name ?? null,
      airlineIata: airline?.iata ?? null,
      lat: s.lat as number,
      lon: s.lon as number,
      altitudeFt: tel.altitudeFt,
      speedKts: tel.velocityKts,
      heading: tel.heading,
      onGround: s.onGround,
    };
  });

  return json({
    aircraft,
    remaining: result.remaining,
    intervalMs: minIntervalMs,
    retryAfterMs: result.gated ? result.retryAfterMs : 0,
    fetched: !result.gated && result.status === 200,
    source: "opensky",
    exhausted: false,
    areaSqDeg: bboxAreaSqDeg(box),
  });
}
