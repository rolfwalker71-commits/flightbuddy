import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { hasAeroDataBox, hasOpenSkyAuth } from "@/lib/server-env";

export async function GET() {
  const checks: Record<string, string> = {
    app: "ok",
    aero: hasAeroDataBox() ? "ok" : "unconfigured",
    opensky: hasOpenSkyAuth() ? "ok" : "unconfigured",
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }
  try {
    const pong = await getRedis().ping();
    checks.redis = pong === "PONG" ? "ok" : "error";
  } catch {
    checks.redis = "error";
  }
  const ok = (["app", "db", "redis"] as const).every((key) => checks[key] === "ok");
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
