const STORAGE_PREFIX = "fb:mapZoom:";
export const DEFAULT_MAP_ZOOM = 7;

function clampZoom(zoom: number) {
  return Math.min(18, Math.max(1, zoom));
}

export function mapZoomStorageKey(flightId: string) {
  return `${STORAGE_PREFIX}${flightId}`;
}

export function readSavedMapZoom(flightId: string, fallback = DEFAULT_MAP_ZOOM): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(mapZoomStorageKey(flightId));
    const zoom = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(zoom)) return fallback;
    return clampZoom(zoom);
  } catch {
    return fallback;
  }
}

export function writeSavedMapZoom(flightId: string, zoom: number) {
  if (typeof window === "undefined" || !Number.isFinite(zoom)) return;
  try {
    window.localStorage.setItem(mapZoomStorageKey(flightId), String(clampZoom(zoom)));
  } catch {
    // private mode / quota
  }
}
