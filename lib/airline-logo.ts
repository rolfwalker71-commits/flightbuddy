/** Unofficial IATA logo CDN (Travelpayouts / pics.avs.io). Not airline-licensed.
 *  PNGs are already RGBA with alpha; there is no separate transparent query param. */
export const AIRLINE_LOGO_SOURCE = "pics.avs.io";

export function airlineLogoUrl(iata?: string | null) {
  const code = iata?.trim().toUpperCase();
  if (!code || code.length < 2 || code.length > 3) return null;
  return `https://pics.avs.io/200/200/${encodeURIComponent(code)}.png`;
}

export function airlineInitials(iata?: string | null, name?: string | null) {
  const code = iata?.trim().toUpperCase();
  if (code && code.length >= 2) return code.slice(0, 2);
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }
  return "?";
}
