import { auth } from "@/auth";
import { getLogbookStats } from "@/lib/stats";
import { Card } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";
import { formatDistanceMiles, formatDuration } from "@/lib/i18n/format";

export default async function LogbookPage() {
  const session = await auth();
  const prefs = await getRequestPrefs();
  const year = new Date().getFullYear();
  const stats = await getLogbookStats(session!.user.id, year);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t(prefs.locale, "logbook.title")}</h1>
      <div className="flex h-10 min-h-10 items-center rounded-full bg-muted p-0.5">
        <div className="flex h-full flex-1 items-center justify-center rounded-full bg-card text-sm font-medium">
          {t(prefs.locale, "logbook.year", { year })}
        </div>
        <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">
          {t(prefs.locale, "logbook.allTime")}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard value={String(stats.flights)} label={t(prefs.locale, "logbook.flights")} />
        <StatCard value={formatDuration(stats.hours * 60, prefs.locale)} label={t(prefs.locale, "logbook.flightTime")} />
        <StatCard value={formatDistanceMiles(stats.miles, prefs.locale, prefs.units)} label={t(prefs.locale, "logbook.distance")} />
        <StatCard value={String(stats.countries)} label={t(prefs.locale, "logbook.countries")} />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t(prefs.locale, "logbook.topAirports")}</p>
        <div className="space-y-2">
          {stats.topAirports.length === 0 && (
            <Card className="p-4 text-sm text-muted-foreground">{t(prefs.locale, "logbook.empty")}</Card>
          )}
          {stats.topAirports.map((a) => (
            <Card key={a.code} className="flex items-center gap-3 p-4">
              <MapPin className="size-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">{a.code}</p>
                <p className="text-sm text-muted-foreground">{a.city}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t(prefs.locale, "logbook.flightCount", { n: a.count })}</p>
            </Card>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t(prefs.locale, "logbook.topAirlines")}</p>
        <div className="flex flex-wrap gap-2">
          {stats.topAirlines.map((a) => (
            <span key={a.name} className="rounded-xl border border-border bg-card px-3 py-2 text-sm">
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
