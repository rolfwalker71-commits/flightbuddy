import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function formatDuration(minutes: number | null | undefined) {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const abs = Math.max(0, Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Parse `yyyy-MM-dd` as a local calendar date (not UTC midnight). */
export function parseLocalIsoDate(iso: string): Date {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function parseFlightQuery(raw: string) {
  const q = raw.trim().toUpperCase().replace(/\s+/g, "");
  const route = q.match(/^([A-Z]{3})[-–>]([A-Z]{3})$/);
  if (route) {
    return { kind: "route" as const, from: route[1], to: route[2] };
  }
  // IATA (LH, U2, 3U) or ICAO (SWR); optional hyphen: LX-1954
  const flight = q.match(/^([A-Z0-9]{2}|[A-Z]{3})[-–]?(\d{1,4}[A-Z]?)$/);
  if (flight) {
    const number = flight[2].replace(/^0+(?=\d)/, "");
    return {
      kind: "flight" as const,
      airline: flight[1],
      number,
      flightNumber: `${flight[1]}${number}`,
    };
  }
  return { kind: "unknown" as const, raw: q };
}

export function displayFlightNumber(code: string) {
  const m = code.toUpperCase().match(/^([A-Z]{2,3})(\d.*)$/);
  return m ? `${m[1]} ${m[2]}` : code.toUpperCase();
}

export function initials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  }
  return (email?.[0] ?? "U").toUpperCase();
}
