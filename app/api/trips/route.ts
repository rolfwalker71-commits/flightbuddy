import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createTrip, listUserTrips, removeTrip } from "@/lib/trips";
import { toPlain } from "@/lib/serialize";

const createSchema = z.object({
  name: z.string().max(120).nullish(),
  userFlightIds: z.array(z.string().min(1)).min(2).optional(),
  flightIds: z.array(z.string().min(1)).min(2).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const trips = await listUserTrips(session.user.id);
  return NextResponse.json(toPlain(trips));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid trip" }, { status: 400 });

  try {
    let userFlightIds = parsed.data.userFlightIds ?? [];
    if (!userFlightIds.length && parsed.data.flightIds?.length) {
      const { prisma } = await import("@/lib/db");
      const rows = await prisma.userFlight.findMany({
        where: { userId: session.user.id, flightId: { in: parsed.data.flightIds } },
        select: { id: true },
      });
      userFlightIds = rows.map((r) => r.id);
    }
    const trip = await createTrip({
      userId: session.user.id,
      name: parsed.data.name,
      userFlightIds,
    });
    return NextResponse.json({ id: trip.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const trip = await removeTrip(session.user.id, id);
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
