import { prisma } from "./db";
import { fr24Config, hasAeroDataBox, hasFr24Token, hasOpenSkyAuth } from "./server-env";

export const QUOTA_SETTING_AERO = "quota:aerodatabox";
export const QUOTA_SETTING_OPENSKY = "quota:opensky";
export const QUOTA_SETTING_FR24 = "quota:fr24";
export const FR24_ENABLED_SETTING = "fr24:enabled";

export type StoredQuota = {
  remaining: number | null;
  limit: number | null;
  resetSeconds: number | null;
  dailyRemaining: number | null;
  dailyLimit: number | null;
  observedAt: string;
};

export type ProviderUsage = {
  configured: boolean;
  enabled: boolean;
  preferenceEnabled?: boolean;
  envEnabled?: boolean;
  healthy: boolean;
  usedToday: number;
  remaining: number | null;
  limit: number | null;
  dailyRemaining: number | null;
  dailyLimit: number | null;
  observedAt: string | null;
};

export type ApiUsageSnapshot = {
  aerodatabox: ProviderUsage;
  opensky: ProviderUsage;
  fr24: ProviderUsage;
};

function headerInt(headers: Headers, ...names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw == null || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function parseAeroQuotaHeaders(headers: Headers): StoredQuota | null {
  const remaining = headerInt(headers, "x-ratelimit-requests-remaining");
  const limit = headerInt(headers, "x-ratelimit-requests-limit");
  const resetSeconds = headerInt(headers, "x-ratelimit-requests-reset");
  const dailyRemaining = headerInt(
    headers,
    "x-ratelimit-rapid-free-plans-hard-limit-remaining",
  );
  const dailyLimit = headerInt(headers, "x-ratelimit-rapid-free-plans-hard-limit-limit");
  if (
    remaining == null &&
    limit == null &&
    dailyRemaining == null &&
    dailyLimit == null
  ) {
    return null;
  }
  return {
    remaining,
    limit,
    resetSeconds,
    dailyRemaining,
    dailyLimit,
    observedAt: new Date().toISOString(),
  };
}

export function parseOpenSkyQuotaHeaders(headers: Headers): StoredQuota | null {
  const remaining = headerInt(headers, "x-rate-limit-remaining");
  if (remaining == null) return null;
  return {
    remaining,
    limit: null,
    resetSeconds: headerInt(headers, "x-rate-limit-retry-after-seconds"),
    dailyRemaining: remaining,
    dailyLimit: null,
    observedAt: new Date().toISOString(),
  };
}

/** Persist remaining credits only when FR24 actually sends a credit header. Do not invent. */
export function parseFr24QuotaHeaders(headers: Headers): StoredQuota | null {
  const remaining = headerInt(
    headers,
    "x-credits-remaining",
    "x-credit-remaining",
    "credits-remaining",
    "x-remaining-credits",
    "x-api-credits-remaining",
  );
  const limit = headerInt(headers, "x-credits-limit", "x-credit-limit", "credits-limit");
  if (remaining == null && limit == null) return null;
  return {
    remaining,
    limit,
    resetSeconds: null,
    dailyRemaining: null,
    dailyLimit: null,
    observedAt: new Date().toISOString(),
  };
}

async function persistQuota(key: string, quota: StoredQuota) {
  try {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(quota) },
      update: { value: JSON.stringify(quota) },
    });
  } catch {
    // Quota display must never fail a provider call.
  }
}

export async function persistAeroQuota(headers: Headers) {
  const quota = parseAeroQuotaHeaders(headers);
  if (quota) await persistQuota(QUOTA_SETTING_AERO, quota);
}

export async function persistOpenSkyQuota(headers: Headers) {
  const quota = parseOpenSkyQuotaHeaders(headers);
  if (quota) await persistQuota(QUOTA_SETTING_OPENSKY, quota);
}

export async function persistFr24Quota(headers: Headers) {
  const quota = parseFr24QuotaHeaders(headers);
  if (quota) await persistQuota(QUOTA_SETTING_FR24, quota);
}

export async function getStoredOpenSkyRemaining(): Promise<number | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: QUOTA_SETTING_OPENSKY } });
    return parseStored(row?.value)?.remaining ?? null;
  } catch {
    return null;
  }
}

function parseStored(raw?: string | null): StoredQuota | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredQuota;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function emptyUsage(configured: boolean, enabled = configured): ProviderUsage {
  return {
    configured,
    enabled,
    healthy: configured && enabled,
    usedToday: 0,
    remaining: null,
    limit: null,
    dailyRemaining: null,
    dailyLimit: null,
    observedAt: null,
  };
}

export async function getApiUsageSnapshot(): Promise<ApiUsageSnapshot> {
  const since = utcDayStart();
  const [aeroLast, openLast, fr24Last, aeroCount, openCount, fr24Count, aeroStored, openStored, fr24Stored, fr24Pref] =
    await Promise.all([
      prisma.apiLog.findFirst({ where: { provider: "aerodatabox" }, orderBy: { createdAt: "desc" } }),
      prisma.apiLog.findFirst({ where: { provider: "opensky" }, orderBy: { createdAt: "desc" } }),
      prisma.apiLog.findFirst({ where: { provider: "fr24" }, orderBy: { createdAt: "desc" } }),
      prisma.apiLog.count({ where: { provider: "aerodatabox", createdAt: { gte: since } } }),
      prisma.apiLog.count({ where: { provider: "opensky", createdAt: { gte: since } } }),
      prisma.apiLog.count({ where: { provider: "fr24", createdAt: { gte: since } } }),
      prisma.appSetting.findUnique({ where: { key: QUOTA_SETTING_AERO } }),
      prisma.appSetting.findUnique({ where: { key: QUOTA_SETTING_OPENSKY } }),
      prisma.appSetting.findUnique({ where: { key: QUOTA_SETTING_FR24 } }),
      prisma.appSetting.findUnique({ where: { key: FR24_ENABLED_SETTING } }),
    ]);

  const aeroQuota = parseStored(aeroStored?.value);
  const openQuota = parseStored(openStored?.value);
  const fr24Quota = parseStored(fr24Stored?.value);
  const aeroConfigured = hasAeroDataBox();
  const openConfigured = hasOpenSkyAuth();
  const fr24Configured = hasFr24Token();
  const fr24PrefOn = !fr24Pref || (fr24Pref.value !== "false" && fr24Pref.value !== "0");
  const fr24Enabled = fr24Configured && fr24Config().envEnabled && fr24PrefOn;

  return {
    aerodatabox: {
      ...emptyUsage(aeroConfigured),
      healthy: aeroConfigured && aeroLast?.ok !== false,
      usedToday: aeroCount,
      remaining: aeroQuota?.remaining ?? null,
      limit: aeroQuota?.limit ?? null,
      dailyRemaining: aeroQuota?.dailyRemaining ?? null,
      dailyLimit: aeroQuota?.dailyLimit ?? null,
      observedAt: aeroQuota?.observedAt ?? null,
    },
    opensky: {
      ...emptyUsage(openConfigured),
      healthy: openConfigured && openLast?.ok !== false,
      usedToday: openCount,
      remaining: openQuota?.remaining ?? null,
      limit: openQuota?.limit ?? null,
      dailyRemaining: openQuota?.dailyRemaining ?? null,
      dailyLimit: openQuota?.dailyLimit ?? null,
      observedAt: openQuota?.observedAt ?? null,
    },
    fr24: {
      ...emptyUsage(fr24Configured, fr24Enabled),
      preferenceEnabled: fr24PrefOn,
      envEnabled: fr24Config().envEnabled,
      healthy: fr24Enabled && fr24Last?.ok !== false,
      usedToday: fr24Count,
      remaining: fr24Quota?.remaining ?? null,
      limit: fr24Quota?.limit ?? null,
      dailyRemaining: fr24Quota?.dailyRemaining ?? null,
      dailyLimit: fr24Quota?.dailyLimit ?? null,
      observedAt: fr24Quota?.observedAt ?? null,
    },
  };
}
