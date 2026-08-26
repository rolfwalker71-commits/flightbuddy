import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { fr24Config, hasAeroDataBox, hasFr24Token, hasOpenSkyAuth } from "@/lib/server-env";

async function fr24Health(): Promise<string> {
  if (!hasFr24Token()) return "unconfigured";
  if (!fr24Config().envEnabled) return "ok";
  try {
    const last = await prisma.apiLog.findFirst({
      where: { provider: "fr24" },
      orderBy: { createdAt: "desc" },
    });
    if (last && last.ok === false) return "error";
  } catch {
    return "error";
  }
  return "ok";
}

export async function GET() {
  const checks: Record<string, string> = {
    app: "ok",
    aero: hasAeroDataBox() ? "ok" : "unconfigured",
    opensky: hasOpenSkyAuth() ? "ok" : "unconfigured",
    fr24: await fr24Health(),
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
