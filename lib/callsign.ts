/** OpenSky pads callsigns with spaces (`RGA08   `). Keep letters+digits only. */
export function compactCallsign(value: string) {
  return value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

/**
 * Label form: keep short numbers as seen (RGA08, RGA1, RGA12).
 * Does not invent a 4-digit mission number and does not strip leading zeros.
 */
export function displayCallsign(value?: string | null, fallback = "") {
  if (!value) return fallback;
  return compactCallsign(value) || fallback;
}

/** REGA Swiss air rescue: prefix RGA + 1–3 digits (RGA08, RGA1, RGA12). */
export function isRegaCallsign(value?: string | null) {
  if (!value) return false;
  return /^RGA\d{1,3}$/.test(compactCallsign(value));
}

/** Any RGA + digits after OpenSky padding — still REGA, even if the number is unusual. */
export function isRegaPrefix(value?: string | null) {
  if (!value) return false;
  const compact = compactCallsign(value);
  return compact === "RGA" || /^RGA\d+$/.test(compact);
}

/** Strip spaces and leading zeros in the numeric part: SWR065 → SWR65. RGA08 → RGA8. */
export function normalizeCallsign(value: string) {
  const compact = compactCallsign(value);
  const match = compact.match(/^([A-Z]+)0*([0-9]+[A-Z]*)$/);
  return match ? `${match[1]}${match[2]}` : compact;
}

export function candidateCallsigns(opts: {
  flightNumber: string;
  airlineIata?: string | null;
  airlineIcao?: string | null;
}) {
  const num = normalizeCallsign(opts.flightNumber);
  const digits = num.replace(/^[A-Z]+/, "");
  const set = new Set<string>();
  if (num) set.add(num);
  if (opts.airlineIcao && digits) set.add(normalizeCallsign(`${opts.airlineIcao}${digits}`));
  if (opts.airlineIata && digits) set.add(normalizeCallsign(`${opts.airlineIata}${digits}`));
  return [...set];
}

export function matchesCallsign(callsign: string | null, candidates: string[]) {
  if (!callsign) return false;
  const normalized = normalizeCallsign(callsign);
  return candidates.some((cand) => {
    const n = normalizeCallsign(cand);
    if (normalized === n) return true;
    // Allow a trailing letter suffix (SWR65A) but not extra digits (SWR650).
    return normalized.startsWith(n) && /^[A-Z]+$/.test(normalized.slice(n.length));
  });
}
