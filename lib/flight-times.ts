import { asDate } from "./i18n/format";
import type { MessageKey } from "./i18n/messages";

export type TimeKind = "scheduled" | "estimated" | "actual";
export type EffectiveKind = "estimated" | "actual";

export type LegTimes = {
  primary: Date | null;
  primaryKind: TimeKind;
  scheduled: Date | null;
  estimated: Date | null;
  actual: Date | null;
  planned: Date | null;
  effective: Date | null;
  effectiveKind: EffectiveKind | null;
  /** True only when both exist and the displayed minute differs. */
  differ: boolean;
};

/** Same displayed clock minute (do not treat 19:40:00 vs 19:40:45 as two times). */
export function sameDisplayMinute(a: Date | null, b: Date | null) {
  return Boolean(a && b && Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000));
}

export function resolveLegTimes(
  scheduled?: Date | string | null,
  estimated?: Date | string | null,
  actual?: Date | string | null,
): LegTimes {
  const sched = asDate(scheduled);
  const est = asDate(estimated);
  const act = asDate(actual);
  const planned = sched;
  const effective = act ?? est ?? null;
  const effectiveKind: EffectiveKind | null = act ? "actual" : est ? "estimated" : null;
  const differ = Boolean(planned && effective && !sameDisplayMinute(planned, effective));
  const primary = (differ ? effective : planned) ?? effective;
  const primaryKind: TimeKind = differ
    ? (effectiveKind ?? "scheduled")
    : effectiveKind === "actual"
      ? "actual"
      : effectiveKind === "estimated" && !planned
        ? "estimated"
        : "scheduled";

  return {
    primary,
    primaryKind,
    scheduled: sched,
    estimated: est,
    actual: act,
    planned,
    effective,
    effectiveKind,
    differ,
  };
}

export function roleLabelKey(role: "dep" | "arr"): MessageKey {
  return role === "dep" ? "flight.depTime" : "flight.arrTime";
}

export function depLabelKey(kind: TimeKind): MessageKey {
  if (kind === "actual") return "flight.depActual";
  if (kind === "estimated") return "flight.depEstimated";
  return "flight.depScheduled";
}

export function arrLabelKey(kind: TimeKind): MessageKey {
  if (kind === "actual") return "flight.arrActual";
  if (kind === "estimated") return "flight.arrEstimated";
  return "flight.arrScheduled";
}

export function timeKindKey(kind: TimeKind): MessageKey {
  if (kind === "actual") return "flight.actual";
  if (kind === "estimated") return "flight.estimated";
  return "flight.scheduled";
}

export function effectiveQualifierKey(kind: EffectiveKind): MessageKey {
  return kind === "actual" ? "flight.actual" : "flight.estimated";
}

/**
 * A leg is delayed when the effective instant is after the scheduled instant
 * (UTC Date.getTime, not display strings). Early or equal stays on-time.
 * If only geplant exists, tint only when Flight.status is DELAYED.
 */
export function isLegDelayed(
  times: Pick<LegTimes, "planned" | "effective">,
  status?: string | null,
): boolean {
  if (times.planned && times.effective) {
    return times.effective.getTime() > times.planned.getTime();
  }
  return Boolean(times.planned && status === "DELAYED");
}
