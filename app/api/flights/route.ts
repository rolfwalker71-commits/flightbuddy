import { NextResponse } from "next/server";
import { FlightStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveUserFlight } from "@/lib/flights";

const statuses = [
  "SCHEDULED",
  "DELAYED",
  "BOARDING",
  "DEPARTED",
  "EN_ROUTE",
  "LANDED",
  "CANCELLED",
  "DIVERTED",
  "UNKNOWN",
] as const;

const schema = z.object({
  flightNumber: z.string().min(3),
  airlineName: z.string().nullish(),
  airlineIata: z.string().nullish(),
  airlineIcao: z.string().nullish(),
  fromIata: z.string().nullish(),
  toIata: z.string().nullish(),
  fromCity: z.string().nullish(),
  toCity: z.string().nullish(),
  scheduledDep: z.string().min(1),
  scheduledArr: z.string().nullish(),
  estimatedDep: z.string().nullish(),
  estimatedArr: z.string().nullish(),
  actualDep: z.string().nullish(),
  actualArr: z.string().nullish(),
  fromTimezone: z.string().nullish(),
  toTimezone: z.string().nullish(),
  status: z.enum(statuses).optional(),
  gate: z.string().nullish(),
  terminal: z.string().nullish(),
  arrivalGate: z.string().nullish(),
  arrivalTerminal: z.string().nullish(),
  aircraftType: z.string().nullish(),
  registration: z.string().nullish(),
  icao24: z.string().nullish(),
  callsign: z.string().nullish(),
  source: z.enum(["aerodatabox", "local"]).optional(),
  timesEstimated: z.boolean().optional(),
  seat: z.string().optional(),
  trackDaily: z.boolean().optional(),
  inLogbook: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: "SESSION_EXPIRED", code: "SESSION_EXPIRED" },
      { status: 401 },
    );
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid flight" }, { status: 400 });
  try {
    const saved = await saveUserFlight({
      userId: user.id,
      result: {
        ...parsed.data,
        status: (parsed.data.status as FlightStatus | undefined) ?? FlightStatus.SCHEDULED,
        source: parsed.data.source ?? "local",
      },
      seat: parsed.data.seat,
      trackDaily: parsed.data.trackDaily,
      inLogbook: parsed.data.inLogbook,
    });
    return NextResponse.json({ id: saved.flight.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save flight";
    if (/Foreign key constraint|UserFlight_userId_fkey/i.test(message)) {
      return NextResponse.json(
        { error: "SESSION_EXPIRED", code: "SESSION_EXPIRED" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
