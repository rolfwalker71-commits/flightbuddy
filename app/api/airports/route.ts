import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim().toUpperCase() ?? "";
  if (q.length < 2) return NextResponse.json({ airports: [] });
  const airports = await prisma.airport.findMany({
    where: {
      OR: [
        { iata: { startsWith: q } },
        { icao: { startsWith: q } },
        { city: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 12,
    orderBy: { iata: "asc" },
  });
  return NextResponse.json({ airports });
}
