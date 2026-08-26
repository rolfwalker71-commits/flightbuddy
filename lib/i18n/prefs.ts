import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_PREFS, isLocale, isMapStyle, isTheme, isUnits, type Prefs } from "./messages";
import { parseCookiePrefs } from "./pref-cookies";

export {
  cookieOptions,
  LOCALE_COOKIE,
  MAP_COOKIE,
  THEME_COOKIE,
  UNITS_COOKIE,
} from "./pref-cookies";

export async function getRequestPrefs(): Promise<Prefs> {
  const jar = await cookies();
  const fromCookies = parseCookiePrefs((name) => jar.get(name)?.value);
  let fromDb: Partial<Prefs> = {};

  try {
    const session = await auth();
    if (session?.user?.id) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { locale: true, units: true, theme: true, mapStyle: true },
      });
      if (user) {
        fromDb = {
          locale: isLocale(user.locale) ? user.locale : undefined,
          units: isUnits(user.units) ? user.units : undefined,
          theme: isTheme(user.theme) ? user.theme : undefined,
          mapStyle: isMapStyle(user.mapStyle) ? user.mapStyle : undefined,
        };
      }
    }
  } catch {
    // auth/db may be unavailable during build or after a stale Prisma client
  }

  return {
    locale: fromCookies.locale ?? fromDb.locale ?? DEFAULT_PREFS.locale,
    units: fromCookies.units ?? fromDb.units ?? DEFAULT_PREFS.units,
    theme: fromCookies.theme ?? fromDb.theme ?? DEFAULT_PREFS.theme,
    mapStyle: fromCookies.mapStyle ?? fromDb.mapStyle ?? DEFAULT_PREFS.mapStyle,
  };
}
