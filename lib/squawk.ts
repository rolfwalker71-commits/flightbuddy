import { t, type Locale } from "./i18n/messages";

/** Internationally defined emergency/special squawk codes. */
export const EMERGENCY_SQUAWKS = ["7500", "7600", "7700"] as const;
export type EmergencySquawk = (typeof EMERGENCY_SQUAWKS)[number];

export function normalizeSquawk(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim().replace(/\s+/g, "");
  if (!/^[0-7]{4}$/.test(raw)) return null;
  return raw;
}

export function isEmergencySquawk(value: string | null | undefined): value is EmergencySquawk {
  return Boolean(value && (EMERGENCY_SQUAWKS as readonly string[]).includes(value));
}

/** True when we should fire an alert (new emergency, or code changed between emergencies). */
export function shouldAlertEmergencySquawk(
  previous: string | null | undefined,
  next: string | null | undefined,
): next is EmergencySquawk {
  if (!isEmergencySquawk(next)) return false;
  return previous !== next;
}

export function squawkMeaningKey(code: EmergencySquawk): "squawk.hijack" | "squawk.radioFail" | "squawk.emergency" {
  if (code === "7500") return "squawk.hijack";
  if (code === "7600") return "squawk.radioFail";
  return "squawk.emergency";
}

export function squawkLabel(locale: Locale, code: string) {
  if (!isEmergencySquawk(code)) return code;
  return t(locale, squawkMeaningKey(code));
}

export function squawkEventKind(code: EmergencySquawk) {
  return `squawk_${code}` as const;
}
