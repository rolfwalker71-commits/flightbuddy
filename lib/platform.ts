export type ChromeStyle = "ios" | "android" | "desktop";
export type ChromePreference = "auto" | ChromeStyle;

export const CHROME_KEY = "flightbuddy-chrome";
export const DESKTOP_MQ = "(min-width: 1024px)";

export const CHROME_OPTIONS: { value: ChromePreference; labelKey: string; hintKey: string }[] = [
  { value: "auto", labelKey: "settings.chromeAuto", hintKey: "settings.chromeAutoHint" },
  { value: "android", labelKey: "settings.chromeAndroid", hintKey: "settings.chromeAndroidHint" },
  { value: "desktop", labelKey: "settings.chromeWindows", hintKey: "settings.chromeWindowsHint" },
  { value: "ios", labelKey: "settings.chromeIos", hintKey: "settings.chromeIosHint" },
];

type UAData = { platform?: string; mobile?: boolean };

function uaPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  return `${uaData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
}

/** OS hint for auto. Never returns ios — iPhone stays MY3 unless forced. */
export function detectOsHint(): "android" | "desktop" | null {
  if (typeof navigator === "undefined") return null;
  const blob = uaPlatform().toLowerCase();
  if (blob.includes("android")) return "android";
  if (blob.includes("win")) return "desktop";
  return null;
}

export function isWideViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

export function readChromePreference(): ChromePreference {
  if (typeof window === "undefined") return "auto";
  const value = window.localStorage.getItem(CHROME_KEY);
  if (value === "auto" || value === "ios" || value === "android" || value === "desktop") return value;
  return "auto";
}

export function resolveChromeStyle(pref: ChromePreference, wide = isWideViewport()): ChromeStyle {
  if (pref === "ios" || pref === "android" || pref === "desktop") return pref;
  return detectOsHint() ?? (wide ? "desktop" : "android");
}

export function readChromeStyle(): ChromeStyle {
  return resolveChromeStyle(readChromePreference());
}

export function applyChromeStyle(style: ChromeStyle): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.chrome = style;
}

export function persistChromePreference(pref: ChromePreference): ChromeStyle {
  window.localStorage.setItem(CHROME_KEY, pref);
  const resolved = resolveChromeStyle(pref);
  applyChromeStyle(resolved);
  return resolved;
}

export function isIslandChrome(style: ChromeStyle): boolean {
  return style === "ios";
}

export function dockBarClass(style: ChromeStyle): string {
  if (style === "ios") {
    return "rounded-2xl bg-card p-1 shadow-lg shadow-black/10 ring-1 ring-border";
  }
  if (style === "android") {
    return "rounded-none border-t border-transparent bg-[hsl(var(--surface-container))] p-0 shadow-none ring-0";
  }
  return "rounded-none border-t border-border bg-card/80 p-0 shadow-none ring-0 backdrop-blur-xl";
}

export function listTileClass(style: ChromeStyle): string {
  if (style === "ios") return "rounded-2xl shadow-lg shadow-black/10 ring-1 ring-border";
  if (style === "android") return "rounded-[var(--tile-radius)] shadow-none ring-0";
  return "rounded-[var(--tile-radius)] shadow-none ring-1 ring-border/80";
}

export function panelClass(style: ChromeStyle): string {
  return `bg-card ${listTileClass(style)}`;
}

export function fabClass(style: ChromeStyle): string {
  if (style === "ios") return "size-14 rounded-full shadow-lg";
  if (style === "android") return "size-16 rounded-[1.75rem] shadow-md";
  return "size-12 rounded-md shadow-sm";
}

export function fabClearance(style: ChromeStyle, docks: 1 | 2 = 1): string {
  if (style === "ios") {
    return docks === 2
      ? "calc(10.25rem + env(safe-area-inset-bottom))"
      : "calc(5.5rem + env(safe-area-inset-bottom))";
  }
  if (style === "android") {
    return docks === 2
      ? "calc(10.5rem + env(safe-area-inset-bottom))"
      : "calc(5.75rem + env(safe-area-inset-bottom))";
  }
  return docks === 2
    ? "calc(8.25rem + env(safe-area-inset-bottom))"
    : "calc(4.25rem + env(safe-area-inset-bottom))";
}

export function chromeThemeColor(style: ChromeStyle, dark: boolean): string {
  if (style === "android") return dark ? "#141218" : "#f7f2fa";
  if (style === "desktop") return dark ? "#202020" : "#f3f3f3";
  return dark ? "#1c1c1e" : "#ffffff";
}

export const CHROME_BOOT_SCRIPT = `(function(){try{var k="flightbuddy-chrome";var p=localStorage.getItem(k);if(p!=="auto"&&p!=="ios"&&p!=="android"&&p!=="desktop")p="auto";var c=p;if(p==="auto"){var n=navigator;var d=n.userAgentData&&n.userAgentData.platform||"";var blob=(d+" "+(n.platform||"")+" "+(n.userAgent||"")).toLowerCase();if(blob.indexOf("android")!==-1)c="android";else if(blob.indexOf("win")!==-1)c="desktop";else c=window.matchMedia("(min-width: 1024px)").matches?"desktop":"android";}document.documentElement.dataset.chrome=c;}catch(e){document.documentElement.dataset.chrome="android";}})();`;
