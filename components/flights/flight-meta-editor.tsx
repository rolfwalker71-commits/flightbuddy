"use client";

import { useEffect, useState } from "react";
import { Bell, StickyNote } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { tileClassName } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/prefs-provider";

export function FlightMetaEditor({
  flightId,
  seat: initialSeat,
  notes: initialNotes,
  pushAlerts: initialPush,
}: {
  flightId: string;
  seat?: string | null;
  notes?: string | null;
  pushAlerts?: boolean | null;
}) {
  const t = useT();
  const [seat, setSeat] = useState(initialSeat ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pushAlerts, setPushAlerts] = useState(initialPush !== false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSeat(initialSeat ?? "");
    setNotes(initialNotes ?? "");
    setPushAlerts(initialPush !== false);
  }, [flightId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(patch: { seat?: string | null; notes?: string | null; pushAlerts?: boolean }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/flights/${flightId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("persist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className={cn(tileClassName, "space-y-3 p-3")}>
        <div className="space-y-1.5">
          <Label htmlFor={`seat-${flightId}`}>{t("flight.seatLabel")}</Label>
          <Input
            id={`seat-${flightId}`}
            value={seat}
            placeholder={t("flight.seatPlaceholder")}
            maxLength={16}
            onChange={(e) => setSeat(e.target.value)}
            onBlur={() => void persist({ seat: seat.trim() || null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`notes-${flightId}`} className="flex items-center gap-2">
            <StickyNote className="size-3.5 text-muted-foreground" />
            {t("flight.notesLabel")}
          </Label>
          <textarea
            id={`notes-${flightId}`}
            value={notes}
            placeholder={t("flight.notesPlaceholder")}
            maxLength={2000}
            rows={3}
            className="flex min-h-[5rem] w-full rounded-[var(--control-radius)] border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void persist({ notes: notes.trim() || null })}
          />
        </div>
      </div>
      <div className={cn(tileClassName, "flex items-center justify-between gap-3 p-3")}>
        <span className="flex items-center gap-2 text-sm">
          <Bell className="size-4 text-muted-foreground" />
          {t("flight.pushAlerts")}
        </span>
        <Switch
          checked={pushAlerts}
          disabled={saving}
          onCheckedChange={(value) => {
            setPushAlerts(value);
            void persist({ pushAlerts: value });
          }}
        />
      </div>
    </div>
  );
}
