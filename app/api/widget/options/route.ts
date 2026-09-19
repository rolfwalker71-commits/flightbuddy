import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWidgetOptions, updateWidgetOptions, widgetOptionsSchema } from "@/lib/widget";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ options: await getWidgetOptions(session.user.id) });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = widgetOptionsSchema.partial().safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid options" }, { status: 400 });
  return NextResponse.json({ options: await updateWidgetOptions(session.user.id, parsed.data) });
}
