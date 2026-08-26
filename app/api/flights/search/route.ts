import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { searchFlights } from "@/lib/flights";
import { parseLocalIsoDate } from "@/lib/utils";

const schema = z.object({
  query: z.string().min(3).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid search" }, { status: 400 });
  const payload = await searchFlights(parsed.data.query, parseLocalIsoDate(parsed.data.date));
  return NextResponse.json(payload);
}
