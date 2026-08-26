export const HOME_MAP_CAMERA_KEY = "fb:homeMap";
export const HOME_MAP_TRAFFIC_KEY = "fb:homeMap.traffic";

export type PersistedMapCamera = {
  lng: number;
  lat: number;
  zoom: number;
};

function clampZoom(zoom: number) {
  return Math.min(18, Math.max(1, zoom));
}

function isValidCamera(value: unknown): value is PersistedMapCamera {
  if (!value || typeof value !== "object") return false;
  const { lng, lat, zoom } = value as PersistedMapCamera;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Number.isFinite(zoom) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function readSavedMapCamera(key: string): PersistedMapCamera | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidCamera(parsed)) return null;
    return { lng: parsed.lng, lat: parsed.lat, zoom: clampZoom(parsed.zoom) };
  } catch {
    return null;
  }
}

export function writeSavedMapCamera(key: string, camera: PersistedMapCamera) {
  if (typeof window === "undefined") return;
  if (!isValidCamera(camera)) return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ lng: camera.lng, lat: camera.lat, zoom: clampZoom(camera.zoom) }),
    );
  } catch {
    // private mode / quota
  }
}

export function readFlag(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // private mode / quota
  }
  return fallback;
}

export function writeFlag(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}
