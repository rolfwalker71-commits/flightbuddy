import { FlightStatus } from "@prisma/client";

export type HistorySector = {
  flightNumber: string;
  fromIata?: string | null;
  toIata?: string | null;
  scheduledDep?: string | Date | null;
  scheduledArr?: string | Date | null;
  estimatedDep?: string | Date | null;
  estimatedArr?: string | Date | null;
  actualDep?: string | Date | null;
  actualArr?: string | Date | null;
  status?: FlightStatus;
};

export type HistorySectorWithStatus = HistorySector & { status: FlightStatus };

export type CurrentHistoryFlight = {
  flightNumber: string;
  fromIata?: string | null;
  toIata?: string | null;
  scheduledDep: Date;
  scheduledArr?: string | Date | null;
  estimatedDep?: string | Date | null;
  estimatedArr?: string | Date | null;
  actualDep?: string | Date | null;
  actualArr?: string | Date | null;
  departureMs: number;
  status: FlightStatus;
};

const HOUR_MS = 60 * 60 * 1000;
const LONG_HAUL_MS = 18 * HOUR_MS;
const ARRIVAL_SLACK_MS = 30 * 60 * 1000;
const FUTURE_DEP_SLACK_MS = HOUR_MS;

function normalizeNumber(value: string) {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

function parseMs(value?: string | Date | null) {
  if (!value) return null;
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  return Number.isFinite(t) ? t : null;
}

function sectorTimes(sector: HistorySector) {
  return {
    dep: parseMs(sector.actualDep ?? sector.estimatedDep ?? sector.scheduledDep),
    arr: parseMs(sector.actualArr ?? sector.estimatedArr ?? sector.scheduledArr),
    scheduledDep: parseMs(sector.scheduledDep),
    scheduledArr: parseMs(sector.scheduledArr),
  };
}

function closeMs(a: number | null, b: number | null, windowMs: number) {
  return a != null && b != null && Math.abs(a - b) <= windowMs;
}

/** Same physical sector (incl. codeshares), not a flight-number pair. */
export function isSamePhysicalSector(a: HistorySector, b: HistorySector) {
  const fromA = a.fromIata?.toUpperCase();
  const fromB = b.fromIata?.toUpperCase();
  const toA = a.toIata?.toUpperCase();
  const toB = b.toIata?.toUpperCase();
  if (!fromA || !fromB || !toA || !toB || fromA !== fromB || toA !== toB) return false;
  const ta = sectorTimes(a);
  const tb = sectorTimes(b);
  return (
    closeMs(ta.scheduledDep, tb.scheduledDep, 30 * 60 * 1000) ||
    closeMs(ta.scheduledArr, tb.scheduledArr, 30 * 60 * 1000) ||
    closeMs(ta.dep, tb.dep, 30 * 60 * 1000) ||
    closeMs(ta.arr, tb.arr, 30 * 60 * 1000)
  );
}

function sectorRichness(sector: HistorySector) {
  let score = 0;
  if (sector.actualArr) score += 8;
  if (sector.actualDep) score += 6;
  if (sector.scheduledArr) score += 3;
  if (sector.scheduledDep) score += 3;
  if (sector.estimatedArr) score += 1;
  if (sector.estimatedDep) score += 1;
  return score;
}

/** Keep one row per physical sector so codeshare stubs do not outrank the operating flight. */
export function collapseCodeshares<T extends HistorySector>(sectors: T[]): T[] {
  const kept: T[] = [];
  for (const sector of sectors) {
    const idx = kept.findIndex((row) => isSamePhysicalSector(row, sector));
    if (idx < 0) {
      kept.push(sector);
      continue;
    }
    if (sectorRichness(sector) > sectorRichness(kept[idx])) kept[idx] = sector;
  }
  return kept;
}

export function isCurrentHistorySector(sector: HistorySector, current: CurrentHistoryFlight) {
  return isSameSector(sector, current) || isSamePhysicalSector(sector, current);
}

function isAirborneLiveStatus(status: FlightStatus) {
  return status === FlightStatus.EN_ROUTE || status === FlightStatus.DEPARTED;
}

function isTerminalStatus(status: FlightStatus) {
  return (
    status === FlightStatus.LANDED ||
    status === FlightStatus.CANCELLED ||
    status === FlightStatus.DIVERTED
  );
}

function sectorWindow(sector: HistorySector) {
  return {
    start: parseMs(sector.actualDep ?? sector.estimatedDep ?? sector.scheduledDep),
    end: parseMs(sector.actualArr ?? sector.estimatedArr ?? sector.scheduledArr),
  };
}

/** True when scheduled/estimated/actual [dep, arr] contains `now`. */
export function sectorWindowContainsNow(sector: HistorySector, nowMs = Date.now()) {
  const { start, end } = sectorWindow(sector);
  if (start != null && end != null) return nowMs >= start && nowMs <= end;
  if (start != null) return nowMs >= start && nowMs <= start + LONG_HAUL_MS;
  if (end != null) return nowMs <= end && nowMs >= end - LONG_HAUL_MS;
  return false;
}

function isClearlyNotAirborne(sector: HistorySector, nowMs: number) {
  const actualArr = parseMs(sector.actualArr);
  if (actualArr != null && actualArr <= nowMs) return true;
  const { start, end } = sectorWindow(sector);
  if (end != null && end < nowMs - ARRIVAL_SLACK_MS) return true;
  if (start != null && start > nowMs + FUTURE_DEP_SLACK_MS) return true;
  return false;
}

function demoteAirborneStatus(sector: HistorySector, nowMs: number): FlightStatus {
  const actualArr = parseMs(sector.actualArr);
  if (actualArr != null && actualArr <= nowMs) return FlightStatus.LANDED;
  const { start, end } = sectorWindow(sector);
  if (end != null && end < nowMs) return FlightStatus.LANDED;
  if (start != null && start > nowMs) return FlightStatus.SCHEDULED;
  if (start != null && start <= nowMs && (end == null || end < nowMs)) return FlightStatus.LANDED;
  return FlightStatus.SCHEDULED;
}

function closestWindowIndex<T extends HistorySector>(sectors: T[], idxs: number[], nowMs: number) {
  let best = idxs[0] ?? -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const i of idxs) {
    const { start, end } = sectorWindow(sectors[i]);
    const mid = start != null && end != null ? (start + end) / 2 : (start ?? end ?? 0);
    const dist = Math.abs(mid - nowMs);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * At most one history sector may be live. AeroDataBox EnRoute/Active is ignored
 * when the sector's time window does not contain now, or when another sector
 * (especially the opened/tracked flight) is the one actually airborne.
 */
export function reconcileHistoryStatuses<T extends HistorySectorWithStatus>(
  sectors: T[],
  current: CurrentHistoryFlight,
  nowMs = Date.now(),
): T[] {
  const currentIdx = sectors.findIndex((s) => isCurrentHistorySector(s, current));
  const currentIsLive = isAirborneLiveStatus(current.status);

  const windowIdxs = sectors.flatMap((s, i) =>
    sectorWindowContainsNow(s, nowMs) && !isTerminalStatus(s.status) ? [i] : [],
  );

  let airborneIdx = -1;
  if (currentIsLive && currentIdx < 0) {
    // Tracked flight is airborne but not in this list — no other sector may be live.
    airborneIdx = -1;
  } else if (currentIdx >= 0 && (windowIdxs.includes(currentIdx) || currentIsLive)) {
    airborneIdx = currentIdx;
  } else if (windowIdxs.length === 1) {
    airborneIdx = windowIdxs[0];
  } else if (windowIdxs.length > 1) {
    const adbAmong = windowIdxs.find((i) => isAirborneLiveStatus(sectors[i].status));
    airborneIdx = adbAmong ?? closestWindowIndex(sectors, windowIdxs, nowMs);
  } else if (!currentIsLive) {
    const adbLive = sectors.flatMap((s, i) =>
      isAirborneLiveStatus(s.status) && !isClearlyNotAirborne(s, nowMs) ? [i] : [],
    );
    if (adbLive.length === 1) airborneIdx = adbLive[0];
    else if (adbLive.length > 1) airborneIdx = closestWindowIndex(sectors, adbLive, nowMs);
  }

  return sectors.map((sector, i) => {
    if (i === airborneIdx) {
      return {
        ...sector,
        status: isAirborneLiveStatus(sector.status) ? sector.status : FlightStatus.EN_ROUTE,
      };
    }
    if (isAirborneLiveStatus(sector.status)) {
      return { ...sector, status: demoteAirborneStatus(sector, nowMs) };
    }
    return sector;
  });
}

export function isSameSector(
  sector: HistorySector,
  current: {
    flightNumber: string;
    fromIata?: string | null;
    toIata?: string | null;
    scheduledDep: Date;
  },
) {
  if (normalizeNumber(sector.flightNumber) !== normalizeNumber(current.flightNumber)) {
    return false;
  }
  if (current.fromIata && sector.fromIata && sector.fromIata !== current.fromIata) return false;
  if (current.toIata && sector.toIata && sector.toIata !== current.toIata) return false;
  const dep = parseMs(sector.scheduledDep);
  if (dep == null) return false;
  return Math.abs(dep - current.scheduledDep.getTime()) <= 12 * 60 * 60 * 1000;
}

/**
 * Inbound = this tail's sector that arrived at the current origin before this
 * departure. Never inferred from flight-number pairing (LX64/LX65).
 */
export function pickInboundSector<T extends HistorySector>(
  sectors: T[],
  current: CurrentHistoryFlight,
): T | null {
  const origin = current.fromIata?.trim().toUpperCase();
  if (!origin) return null;

  let best: T | null = null;
  let bestArr = Number.NEGATIVE_INFINITY;

  for (const sector of sectors) {
    if (isCurrentHistorySector(sector, current)) continue;
    const dest = sector.toIata?.trim().toUpperCase();
    if (dest !== origin) continue;
    const arr = parseMs(sector.actualArr ?? sector.estimatedArr ?? sector.scheduledArr);
    if (arr == null || arr > current.departureMs) continue;
    if (arr >= bestArr) {
      best = sector;
      bestArr = arr;
    }
  }
  return best;
}

/**
 * Sector start in UTC ms for timeline order: actualDep → estimatedDep → scheduledDep.
 * Missing times sort last (do not invent a start).
 */
export function sectorStartMs(sector: HistorySector) {
  return parseMs(sector.actualDep ?? sector.estimatedDep ?? sector.scheduledDep) ?? Number.POSITIVE_INFINITY;
}

/** Newest first (largest start). Missing times stay last. */
export function compareSectorsByStart(a: HistorySector, b: HistorySector) {
  const aStart = sectorStartMs(a);
  const bStart = sectorStartMs(b);
  const aMissing = !Number.isFinite(aStart);
  const bMissing = !Number.isFinite(bStart);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return bStart - aStart;
}

export function sectorDepMs(sector: HistorySector) {
  const start = sectorStartMs(sector);
  return Number.isFinite(start) ? start : 0;
}
