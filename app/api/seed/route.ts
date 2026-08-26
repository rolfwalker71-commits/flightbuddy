import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { importOpenData, seedCoreMasterData } from "@/lib/seed";

export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const counts = await seedCoreMasterData();
  const imported = await importOpenData("all");
  return NextResponse.json({ counts, imported });
}
