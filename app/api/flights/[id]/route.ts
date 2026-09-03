import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { untrackUserFlight } from "@/lib/flights";
import { setTrackDaily } from "@/lib/recurrence";

const schema = z.object({
  pushAlerts: z.boolean().optional(),
  seat: z.string().max(16).nullish(),
  notes: z.string().max(2000).nullish(),
  trackDaily: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  const row = await prisma.userFlight.findFirst({
    where: { userId: session.user.id, flightId: id },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let trackDaily = row.trackDaily;
  if (parsed.data.trackDaily != null) {
    const result = await setTrackDaily(session.user.id, id, parsed.data.trackDaily);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    trackDaily = result.trackDaily;
  }
  const rest = {
    pushAlerts: parsed.data.pushAlerts,
    seat: parsed.data.seat,
    notes: parsed.data.notes,
  };
  if (rest.pushAlerts !== undefined || rest.seat !== undefined || rest.notes !== undefined) {
    await prisma.userFlight.update({
      where: { id: row.id },
      data: {
        ...(rest.pushAlerts !== undefined ? { pushAlerts: rest.pushAlerts } : {}),
        ...(rest.seat !== undefined ? { seat: rest.seat } : {}),
        ...(rest.notes !== undefined ? { notes: rest.notes } : {}),
      },
    });
  }
  return NextResponse.json({
    ok: true,
    trackDaily,
    seat: rest.seat !== undefined ? rest.seat : row.seat,
    notes: rest.notes !== undefined ? rest.notes : row.notes,
    pushAlerts: rest.pushAlerts !== undefined ? rest.pushAlerts : row.pushAlerts,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await untrackUserFlight(session.user.id, id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
