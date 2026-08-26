"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_PREFS, t, type Locale, type MessageKey, type Prefs } from "@/lib/i18n/messages";
import { writeClientPrefCookies } from "@/lib/i18n/pref-cookies";

type PrefsContextValue = {
  prefs: Prefs;
  updatePrefs: (next: Partial<Prefs>) => void;
};

const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFS,
  updatePrefs: () => {},
});

const DARK_THEME_COLOR = "#0B0D10";
const LIGHT_THEME_COLOR = "#F7F9FB";

function samePrefs(a: Prefs, b: Prefs) {
  return (
    a.locale === b.locale &&
    a.units === b.units &&
    a.theme === b.theme &&
    a.mapStyle === b.mapStyle
  );
}

export function applyAppearance(prefs: Prefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", prefs.theme === "dark");
  root.lang = prefs.locale;
  root.style.colorScheme = prefs.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", prefs.theme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
  writeClientPrefCookies(prefs);
}

export function PrefsProvider({ prefs, children }: { prefs: Prefs; children: ReactNode }) {
  const [current, setCurrent] = useState(prefs);

  useEffect(() => {
    applyAppearance(current);
  }, [current]);

  const updatePrefs = useCallback((next: Partial<Prefs>) => {
    setCurrent((prev) => {
      const merged = { ...prev, ...next };
      applyAppearance(merged);
      return samePrefs(prev, merged) ? prev : merged;
    });
  }, []);

  const value = useMemo(() => ({ prefs: current, updatePrefs }), [current, updatePrefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  return useContext(PrefsContext).prefs;
}

export function useUpdatePrefs() {
  return useContext(PrefsContext).updatePrefs;
}

export function useT() {
  const { locale } = usePrefs();
  return (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}

export function useLocale(): Locale {
  return usePrefs().locale;
}
