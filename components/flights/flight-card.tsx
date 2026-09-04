import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./status-badge";
import { DeleteFlightButton } from "./delete-flight-button";
import { RoutePlane } from "./route-plane";
import { displayFlightNumber } from "@/lib/utils";
import {
  flightMetrics,
  flightNeedsLiveClock,
  flightTelemetry,
  toMapFlight,
  type UserFlightView,
} from "@/lib/flight-view";
import { useLiveClock } from "@/lib/use-live-clock";
import { isLiveStatus, isPastStatus } from "@/lib/flight-status";
import { departureInstant, flightHasDeparted } from "@/lib/flight-interpolate";
import { FlightMap } from "@/components/map/flight-map";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { formatAltitudePair, formatClock, formatDay, formatDuration, formatStand } from "@/lib/i18n/format";
import { airportTimeZone } from "@/lib/airport-tz";
import { isLegDelayed, resolveLegTimes } from "@/lib/flight-times";
import { cn } from "@/lib/utils";
import { AirportClock } from "./airport-clock";
import { AirlineLogo } from "./airline-logo";
import { AircraftHistoryControl } from "./aircraft-history";
import { RecurringMark, TrackDailyToggle } from "./track-daily-toggle";
import { ConnectionBadge } from "./trip-panel";
import type { ConnectionInfo } from "@/lib/trips-shared";

export function FlightCard({
  row,
  variant = "default",
  connection,
  tripName,
}: {
  row: UserFlightView;
  variant?: "default" | "compact";
  connection?: ConnectionInfo | null;
  tripName?: string | null;
}) {
  const { locale, units } = usePrefs();
  const t = useT();
  const { flight } = row;
  const live = isLiveStatus(flight.status);
  const nowMs = useLiveClock(flightNeedsLiveClock(flight));
  const now = new Date(nowMs);
  const m = flightMetrics(flight, now);
  const tel = flightTelemetry(flight, m);
  const from = flight.departureAirport?.iata ?? "—";
  const to = flight.arrivalAirport?.iata ?? "—";
  const label = displayFlightNumber(flight.flightNumber);
  const airlineName = flight.airline?.name ?? flight.airlineIata;
  const airlineIata = flight.airline?.iata ?? flight.airlineIata;
  const depStand = formatStand(locale, flight.gate, flight.terminal);
  const arrStand = formatStand(locale, flight.arrivalGate, flight.arrivalTerminal);
  const aircraftLine = [flight.aircraftType, flight.registration].filter(Boolean).join(" · ");
  const originDate = formatDay(
    flight.scheduledDep,
    units,
    airportTimeZone(flight.departureAirport?.iata, flight.departureAirport?.timezone),
  );
  const altitude = tel.altitudeFt != null ? formatAltitudePair(tel.altitudeFt, locale) : null;
  const depInstant = departureInstant(flight);
  const minutesToDep = depInstant ? (depInstant.getTime() - nowMs) / 60000 : null;
  const departed = flightHasDeparted(flight, now);
  const past = isPastStatus(flight.status);
  const remainingLabel = formatDuration(m.remainingMin, locale);
  const liveMeta = altitude ? `${altitude.primary} · ${altitude.secondary}` : t("flight.live");
  const routeCaption = live
    ? `${remainingLabel} · ${liveMeta}`
    : (depStand ?? formatDuration(m.durationMin, locale));

  const progressPct = Math.round(m.progress * 100);

  return (
    <Card className="relative overflow-hidden bg-card p-3 transition-colors hover:bg-muted md:p-4">
      <Link
        href={`/flights/${flight.id}`}
        className="absolute inset-0 z-0 rounded-[var(--tile-radius)]"
        aria-label={label}
      />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="pointer-events-none min-w-0 flex-1 text-sm text-muted-foreground">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0 text-base font-semibold leading-snug text-foreground md:text-lg">
            <span>{label}</span>
            {airlineName && <span>{airlineName}</span>}
            {originDate && <span className="text-xs font-normal text-muted-foreground">{originDate}</span>}
            <RecurringMark active={row.trackDaily} />
          </p>
          {tripName && <p className="mt-0.5 text-xs leading-snug text-primary">{tripName}</p>}
          {connection && <ConnectionBadge info={connection} />}
          {aircraftLine && !flight.registration && !flight.icao24 && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{aircraftLine}</p>
          )}
          <AircraftHistoryControl
            flightId={flight.id}
            registration={flight.registration}
            icao24={flight.icao24}
            aircraftType={flight.aircraftType}
            variant="compact"
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 md:gap-2">
          <div className="pointer-events-none">
            <StatusBadge status={flight.status} delayMinutes={flight.delayMinutes} />
          </div>
          <TrackDailyToggle
            key={flight.id}
            flightId={flight.id}
            initial={Boolean(row.trackDaily)}
            variant="icon"
          />
          <DeleteFlightButton flightId={flight.id} flightNumber={flight.flightNumber} variant="icon" />
          <div className="pointer-events-none">
            <AirlineLogo size="sm" className="md:hidden" iata={airlineIata} name={flight.airline?.name} />
            <AirlineLogo size="md" className="hidden md:flex" iata={airlineIata} name={flight.airline?.name} />
          </div>
        </div>
      </div>

      <div className="pointer-events-none mt-3 md:mt-4">
        {/* Mobile: compact endpoints + full-width track. */}
        <div className="md:hidden">
          <div className="grid grid-cols-[auto_minmax(3.5rem,1fr)_auto] items-center gap-x-2">
            <p className="text-2xl font-bold tracking-tight">{from}</p>
            <div className="flex min-h-5 min-w-0 items-center px-0.5">
              <div className="relative h-0.5 w-full rounded-full bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${progressPct}%` }}
                />
                <RoutePlane progress={m.progress} className="size-4 [&_svg]:size-3.5" />
              </div>
            </div>
            <p className="text-right text-2xl font-bold tracking-tight">{to}</p>
          </div>
          <div className="mt-0.5 grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-2 text-xs text-muted-foreground">
            <p className="min-w-0 truncate">{flight.departureAirport?.city || "\u00a0"}</p>
            <p className="max-w-[11rem] shrink-0 text-center leading-snug">{routeCaption}</p>
            <p className="min-w-0 truncate text-right">{flight.arrivalAirport?.city || "\u00a0"}</p>
          </div>
        </div>

        {/* Desktop: progress sits between IATA codes. */}
        <div className="hidden md:block">
          <div className="grid grid-cols-[auto_minmax(5rem,1fr)_auto] items-center gap-x-3">
            <p className="text-3xl font-bold tracking-tight">{from}</p>
            <div className="flex min-h-[2.25rem] min-w-0 items-center px-2">
              <div className="relative h-px w-full bg-border">
                <div
                  className="absolute inset-y-0 left-0 bg-primary"
                  style={{ width: `${progressPct}%` }}
                />
                <RoutePlane progress={m.progress} />
              </div>
            </div>
            <p className="text-right text-3xl font-bold tracking-tight">{to}</p>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3">
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {flight.departureAirport?.city || "\u00a0"}
            </p>
            <p className="min-w-0 truncate text-right text-sm text-muted-foreground">
              {flight.arrivalAirport?.city || "\u00a0"}
            </p>
          </div>
          <p className="mt-1 truncate text-center text-xs text-muted-foreground">{routeCaption}</p>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-3 md:mt-4 md:gap-x-4">
          <AirportClock
            role="dep"
            showViewer={false}
            scheduled={flight.scheduledDep}
            estimated={flight.estimatedDep}
            actual={flight.actualDep}
            iata={flight.departureAirport?.iata}
            storedTimeZone={flight.departureAirport?.timezone}
            status={flight.status}
          />
          <AirportClock
            role="arr"
            align="right"
            showViewer={false}
            scheduled={flight.scheduledArr}
            estimated={flight.estimatedArr}
            actual={flight.actualArr}
            iata={flight.arrivalAirport?.iata}
            storedTimeZone={flight.arrivalAirport?.timezone}
            status={flight.status}
          />
        </div>

        {(depStand || arrStand) && (
          <div className="mt-0.5 hidden grid-cols-2 gap-x-4 md:grid">
            <p className="min-w-0 truncate text-xs text-muted-foreground">{depStand || "\u00a0"}</p>
            <p className="min-w-0 truncate text-right text-xs text-muted-foreground">
              {arrStand || "\u00a0"}
            </p>
          </div>
        )}
      </div>

      {/* Mini-map only on md+ — on phones the detail screen has the full map. */}
      {variant === "default" && live && m.origin && m.dest && (
        <div className="pointer-events-none mt-3 hidden h-36 overflow-hidden rounded-[calc(var(--tile-radius)*0.65)] md:mt-4 md:block">
          <FlightMap
            interactive={false}
            className="h-36 w-full"
            flights={[toMapFlight(flight, { now })]}
          />
        </div>
      )}

      {!live && (
        <div className="pointer-events-none mt-3 grid grid-cols-3 gap-2 text-center text-sm md:mt-4">
          <div className="min-w-0">
            {departed ? (
              <Badge variant="live" className="mx-auto max-w-full whitespace-normal break-words text-center">
                {t("flight.departedEnRoute")}
              </Badge>
            ) : past ? (
              <StatusBadge status={flight.status} delayMinutes={flight.delayMinutes} className="mx-auto max-w-full whitespace-normal text-center" />
            ) : (
              <>
                <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{t("flight.departsIn")}</p>
                <p className="font-medium leading-snug break-words">
                  {formatDuration(minutesToDep, locale)}
                </p>
              </>
            )}
          </div>
          <div>
            <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{t("flight.departs")}</p>
            <p
              className={cn(
                "font-medium",
                isLegDelayed(
                  resolveLegTimes(flight.scheduledDep, flight.estimatedDep, flight.actualDep),
                  flight.status,
                ) && "text-destructive",
              )}
            >
              {formatClock(
                flight.actualDep ?? flight.estimatedDep ?? flight.scheduledDep,
                units,
                airportTimeZone(flight.departureAirport?.iata, flight.departureAirport?.timezone),
              )}
            </p>
          </div>
          <div>
            <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{t("flight.aircraft")}</p>
            <p className="font-medium">{flight.aircraftType ?? flight.registration ?? "—"}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
