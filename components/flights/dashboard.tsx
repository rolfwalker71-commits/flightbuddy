"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Plane } from "lucide-react";
import { initials } from "@/lib/utils";
import { filterFlights, toMapFlight, type UserFlightView } from "@/lib/flight-view";
import { FlightCard } from "./flight-card";
import { AddFlightDialog } from "./add-flight-dialog";
import { HomeHeroMap } from "./home-hero-map";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { isLiveStatus } from "@/lib/flight-status";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { greeting } from "@/lib/i18n/format";
import type { TrackedAircraftView } from "@/lib/tracked-aircraft";

const tabs = [
  { id: "upcoming" as const, labelKey: "home.upcoming" as const },
  { id: "live" as const, labelKey: "home.live" as const },
  { id: "past" as const, labelKey: "home.past" as const },
];

export function Dashboard({
  userName,
  flights,
  unreadAlerts,
  stats,
  tracked = [],
}: {
  userName?: string | null;
  flights: UserFlightView[];
  unreadAlerts: number;
  stats: { flights: number; hours: number; countries: number };
  tracked?: TrackedAircraftView[];
}) {
  const { locale } = usePrefs();
  const t = useT();
  const [tab, setTab] = useState<"upcoming" | "live" | "past">("upcoming");
  const visible = useMemo(() => filterFlights(flights, tab), [flights, tab]);
  const live = flights.filter((f) => isLiveStatus(f.flight.status));

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {greeting(locale)}
            {userName ? `, ${userName.split(" ")[0]}` : ""}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("home.title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/alerts"
            className="relative flex h-11 w-11 items-center justify-center rounded-full bg-card ring-1 ring-border md:hidden"
          >
            <Bell className="size-4" />
            {unreadAlerts > 0 && (
              <span className="absolute right-2 top-2 size-2 rounded-full bg-primary" />
            )}
          </Link>
          <div className="hidden md:block">
            <AddFlightDialog />
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {initials(userName)}
          </div>
        </div>
      </header>

      <div className="flex h-10 min-h-10 items-center rounded-full bg-muted p-0.5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "flex h-full min-h-0 flex-1 items-center justify-center gap-2 rounded-full py-0 text-sm font-medium leading-none",
              tab === item.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {item.id === "upcoming" && <Plane className="size-4" />}
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-3">
          {visible.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-lg font-medium">{t("home.emptyTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("home.emptyBody")}</p>
              <div className="mt-4">
                <AddFlightDialog triggerLabel={t("home.addFirst")} />
              </div>
            </Card>
          ) : (
            visible.map((row) => <FlightCard key={row.id} row={row} />)
          )}
        </div>

        <aside className="hidden space-y-3 lg:block">
          <Card className="overflow-hidden p-0">
            <HomeHeroMap
              flights={live.slice(0, 4).map((row) => toMapFlight(row.flight))}
              tracked={tracked}
            />
          </Card>
          <div className="grid grid-cols-3 gap-2">
            <Card className="p-4 text-center">
              <p className="text-xl font-semibold">{stats.flights}</p>
              <p className="text-xs text-muted-foreground">{t("home.flights")}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xl font-semibold">{Math.round(stats.hours)}h</p>
              <p className="text-xs text-muted-foreground">{t("home.airtime")}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-xl font-semibold">{stats.countries}</p>
              <p className="text-xs text-muted-foreground">{t("home.countries")}</p>
            </Card>
          </div>
          <Link href="/alerts" className="block">
            <Card className="p-4 hover:bg-muted">
              <p className="text-sm font-medium">{t("home.alerts")}</p>
              <p className="text-sm text-muted-foreground">
                {unreadAlerts ? t("home.unread", { n: unreadAlerts }) : t("home.noAlerts")}
              </p>
            </Card>
          </Link>
        </aside>
      </div>

      <div className="fixed bottom-24 right-4 z-30 md:hidden">
        <AddFlightDialog triggerLabel={t("home.add")} />
      </div>
    </div>
  );
}
