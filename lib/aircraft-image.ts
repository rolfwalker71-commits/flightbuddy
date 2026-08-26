import { lookupAeroAircraftImage } from "./aerodatabox";
import { env } from "./env";
import { getRedis } from "./redis";
import type { AircraftPhoto } from "./aircraft-image-types";

export type { AircraftPhoto, AircraftPhotoSource } from "./aircraft-image-types";

const CACHE_PREFIX = "aircraft-image:v2:";
const CACHE_HIT_MS = 12 * 60 * 60 * 1000;
const CACHE_MISS_MS = 2 * 60 * 60 * 1000;
const CACHE_ERROR_MS = 5 * 60 * 1000;

function normalizeRegistration(reg: string) {
  return reg.toUpperCase().replace(/[\s]+/g, "").replace(/[–—]/g, "-");
}

function safeHttpUrl(raw?: string) {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // ignore malformed provider URLs
  }
  return undefined;
}

async function cacheGet(reg: string): Promise<AircraftPhoto | null | undefined> {
  try {
    const raw = await getRedis().get(`${CACHE_PREFIX}${reg}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { photo: AircraftPhoto | null };
    return parsed.photo;
  } catch {
    return undefined;
  }
}

async function cacheSet(reg: string, photo: AircraftPhoto | null, ttlMs: number) {
  try {
    await getRedis().set(`${CACHE_PREFIX}${reg}`, JSON.stringify({ photo }), "PX", ttlMs);
  } catch {
    // Cache must never block a page render.
  }
}

type PlanespottersThumb = { src?: unknown; size?: { width?: unknown; height?: unknown } };
type PlanespottersPhoto = {
  photographer?: unknown;
  link?: unknown;
  thumbnail?: PlanespottersThumb;
  thumbnail_large?: PlanespottersThumb;
};

function thumbSrc(thumb?: PlanespottersThumb) {
  return typeof thumb?.src === "string" ? safeHttpUrl(thumb.src) : undefined;
}

function pickPlanespottersPhoto(photos: PlanespottersPhoto[]): AircraftPhoto | null {
  const usable = photos.filter((row) => thumbSrc(row.thumbnail) || thumbSrc(row.thumbnail_large));
  if (!usable.length) return null;
  const row = usable[Math.floor(Math.random() * usable.length)]!;
  // Prefer the larger documented thumb so the header can object-cover a closer airframe crop.
  const url = thumbSrc(row.thumbnail_large) ?? thumbSrc(row.thumbnail);
  if (!url) return null;
  const photographer = typeof row.photographer === "string" ? row.photographer.trim() : "";
  return {
    url,
    photographer: photographer || undefined,
    source: "planespotters",
    sourceUrl: typeof row.link === "string" ? safeHttpUrl(row.link) : undefined,
  };
}

/**
 * Documented public photo API: https://www.planespotters.net/photo/api
 * GET /pub/photos/reg/{reg} — requires an identifying User-Agent.
 */
async function lookupPlanespottersPhoto(registration: string): Promise<AircraftPhoto | null> {
  const contact = env.appUrl.replace(/\/$/, "");
  const res = await fetch(
    `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(registration)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": `FlightBuddy/0.1 (+${contact})`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    },
  );
  if (!res.ok) return null;
  const json: unknown = await res.json();
  if (!json || typeof json !== "object") return null;
  const photos = (json as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return null;
  return pickPlanespottersPhoto(photos as PlanespottersPhoto[]);
}

export async function lookupAircraftPhoto(
  registration?: string | null,
): Promise<AircraftPhoto | null> {
  const reg = registration?.trim() ? normalizeRegistration(registration) : "";
  if (!reg) return null;

  const cached = await cacheGet(reg);
  if (cached !== undefined) return cached;

  try {
    const aero = await lookupAeroAircraftImage(reg);
    if (aero) {
      const photo: AircraftPhoto = {
        url: aero.url,
        photographer: aero.author,
        source: "aerodatabox",
        sourceUrl: aero.webUrl,
        license: aero.license,
      };
      await cacheSet(reg, photo, CACHE_HIT_MS);
      return photo;
    }

    const spotter = await lookupPlanespottersPhoto(reg);
    await cacheSet(reg, spotter, spotter ? CACHE_HIT_MS : CACHE_MISS_MS);
    return spotter;
  } catch {
    await cacheSet(reg, null, CACHE_ERROR_MS);
    return null;
  }
}
