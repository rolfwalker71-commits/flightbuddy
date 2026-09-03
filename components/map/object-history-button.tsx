"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { formatAltitude, formatRelative, formatSpeed } from "@/lib/i18n/format";
import type { TrackedAircraftHistory, TrackedAircraftView } from "@/lib/tracked-aircraft";
import { displayTrackedCallsign } from "@/lib/tracked-aircraft";

export function ObjectHistoryButton({ item }: { item: TrackedAircraftView }) {
  const t = useT();
  const { locale, units } = usePrefs();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<TrackedAircraftHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/tracked-aircraft/${item.id}/history`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as TrackedAircraftHistory;
        if (!cancelled) setHistory(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item.id]);

  const callsign = displayTrackedCallsign(item);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={t("object.history")}
          title={t("object.history")}
        >
          <History className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogTitle>
          {callsign} · {t("object.history")}
        </DialogTitle>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-[var(--tile-radius)] bg-muted p-3 text-center">
            <p className="text-lg font-semibold">{history?.stats.starts ?? item.starts ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{t("object.starts")}</p>
          </div>
          <div className="rounded-[var(--tile-radius)] bg-muted p-3 text-center">
            <p className="text-lg font-semibold">{history?.stats.landings ?? item.landings ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{t("object.landings")}</p>
          </div>
        </div>
        {loading && <p className="mt-4 text-sm text-muted-foreground">{t("object.historyLoading")}</p>}
        {!loading && history && history.events.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">{t("object.historyEmpty")}</p>
        )}
        <ul className="mt-4 space-y-2">
          {history?.events.map((event) => (
            <li key={event.id} className="rounded-[var(--tile-radius)] bg-muted/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={event.phase === "airborne" ? "live" : "success"}>
                  {event.phase === "airborne" ? t("alerts.eventObjectAirborne") : t("alerts.eventObjectLanded")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatRelative(new Date(event.recordedAt), locale)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {[
                  formatAltitude(event.altitudeFt, locale, units),
                  formatSpeed(event.velocityKts, locale, units),
                ]
                  .filter((v) => v !== "—")
                  .join(" · ") || "—"}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("aircraft.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
