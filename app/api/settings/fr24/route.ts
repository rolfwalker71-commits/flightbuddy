import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isFr24PreferenceEnabled, setFr24PreferenceEnabled } from "@/lib/fr24";
import { fr24Config, hasFr24Token } from "@/lib/server-env";

const schema = z.object({
  enabled: z.boolean(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const prefEnabled = await isFr24PreferenceEnabled();
  return NextResponse.json({
    configured: hasFr24Token(),
    envEnabled: fr24Config().envEnabled,
    enabled: hasFr24Token() && fr24Config().envEnabled && prefEnabled,
  });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  await setFr24PreferenceEnabled(parsed.data.enabled);
  const prefEnabled = await isFr24PreferenceEnabled();
  return NextResponse.json({
    configured: hasFr24Token(),
    envEnabled: fr24Config().envEnabled,
    enabled: hasFr24Token() && fr24Config().envEnabled && prefEnabled,
  });
}
