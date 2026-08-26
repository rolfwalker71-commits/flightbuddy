"use client";

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/prefs-provider";

export function TrackDailyToggle({
  flightId,
  initial,
  variant = "row",
}: {
  flightId: string;
  initial: boolean;
  variant?: "row" | "icon";
}) {
  const t = useT();
  const [on, setOn] = useState(initial);

  useEffect(() => {
    setOn(initial);
    // Same-flight live polls must not overwrite a just-saved toggle.
  }, [flightId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when switching flights

  async function commit(value: boolean) {
    const previous = on;
    setOn(value);
    try {
      const res = await fetch(`/api/flights/${flightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ trackDaily: value }),
      });
      if (!res.ok) throw new Error("persist");
      const json = (await res.json()) as { trackDaily?: boolean };
      if (typeof json.trackDaily === "boolean") setOn(json.trackDaily);
    } catch {
      setOn(previous);
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        className={cn(
          "relative z-10 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted",
          on && "text-primary",
        )}
        aria-pressed={on}
        aria-label={t("flight.trackDaily")}
        title={t("flight.trackDaily")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void commit(!on);
        }}
      >
        <Repeat className="size-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm">
        <Repeat className="size-4 text-muted-foreground" />
        {t("flight.trackDaily")}
      </span>
      <Switch checked={on} onCheckedChange={(value) => void commit(value)} />
    </div>
  );
}

export function RecurringMark({ active }: { active?: boolean | null }) {
  const t = useT();
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Repeat className="size-3" aria-hidden />
      {t("flight.daily")}
    </span>
  );
}
