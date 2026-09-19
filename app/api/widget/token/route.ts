import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { issueWidgetToken, revokeWidgetToken, widgetTokenInfo } from "@/lib/widget";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ token: await widgetTokenInfo(session.user.id) });
}

/** Issues a new token (replacing any previous one). The plain token is only returned here. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await issueWidgetToken(session.user.id), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await revokeWidgetToken(session.user.id);
  return NextResponse.json({ ok: true });
}
