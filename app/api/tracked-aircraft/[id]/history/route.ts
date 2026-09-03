import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getTrackedAircraftHistory } from "@/lib/tracked-aircraft";
import { toPlain } from "@/lib/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const history = await getTrackedAircraftHistory(session.user.id, id);
  if (!history) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toPlain(history));
}
