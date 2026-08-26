import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAircraftHistory } from "@/lib/aircraft-history";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await getAircraftHistory(session.user.id, id);
  if (result.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result.payload);
}
