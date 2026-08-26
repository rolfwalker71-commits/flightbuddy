import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { listTrackedAircraft, saveTrackedAircraft } from "@/lib/tracked-aircraft";

export const dynamic = "force-dynamic";

const schema = z.object({
  icao24: z.string().min(4).max(12),
  callsign: z.string().nullish(),
  operator: z.string().nullish(),
  airlineIata: z.string().nullish(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await listTrackedAircraft(session.user.id);
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid aircraft" }, { status: 400 });
  try {
    const item = await saveTrackedAircraft(session.user.id, parsed.data);
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save" },
      { status: 400 },
    );
  }
}
