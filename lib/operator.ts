import { compactCallsign, displayCallsign, isRegaPrefix } from "./callsign";

/** Swiss air rescue. ICAO telephony RGA; no commercial IATA — do not invent one. */
export const REGA_OPERATOR = "REGA";

export { isRegaPrefix };

export function resolveOperator(opts: {
  callsign?: string | null;
  airlineName?: string | null;
  airlineIata?: string | null;
}): { operator: string | null; airlineIata: string | null } {
  if (isRegaPrefix(opts.callsign)) {
    return { operator: REGA_OPERATOR, airlineIata: null };
  }
  const name = opts.airlineName?.trim() || null;
  const iata = opts.airlineIata?.trim().toUpperCase() || null;
  return { operator: name, airlineIata: iata && iata.length >= 2 && iata.length <= 3 ? iata : null };
}

export function objectLabel(callsign?: string | null, icao24?: string | null) {
  return displayCallsign(callsign, icao24 ? compactCallsign(icao24).slice(0, 6) : "");
}
