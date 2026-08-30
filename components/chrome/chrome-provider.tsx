"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyChromeStyle,
  chromeThemeColor,
  DESKTOP_MQ,
  persistChromePreference,
  readChromePreference,
  resolveChromeStyle,
  type ChromePreference,
  type ChromeStyle,
} from "@/lib/platform";

type ChromeContextValue = {
  preference: ChromePreference;
  chrome: ChromeStyle;
  setChrome: (next: ChromePreference) => void;
};

const ChromeContext = createContext<ChromeContextValue | null>(null);

function useWideViewport(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function syncThemeColor(style: ChromeStyle) {
  const dark = document.documentElement.classList.contains("dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", chromeThemeColor(style, dark));
}

export function ChromeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ChromePreference>("auto");
  const wide = useWideViewport();
  const chrome = resolveChromeStyle(preference, wide);

  useEffect(() => {
    setPreference(readChromePreference());
  }, []);

  useEffect(() => {
    applyChromeStyle(chrome);
    syncThemeColor(chrome);
  }, [chrome]);

  const value = useMemo<ChromeContextValue>(
    () => ({
      preference,
      chrome,
      setChrome(next) {
        persistChromePreference(next);
        setPreference(next);
      },
    }),
    [preference, chrome],
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeContextValue {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error("useChrome must be used within ChromeProvider");
  return ctx;
}
