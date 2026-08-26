"use client";

import { useEffect, useState } from "react";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import {
  formatClock,
  formatDay,
  formatTimeZoneName,
  formatViewerClock,
} from "@/lib/i18n/format";
import { airportTimeZone } from "@/lib/airport-tz";
import {
  effectiveQualifierKey,
  isLegDelayed,
  resolveLegTimes,
  roleLabelKey,
  type LegTimes,
} from "@/lib/flight-times";
import type { Locale, MessageKey, Units } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

type AirportClockProps = {
  scheduled?: Date | string | null;
  estimated?: Date | string | null;
  actual?: Date | string | null;
  iata?: string | null;
  storedTimeZone?: string | null;
  role: "dep" | "arr";
  variant?: "compact" | "detail";
  align?: "left" | "right";
  showViewer?: boolean;
  status?: string | null;
};

function singleHeaderKey(role: "dep" | "arr", times: LegTimes): MessageKey | "onTime" {
  if (times.planned && times.effective) return "onTime";
  if (!times.planned && times.effectiveKind === "actual") {
    return role === "dep" ? "flight.depActual" : "flight.arrActual";
  }
  if (!times.planned && times.effectiveKind === "estimated") {
    return role === "dep" ? "flight.depEstimated" : "flight.arrEstimated";
  }
  return role === "dep" ? "flight.depScheduled" : "flight.arrScheduled";
}

function ClockFace({
  at,
  zone,
  units,
  locale,
  size,
  delayed,
}: {
  at: Date;
  zone: string | null | undefined;
  units: Units;
  locale: Locale;
  size: "lg" | "md" | "sm";
  delayed?: boolean;
}) {
  const clock = formatClock(at, units, zone);
  const zoneName = formatTimeZoneName(at, zone, locale);
  const iso = at.toISOString();
  const timeCls = cn(
    size === "lg"
      ? "text-2xl font-semibold tracking-tight"
      : size === "md"
        ? "text-xl font-medium tracking-tight"
        : "text-sm font-medium",
    delayed ? "text-destructive" : "text-foreground",
  );
  const zoneCls =
    size === "sm"
      ? "ml-1 text-[0.7rem] font-normal text-muted-foreground"
      : size === "lg"
        ? "block text-sm font-normal text-muted-foreground"
        : "ml-1.5 text-sm font-normal text-muted-foreground";
  return (
    <p className={cn(timeCls, size === "lg" && "flex flex-wrap items-baseline gap-x-1.5")}>
      <time dateTime={iso}>{clock}</time>
      {zoneName && <span className={zoneCls}>{zoneName}</span>}
    </p>
  );
}

export function AirportClock({
  scheduled,
  estimated,
  actual,
  iata,
  storedTimeZone,
  role,
  variant = "compact",
  align = "left",
  showViewer = true,
  status,
}: AirportClockProps) {
  const t = useT();
  const { units, locale } = usePrefs();
  const zone = airportTimeZone(iata, storedTimeZone);
  const times = resolveLegTimes(scheduled, estimated, actual);
  const delayed = isLegDelayed(times, status);
  const displayAt = times.effective ?? times.planned ?? times.primary;
  const displayClock = formatClock(displayAt, units, zone);
  const iso = displayAt?.toISOString() ?? undefined;
  const planDay = times.planned ? formatDay(times.planned, units, zone) : "";
  const effDay = times.effective ? formatDay(times.effective, units, zone) : "";
  const daysDiffer = Boolean(planDay && effDay && planDay !== effDay);
  const sharedDay = !daysDiffer ? planDay || effDay : "";

  const [viewerClock, setViewerClock] = useState<string | null>(null);
  useEffect(() => {
    if (!showViewer || !iso) {
      setViewerClock(null);
      return;
    }
    const next = formatViewerClock(iso, units);
    setViewerClock(next !== displayClock ? next : null);
  }, [showViewer, iso, units, displayClock]);

  const alignCls = align === "right" ? "text-right" : "";
  const headerKind = singleHeaderKey(role, times);
  const singleHeader =
    headerKind === "onTime"
      ? `${t(roleLabelKey(role))} · ${t("flight.onTime")}`
      : t(headerKind);

  const qualifier = times.effectiveKind ? t(effectiveQualifierKey(times.effectiveKind)) : null;
  const effectiveLabel = qualifier
    ? `${t("flight.effective")} · ${qualifier}`
    : t("flight.effective");

  const viewerLine = viewerClock ? (
    <p className="mt-1 text-xs text-muted-foreground">{t("flight.yourTime", { time: viewerClock })}</p>
  ) : null;

  if (variant === "detail") {
    if (times.differ && times.planned && times.effective) {
      return (
        <div className={alignCls}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t(roleLabelKey(role))}</p>
          <div className="mt-2 space-y-3">
            <div>
              <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{t("flight.scheduled")}</p>
              <ClockFace at={times.planned} zone={zone} units={units} locale={locale} size="md" />
              {daysDiffer && <p className="text-xs text-muted-foreground">{planDay}</p>}
            </div>
            <div>
              <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{effectiveLabel}</p>
              <ClockFace at={times.effective} zone={zone} units={units} locale={locale} size="lg" delayed={delayed} />
              {daysDiffer && <p className="text-xs text-muted-foreground">{effDay}</p>}
            </div>
          </div>
          {sharedDay && <p className="mt-1 text-xs text-muted-foreground">{sharedDay}</p>}
          {viewerLine}
        </div>
      );
    }

    const single = times.planned ?? times.effective;
    return (
      <div className={alignCls}>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{singleHeader}</p>
        {single && <ClockFace at={single} zone={zone} units={units} locale={locale} size="lg" delayed={delayed} />}
        {sharedDay && <p className="text-xs text-muted-foreground">{sharedDay}</p>}
        {viewerLine}
      </div>
    );
  }

  if (times.differ && times.planned && times.effective) {
    return (
      <div className={alignCls}>
        <p className="text-xs text-muted-foreground">
          <time dateTime={times.planned.toISOString()}>{formatClock(times.planned, units, zone)}</time>
          <span className="ml-1">{t("flight.scheduled")}</span>
        </p>
        <ClockFace at={times.effective} zone={zone} units={units} locale={locale} size="sm" delayed={delayed} />
        <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{effectiveLabel}</p>
        {viewerLine}
      </div>
    );
  }

  const single = times.planned ?? times.effective;
  const zoneName = single ? formatTimeZoneName(single, zone, locale) : null;
  const compactKind = times.planned && times.effective
    ? t("flight.onTime")
    : times.effective
      ? t("flight.effective")
      : null;
  return (
    <div className={alignCls}>
      {single && (
        <p className={cn("text-sm", delayed ? "text-destructive" : "text-muted-foreground")}>
          <time dateTime={single.toISOString()}>{formatClock(single, units, zone)}</time>
          {zoneName && <span className="ml-1 text-[0.7rem] text-muted-foreground">{zoneName}</span>}
        </p>
      )}
      {compactKind && (
        <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{compactKind}</p>
      )}
      {viewerLine}
    </div>
  );
}
