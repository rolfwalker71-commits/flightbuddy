import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getVapidConfig } from "@/lib/vapid";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = await getVapidConfig();
  if (!cfg) return NextResponse.json({ error: "Push not available" }, { status: 503 });
  return NextResponse.json({ publicKey: cfg.publicKey, subject: cfg.subject });
}
