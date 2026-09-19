import { createHash, randomBytes } from "node:crypto";
import { FlightStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { env } from "./env";
import { getUserFlights } from "./flights";
import { flightMetrics, flightTelemetry, type UserFlightView } from "./flight-view";
import { isLiveStatus, isPastStatus } from "./flight-status";
import { airlineLogoUrl } from "./airline-logo";
import { airportTimeZone } from "./airport-tz";
import { statusText } from "./i18n/format";
import { isLocale, isUnits, t, type Locale, type Units } from "./i18n/messages";
import { displayFlightNumber } from "./utils";

const TOKEN_PREFIX = "fbw_";
/** Only bump lastUsedAt this often — widgets refresh every few minutes. */
const LAST_USED_RESOLUTION_MS = 10 * 60 * 1000;
/** Keep a landed flight on the widget this long before moving on. */
const RECENT_LANDING_MS = 90 * 60 * 1000;
const MAX_FLIGHTS = 4;

export type WidgetTone = "live" | "ok" | "warn" | "bad" | "neutral";

/** Options the user sets in FlightBuddy; the script reads them from the feed, so no re-paste is needed. */
export const widgetOptionsSchema = z.object({
  appearance: z.enum(["auto", "dark", "light"]).default("auto"),
  showSeat: z.boolean().default(true),
  showTelemetry: z.boolean().default(true),
  nextFlights: z.number().int().min(0).max(3).default(3),
  includeDaily: z.boolean().default(true),
});

export type WidgetOptions = z.infer<typeof widgetOptionsSchema>;

export function parseWidgetOptions(raw: unknown): WidgetOptions {
  const parsed = widgetOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : widgetOptionsSchema.parse({});
}

export async function getWidgetOptions(userId: string): Promise<WidgetOptions> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { widgetOptions: true } });
  return parseWidgetOptions(user?.widgetOptions);
}

export async function updateWidgetOptions(userId: string, patch: Partial<WidgetOptions>) {
  const next = parseWidgetOptions({ ...(await getWidgetOptions(userId)), ...patch });
  await prisma.user.update({
    where: { id: userId },
    data: { widgetOptions: next as Prisma.InputJsonValue },
  });
  return next;
}

export type WidgetTokenInfo = { hint: string; createdAt: Date; lastUsedAt: Date | null };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function widgetTokenInfo(userId: string): Promise<WidgetTokenInfo | null> {
  return prisma.widgetToken.findUnique({
    where: { userId },
    select: { hint: true, createdAt: true, lastUsedAt: true },
  });
}

/** Creates or replaces the user's widget token. The plain token is only ever returned here. */
export async function issueWidgetToken(userId: string) {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const data = { tokenHash: hashToken(token), hint: token.slice(-4), lastUsedAt: null };
  const row = await prisma.widgetToken.upsert({
    where: { userId },
    create: { userId, ...data },
    update: { ...data, createdAt: new Date() },
    select: { hint: true, createdAt: true, lastUsedAt: true },
  });
  return { token, ...row };
}

export async function revokeWidgetToken(userId: string) {
  await prisma.widgetToken.deleteMany({ where: { userId } });
}

export async function userIdForWidgetToken(token: string | null | undefined) {
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const row = await prisma.widgetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, lastUsedAt: true },
  });
  if (!row) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await prisma.widgetToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row.userId;
}

function iso(value?: Date | string | null) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ms(value?: Date | string | null) {
  const s = iso(value);
  return s ? Date.parse(s) : null;
}

function tone(status: FlightStatus): WidgetTone {
  if (status === FlightStatus.EN_ROUTE || status === FlightStatus.DEPARTED) return "live";
  if (status === FlightStatus.DELAYED) return "warn";
  if (status === FlightStatus.CANCELLED || status === FlightStatus.DIVERTED) return "bad";
  if (status === FlightStatus.LANDED || status === FlightStatus.SCHEDULED || status === FlightStatus.BOARDING) {
    return "ok";
  }
  return "neutral";
}

/** Live first, then a flight that just landed, then upcoming by departure. */
function pickFlights(rows: UserFlightView[], now: number) {
  const depOf = (row: UserFlightView) =>
    ms(row.flight.actualDep) ?? ms(row.flight.estimatedDep) ?? ms(row.flight.scheduledDep) ?? 0;
  const arrOf = (row: UserFlightView) =>
    ms(row.flight.actualArr) ?? ms(row.flight.estimatedArr) ?? ms(row.flight.scheduledArr);

  const live = rows.filter((row) => isLiveStatus(row.flight.status));
  const landed = rows.filter((row) => {
    if (row.flight.status !== FlightStatus.LANDED) return false;
    const arr = arrOf(row);
    return arr != null && now - arr <= RECENT_LANDING_MS;
  });
  const upcoming = rows.filter(
    (row) => !isLiveStatus(row.flight.status) && !isPastStatus(row.flight.status),
  );

  const byDep = (a: UserFlightView, b: UserFlightView) => depOf(a) - depOf(b);
  return [...live.sort(byDep), ...landed.sort(byDep), ...upcoming.sort(byDep)].slice(0, MAX_FLIGHTS);
}

function toWidgetFlight(row: UserFlightView, locale: Locale, now: Date) {
  const { flight } = row;
  const metrics = flightMetrics(flight, now);
  const tel = flightTelemetry(flight, metrics);
  const airlineIata = flight.airline?.iata ?? flight.airlineIata;
  const dep = flight.departureAirport;
  const arr = flight.arrivalAirport;
  return {
    id: flight.id,
    url: `${env.appUrl}/flights/${flight.id}`,
    flightNumber: displayFlightNumber(flight.flightNumber),
    airline: {
      name: flight.airline?.name ?? null,
      iata: airlineIata ?? null,
      logoUrl: airlineLogoUrl(airlineIata),
    },
    status: flight.status,
    statusLabel:
      flight.status === FlightStatus.SCHEDULED
        ? t(locale, "status.onTime")
        : statusText(flight.status, locale, flight.delayMinutes),
    tone: tone(flight.status),
    delayMinutes: flight.delayMinutes ?? null,
    from: {
      iata: dep?.iata ?? null,
      city: dep?.city ?? null,
      timeZone: airportTimeZone(dep?.iata, dep?.timezone),
    },
    to: {
      iata: arr?.iata ?? null,
      city: arr?.city ?? null,
      timeZone: airportTimeZone(arr?.iata, arr?.timezone),
    },
    departure: {
      scheduled: iso(flight.scheduledDep),
      estimated: iso(flight.estimatedDep),
      actual: iso(flight.actualDep),
      gate: flight.gate ?? null,
      terminal: flight.terminal ?? null,
    },
    arrival: {
      scheduled: iso(flight.scheduledArr),
      estimated: iso(flight.estimatedArr),
      actual: iso(flight.actualArr),
      gate: flight.arrivalGate ?? null,
      terminal: flight.arrivalTerminal ?? null,
    },
    progress: Math.round(metrics.progress * 1000) / 1000,
    remainingMin: metrics.remainingMin,
    positionEstimated: metrics.positionEstimated,
    altitudeFt: tel.altitudeFt != null ? Math.round(tel.altitudeFt) : null,
    speedKts: tel.speedKts != null ? Math.round(tel.speedKts) : null,
    seat: row.seat ?? null,
    aircraftType: flight.aircraftType ?? null,
    registration: flight.registration ?? null,
  };
}

export type WidgetFlight = ReturnType<typeof toWidgetFlight>;

export async function buildWidgetFeed(userId: string, now = new Date()) {
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true, units: true, widgetOptions: true },
    }),
    getUserFlights(userId),
  ]);
  const locale: Locale = isLocale(user?.locale) ? user.locale : "de";
  const units: Units = isUnits(user?.units) ? user.units : "metric";
  const options = parseWidgetOptions(user?.widgetOptions);
  const candidates = (rows as UserFlightView[]).filter((row) => options.includeDaily || !row.trackDaily);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    appUrl: env.appUrl,
    locale,
    units,
    options,
    flights: pickFlights(candidates, now.getTime()).map((row) => toWidgetFlight(row, locale, now)),
  };
}
