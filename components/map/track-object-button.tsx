"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n/prefs-provider";
import { displayCallsign } from "@/lib/callsign";
import type { ViewportTrafficAircraft } from "@/lib/viewport-traffic";
import type { TrackedAircraftView } from "@/lib/tracked-aircraft-types";

export function TrackObjectButton({
  aircraft,
  tracked,
  onSave,
  onUntrack,
}: {
  aircraft: ViewportTrafficAircraft;
  tracked?: TrackedAircraftView | null;
  onSave: (ac: ViewportTrafficAircraft) => Promise<void>;
  onUntrack: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callsign = displayCallsign(aircraft.callsign, aircraft.icao24.slice(0, 6).toUpperCase());

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      if (tracked) await onUntrack(tracked.id);
      else {
        await onSave({
          ...aircraft,
          callsign,
        });
      }
    } catch {
      setError(tracked ? t("map.untrackFailed") : t("map.trackFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-1.5">
      <Button
        type="button"
        variant={tracked ? "secondary" : "default"}
        className="h-11 w-full whitespace-normal leading-snug"
        disabled={busy}
        aria-pressed={Boolean(tracked)}
        onClick={() => void commit()}
      >
        {tracked ? <BookmarkCheck className="size-4 shrink-0" /> : <Bookmark className="size-4 shrink-0" />}
        <span className="min-w-0 break-words">
          {tracked ? t("map.trackingObject") : t("map.trackObject")}
        </span>
      </Button>
      <p className="text-xs leading-snug text-muted-foreground">{t("map.objectHint")}</p>
      {error && <p className="text-xs leading-snug text-destructive">{error}</p>}
    </div>
  );
}
