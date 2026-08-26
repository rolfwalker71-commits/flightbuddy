import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  cookieOptions,
  LOCALE_COOKIE,
  MAP_COOKIE,
  THEME_COOKIE,
  UNITS_COOKIE,
} from "@/lib/i18n/pref-cookies";
import { isLocale, isMapStyle, isTheme, isUnits, type Prefs } from "@/lib/i18n/messages";

const schema = z.object({
  locale: z.enum(["de", "en"]).optional(),
  units: z.enum(["metric", "imperial"]).optional(),
  theme: z.enum(["dark", "light"]).optional(),
  mapStyle: z.enum(["dark", "voyager", "positron", "osm", "satellite", "topo"]).optional(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid prefs" }, { status: 400 });

  let saved: Partial<Prefs> = parsed.data;
  try {
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: parsed.data,
      select: { locale: true, units: true, theme: true, mapStyle: true },
    });
    saved = {
      locale: isLocale(user.locale) ? user.locale : undefined,
      units: isUnits(user.units) ? user.units : undefined,
      theme: isTheme(user.theme) ? user.theme : undefined,
      mapStyle: isMapStyle(user.mapStyle) ? user.mapStyle : undefined,
    };
  } catch {
    // Keep cookie persistence even if the Prisma client is stale.
  }

  const res = NextResponse.json(saved);
  if (saved.locale) res.cookies.set(LOCALE_COOKIE, saved.locale, cookieOptions());
  if (saved.units) res.cookies.set(UNITS_COOKIE, saved.units, cookieOptions());
  if (saved.theme) res.cookies.set(THEME_COOKIE, saved.theme, cookieOptions());
  if (saved.mapStyle) res.cookies.set(MAP_COOKIE, saved.mapStyle, cookieOptions());
  return res;
}
