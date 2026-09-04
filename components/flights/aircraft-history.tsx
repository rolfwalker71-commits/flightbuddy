"use client";

import { useEffect, useId, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, Plane, X } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./status-badge";
import { AirportClock } from "./airport-clock";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { airportTimeZone } from "@/lib/airport-tz";
import { resolveLegTimes } from "@/lib/flight-times";
import { formatDay } from "@/lib/i18n/format";
import type { AircraftHistoryPayload, AircraftSectorView } from "@/lib/aircraft-history-types";
import type { MessageKey } from "@/lib/i18n/messages";
import { tileClassName } from "@/components/ui/card";
import { cn, displayFlightNumber } from "@/lib/utils";

function reasonMessage(reason: AircraftHistoryPayload["reason"]): MessageKey {
  switch (reason) {
    case "no_identity":
      return "aircraft.unknownReg";
    case "unconfigured":
      return "flight.noApi";
    case "rate_limited":
      return "flight.rateLimited";
    case "monthly_quota":
      return "flight.monthlyQuota";
    case "not_subscribed":
      return "flight.notSubscribed";
    case "http_error":
    case "network_error":
      return "flight.apiError";
    default:
      return "aircraft.noHistory";
  }
}

function SectorDay({
  scheduled,
  estimated,
  actual,
  iata,
  storedTimeZone,
  align,
}: {
  scheduled?: string | null;
  estimated?: string | null;
  actual?: string | null;
  iata?: string | null;
  storedTimeZone?: string | null;
  align?: "left" | "right";
}) {
  const { units } = usePrefs();
  const zone = airportTimeZone(iata, storedTimeZone);
  const times = resolveLegTimes(scheduled, estimated, actual);
  const at = times.effective ?? times.planned ?? times.primary;
  const day = formatDay(at, units, zone);
  if (!day) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", align === "right" && "text-right")}>{day}</p>
  );
}

function SectorRow({
  sector,
}: {
  sector: AircraftSectorView;
}) {
  const t = useT();
  const from = sector.fromIata ?? "—";
  const to = sector.toIata ?? "—";
  return (
    <article
      className={cn(
        tileClassName,
        "p-3",
        sector.isCurrent && "border-primary bg-primary/10",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{displayFlightNumber(sector.flightNumber)}</p>
            {sector.isInbound ? (
              <Badge className="border border-border bg-card">{t("aircraft.inbound")}</Badge>
            ) : null}
          </div>
          <p className="break-words text-sm text-muted-foreground">
            {from} → {to}
            {sector.fromName || sector.toName
              ? ` · ${[sector.fromName, sector.toName].filter(Boolean).join(" – ")}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={sector.status} />
          {sector.isCurrent ? (
            <Badge variant="live" className="text-primary">
              {t("aircraft.thisFlight")}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <AirportClock
            role="dep"
            scheduled={sector.scheduledDep}
            estimated={sector.estimatedDep}
            actual={sector.actualDep}
            iata={sector.fromIata}
            storedTimeZone={sector.fromTimezone}
            status={sector.status}
            showViewer={false}
          />
          <SectorDay
            scheduled={sector.scheduledDep}
            estimated={sector.estimatedDep}
            actual={sector.actualDep}
            iata={sector.fromIata}
            storedTimeZone={sector.fromTimezone}
          />
        </div>
        <div>
          <AirportClock
            role="arr"
            align="right"
            scheduled={sector.scheduledArr}
            estimated={sector.estimatedArr}
            actual={sector.actualArr}
            iata={sector.toIata}
            storedTimeZone={sector.toTimezone}
            status={sector.status}
            showViewer={false}
          />
          <SectorDay
            scheduled={sector.scheduledArr}
            estimated={sector.estimatedArr}
            actual={sector.actualArr}
            iata={sector.toIata}
            storedTimeZone={sector.toTimezone}
            align="right"
          />
        </div>
      </div>
    </article>
  );
}

function HistoryBody({
  data,
  loading,
}: {
  data: AircraftHistoryPayload | null;
  loading: boolean;
}) {
  const t = useT();

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" />
        {t("aircraft.loading")}
      </div>
    );
  }

  if (!data) return null;

  if (data.reason !== "ok") {
    return <p className="text-sm text-muted-foreground">{t(reasonMessage(data.reason))}</p>;
  }

  const tail = data.registration ?? (data.icao24 ? `Mode-S ${data.icao24}` : null);
  const typeLine = [data.aircraftType, tail].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      {typeLine ? <p className="text-sm text-muted-foreground">{typeLine}</p> : null}

      {!data.inbound ? (
        <p className="text-sm text-muted-foreground">{t("aircraft.inboundNone")}</p>
      ) : null}

      <section>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("aircraft.timeline")}
        </h3>
        <div className="mt-2 space-y-2">
          {data.sectors.length ? (
            data.sectors.map((sector, index) => (
              <SectorRow
                key={`${sector.flightNumber}-${sector.scheduledDep ?? sector.actualDep ?? index}`}
                sector={sector}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{t("aircraft.noHistory")}</p>
          )}
        </div>
      </section>
    </div>
  );
}

export function AircraftHistoryControl({
  flightId,
  registration,
  icao24,
  aircraftType,
  variant = "detail",
}: {
  flightId: string;
  registration?: string | null;
  icao24?: string | null;
  aircraftType?: string | null;
  variant?: "detail" | "compact";
}) {
  const t = useT();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AircraftHistoryPayload | null>(null);
  const known = Boolean(registration?.trim() || icao24?.trim());
  const aircraftLine = [aircraftType, registration].filter(Boolean).join(" · ");

  useEffect(() => {
    if (!open || !known) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/flights/${flightId}/aircraft-history`)
      .then(async (res) => {
        if (!res.ok) throw new Error("history");
        return (await res.json()) as AircraftHistoryPayload;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setData({
            registration: registration ?? null,
            icao24: icao24 ?? null,
            aircraftType: aircraftType ?? null,
            inbound: null,
            sectors: [],
            reason: "http_error",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, known, flightId, registration, icao24, aircraftType]);

  if (variant === "compact" && !known) return null;

  const trigger = known ? (
    <button
      type="button"
      className={cn(
        "relative z-10 pointer-events-auto rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "detail"
          ? "mt-1 min-h-11 w-full py-1 hover:bg-muted"
          : "mt-0.5 block w-full whitespace-normal py-0.5 text-left text-xs leading-snug text-muted-foreground hover:text-foreground",
      )}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t("aircraft.openHistory")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }}
    >
      {variant === "detail" ? (
        <>
          {aircraftLine ? <p className="text-sm text-muted-foreground">{aircraftLine}</p> : null}
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Plane className="size-4 text-muted-foreground" />
            {t("aircraft.machineInbound")}
          </p>
        </>
      ) : (
        aircraftLine || t("aircraft.machineInbound")
      )}
    </button>
  ) : (
    <div className="mt-1">
      {aircraftLine ? <p className="text-sm text-muted-foreground">{aircraftLine}</p> : null}
      <p className="text-sm text-muted-foreground">{t("aircraft.unknownReg")}</p>
    </div>
  );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="aircraft-history-backdrop bg-black/50 backdrop-blur-[2px]" />
          <DialogPrimitive.Content
            className="aircraft-history-sheet fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card outline-none"
            aria-modal="true"
            aria-labelledby={titleId}
            onOpenAutoFocus={(event) => {
              const close = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
                "[data-aircraft-history-close]",
              );
              if (close) {
                event.preventDefault();
                close.focus();
              }
            }}
          >
            <div
              className="flex items-start justify-between gap-3 border-b border-border px-4 py-4"
              style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
            >
              <DialogPrimitive.Title
                id={titleId}
                className="break-words text-xl font-semibold tracking-tight"
              >
                {t("aircraft.title")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                data-aircraft-history-close
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("aircraft.close")}
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            <div
              className="flex-1 overflow-y-auto px-4 py-4"
              style={{
                paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
                paddingRight: "max(1rem, env(safe-area-inset-right))",
              }}
            >
              <HistoryBody data={data} loading={loading} />
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}
