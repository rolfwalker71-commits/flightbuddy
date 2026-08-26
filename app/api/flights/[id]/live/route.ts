import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadLiveUserFlight } from "@/lib/polling";
import { toPlain } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const row = await loadLiveUserFlight(session.user.id, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toPlain(row), {
    headers: { "Cache-Control": "no-store" },
  });
}
