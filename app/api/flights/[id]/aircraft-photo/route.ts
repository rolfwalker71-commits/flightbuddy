import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserFlight } from "@/lib/flights";
import { lookupAircraftPhoto } from "@/lib/aircraft-image";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await getUserFlight(session.user.id, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const photo = await lookupAircraftPhoto(row.flight.registration);
  if (!photo) return new NextResponse(null, { status: 204 });
  return NextResponse.json(photo);
}
