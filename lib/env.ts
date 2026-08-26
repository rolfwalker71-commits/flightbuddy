function trimEnv(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export const env = {
  appUrl: trimEnv(process.env.APP_URL) ?? trimEnv(process.env.NEXTAUTH_URL) ?? "http://localhost:3377",
  authSecret: trimEnv(process.env.AUTH_SECRET) ?? trimEnv(process.env.NEXTAUTH_SECRET),
  databaseUrl: trimEnv(process.env.DATABASE_URL),
  redisUrl: trimEnv(process.env.REDIS_URL) ?? "redis://localhost:6379",
  openskyUser: trimEnv(process.env.OPENSKY_USERNAME),
  openskyPass: trimEnv(process.env.OPENSKY_PASSWORD),
  // Must be a static `process.env.AERODATABOX_KEY` access. Next/Turbopack does not
  // expose secrets through dynamic `process.env[name]`, which left search unconfigured.
  aeroKey: trimEnv(process.env.AERODATABOX_KEY),
  aeroHost: trimEnv(process.env.AERODATABOX_HOST) ?? "aerodatabox.p.rapidapi.com",
  vapidPublic: trimEnv(process.env.VAPID_PUBLIC_KEY),
  vapidPrivate: trimEnv(process.env.VAPID_PRIVATE_KEY),
  vapidSubject: trimEnv(process.env.VAPID_SUBJECT) ?? "mailto:flightbuddy@localhost",
  openskyMinIntervalMs: (() => {
    const n = Number(process.env.OPENSKY_MIN_INTERVAL_MS);
    return Number.isFinite(n) && n > 0 ? n : 90_000;
  })(),
  preflightWindowHours: Number(process.env.PREFLIGHT_WINDOW_HOURS ?? 2),
};

export function hasOpenSkyAuth() {
  return Boolean(env.openskyUser && env.openskyPass);
}

export function hasAeroDataBox() {
  return Boolean(env.aeroKey);
}

/** Env override only. Runtime keys live in AppSetting via lib/vapid.ts. */
export function hasVapidEnv() {
  return Boolean(env.vapidPublic && env.vapidPrivate);
}
