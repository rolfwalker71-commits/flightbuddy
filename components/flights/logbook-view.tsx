"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/components/i18n/prefs-provider";
import { formatDistanceMiles, formatDuration } from "@/lib/i18n/format";
import type { Locale, Units } from "@/lib/i18n/messages";

export type LogbookStatsView = {
  flights: number;
  hours: number;
  miles: number;
  countries: number;
  topAirports: { code: string; city: string | null; count: number }[];
  topAirlines: { name: string; count: number }[];
};

export function LogbookView({
  year,
  yearStats,
  allTimeStats,
  locale,
  units,
}: {
  year: number;
  yearStats: LogbookStatsView;
  allTimeStats: LogbookStatsView;
  locale: Locale;
  units: Units;
}) {
  const t = useT();
  const [scope, setScope] = useState<"year" | "all">("year");
  const stats = scope === "year" ? yearStats : allTimeStats;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("logbook.title")}</h1>
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { id: "year", label: t("logbook.year", { year }) },
          { id: "all", label: t("logbook.allTime") },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <StatCard value={String(stats.flights)} label={t("logbook.flights")} />
        <StatCard value={formatDuration(stats.hours * 60, locale)} label={t("logbook.flightTime")} />
        <StatCard value={formatDistanceMiles(stats.miles, locale, units)} label={t("logbook.distance")} />
        <StatCard value={String(stats.countries)} label={t("logbook.countries")} />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t("logbook.topAirports")}</p>
        <div className="space-y-2">
          {stats.topAirports.length === 0 && (
            <Card className="p-4 text-sm text-muted-foreground">{t("logbook.empty")}</Card>
          )}
          {stats.topAirports.map((a) => (
            <Card key={a.code} className="flex items-center gap-3 p-4">
              <MapPin className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{a.code}</p>
                <p className="break-words text-sm text-muted-foreground">{a.city}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t("logbook.flightCount", { n: a.count })}</p>
            </Card>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t("logbook.topAirlines")}</p>
        <div className="flex flex-wrap gap-2">
          {stats.topAirlines.map((a) => (
            <span key={a.name} className="fb-card px-3 py-2 text-sm">
              {a.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </Card>
  );
}
