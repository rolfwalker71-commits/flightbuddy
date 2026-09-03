"use client";

import { useMemo, useState } from "react";
import { GitBranchPlus, Luggage } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tileClassName } from "@/components/ui/card";
import { cn, displayFlightNumber } from "@/lib/utils";
import { useT } from "@/components/i18n/prefs-provider";
import { suggestConnections, type ConnectionInfo, type TripView } from "@/lib/trips-shared";
import type { UserFlightView } from "@/lib/flight-view";
import { useRouter } from "next/navigation";

export function ConnectionBadge({ info }: { info: ConnectionInfo }) {
  const t = useT();
  const tone =
    info.level === "missed"
      ? "text-destructive"
      : info.level === "tight"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  const label =
    info.level === "missed"
      ? t("trip.connectionMissed")
      : info.level === "tight"
        ? t("trip.connectionTight")
        : info.level === "ok"
          ? t("trip.connectionOk")
          : t("trip.connectionComfortable");
  const mins = Math.abs(info.layoverMin);
  return (
    <p className={cn("text-xs leading-snug", tone)}>
      {t("trip.layover", { n: mins })} · {label}
    </p>
  );
}

export function TripPanel({
  flightId,
  userFlightId,
  flights,
  trips,
}: {
  flightId: string;
  userFlightId: string;
  flights: UserFlightView[];
  trips: TripView[];
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const trip = trips.find((tr) => tr.legs.some((l) => l.flightId === flightId));
  const suggestions = useMemo(
    () => suggestConnections(flights, flightId),
    [flights, flightId],
  );

  async function createWith(otherUserFlightId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userFlightIds: [userFlightId, otherUserFlightId] }),
      });
      if (!res.ok) throw new Error("trip");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function dissolve() {
    if (!trip) return;
    setBusy(true);
    try {
      await fetch(`/api/trips/${trip.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (trip) {
    const leg = trip.legs.find((l) => l.flightId === flightId);
    return (
      <div className={cn(tileClassName, "space-y-2 p-3")}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Luggage className="size-4 text-muted-foreground" />
          {trip.name ?? t("trip.title")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("trip.legs", { n: trip.legs.length })}
        </p>
        {leg?.connectionToNext && <ConnectionBadge info={leg.connectionToNext} />}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void dissolve()}>
          {t("trip.dissolve")}
        </Button>
      </div>
    );
  }

  if (!suggestions.length) return null;

  return (
    <div className={cn(tileClassName, "space-y-2 p-3")}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitBranchPlus className="size-4 text-muted-foreground" />
        {t("trip.suggestTitle")}
      </div>
      <ul className="space-y-2">
        {suggestions.slice(0, 3).map((s) => (
          <li key={s.userFlightId} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{displayFlightNumber(s.flightNumber)}</p>
              {s.connection && <ConnectionBadge info={s.connection} />}
            </div>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void createWith(s.userFlightId)}
            >
              {t("trip.link")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
