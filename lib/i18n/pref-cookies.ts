import { isLocale, isMapStyle, isTheme, isUnits, type Prefs } from "./messages";

export const LOCALE_COOKIE = "fb_locale";
export const UNITS_COOKIE = "fb_units";
export const THEME_COOKIE = "fb_theme";
export const MAP_COOKIE = "fb_map";

export function cookieOptions() {
  return { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
}

export function parseCookiePrefs(get: (name: string) => string | undefined): Partial<Prefs> {
  const locale = get(LOCALE_COOKIE);
  const units = get(UNITS_COOKIE);
  const theme = get(THEME_COOKIE);
  const mapStyle = get(MAP_COOKIE);
  return {
    ...(isLocale(locale) ? { locale } : {}),
    ...(isUnits(units) ? { units } : {}),
    ...(isTheme(theme) ? { theme } : {}),
    ...(isMapStyle(mapStyle) ? { mapStyle } : {}),
  };
}

export function writeClientPrefCookies(prefs: Partial<Prefs>) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 365;
  const pairs: [string, string | undefined][] = [
    [LOCALE_COOKIE, prefs.locale],
    [UNITS_COOKIE, prefs.units],
    [THEME_COOKIE, prefs.theme],
    [MAP_COOKIE, prefs.mapStyle],
  ];
  for (const [name, value] of pairs) {
    if (!value) continue;
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
  }
}
