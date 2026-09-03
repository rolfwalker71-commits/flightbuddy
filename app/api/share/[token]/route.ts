import { NextResponse } from "next/server";
import { getShareByToken } from "@/lib/share";
import { toPlain } from "@/lib/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await getShareByToken(token);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toPlain(payload));
}
