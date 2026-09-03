import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { addFlightToTrip, removeLegFromTrip, removeTrip } from "@/lib/trips";

const patchSchema = z.object({
  addUserFlightId: z.string().optional(),
  addFlightId: z.string().optional(),
  removeUserFlightId: z.string().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });

  if (parsed.data.removeUserFlightId) {
    const result = await removeLegFromTrip(session.user.id, id, parsed.data.removeUserFlightId);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  }

  let userFlightId = parsed.data.addUserFlightId;
  if (!userFlightId && parsed.data.addFlightId) {
    const { prisma } = await import("@/lib/db");
    const row = await prisma.userFlight.findFirst({
      where: { userId: session.user.id, flightId: parsed.data.addFlightId },
      select: { id: true },
    });
    userFlightId = row?.id;
  }
  if (!userFlightId) return NextResponse.json({ error: "Missing flight" }, { status: 400 });

  const trip = await addFlightToTrip({
    userId: session.user.id,
    tripId: id,
    userFlightId,
  });
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const trip = await removeTrip(session.user.id, id);
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
