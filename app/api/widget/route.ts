import { NextResponse } from "next/server";
import { buildWidgetFeed, userIdForWidgetToken } from "@/lib/widget";

/** Read-only flight feed for home-screen widgets. Auth: `Authorization: Bearer fbw_…`. */
export async function GET(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const userId = await userIdForWidgetToken(token);
  if (!userId) {
    return NextResponse.json({ error: "Invalid widget token" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const feed = await buildWidgetFeed(userId);
  return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
}
