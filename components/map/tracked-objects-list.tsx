"use client";

import { X } from "lucide-react";
import { AirlineLogo } from "@/components/flights/airline-logo";
import { ObjectHistoryButton } from "@/components/map/object-history-button";
import { tileClassName } from "@/components/ui/card";
import { useT } from "@/components/i18n/prefs-provider";
import { displayCallsign } from "@/lib/callsign";
import { cn } from "@/lib/utils";
import type { TrackedAircraftView } from "@/lib/tracked-aircraft";

export function TrackedObjectsList({
  items,
  selectedIcao24,
  onSelect,
  onUntrack,
}: {
  items: TrackedAircraftView[];
  selectedIcao24?: string | null;
  onSelect?: (item: TrackedAircraftView) => void;
  onUntrack: (id: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("map.objects")}</p>
      {items.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">{t("map.objectsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const callsign = displayCallsign(item.callsign, item.icao24.slice(0, 6).toUpperCase());
            const selected = item.icao24 === selectedIcao24;
            const starts = item.starts ?? 0;
            const landings = item.landings ?? 0;
            return (
              <li key={item.id}>
                <div
                  className={cn(
                    tileClassName,
                    "flex items-center gap-1 p-2",
                    selected && "ring-2 ring-primary",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1 text-left"
                    onClick={() => onSelect?.(item)}
                  >
                    <AirlineLogo
                      size="xs"
                      iata={item.airlineIata}
                      name={item.operator ?? callsign}
                      className="bg-transparent"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-snug">{callsign}</span>
                      {item.operator && (
                        <span className="block text-xs leading-snug text-muted-foreground">{item.operator}</span>
                      )}
                      {(starts > 0 || landings > 0) && (
                        <span className="block text-xs leading-snug text-muted-foreground">
                          {t("object.statsShort", { starts, landings })}
                        </span>
                      )}
                    </span>
                  </button>
                  <ObjectHistoryButton item={item} />
                  <button
                    type="button"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-background hover:text-foreground"
                    aria-label={t("map.untrackObject")}
                    title={t("map.untrackObject")}
                    onClick={() => void onUntrack(item.id)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
