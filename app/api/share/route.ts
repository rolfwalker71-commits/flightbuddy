import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createFlightShare, createTripShare, getFlightShareToken, revokeShare } from "@/lib/share";

const createSchema = z.object({
  flightId: z.string().optional(),
  tripId: z.string().optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const flightId = new URL(req.url).searchParams.get("flightId");
  if (!flightId) return NextResponse.json({ error: "Missing flightId" }, { status: 400 });
  const token = await getFlightShareToken(session.user.id, flightId);
  return NextResponse.json({ token });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid share" }, { status: 400 });

  if (parsed.data.tripId) {
    const link = await createTripShare(session.user.id, parsed.data.tripId);
    if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ token: link.token, url: `/s/${link.token}` });
  }
  if (parsed.data.flightId) {
    const link = await createFlightShare(session.user.id, parsed.data.flightId);
    if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ token: link.token, url: `/s/${link.token}` });
  }
  return NextResponse.json({ error: "Missing target" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const row = await revokeShare(session.user.id, token);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
