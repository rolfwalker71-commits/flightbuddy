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

export function FlightCard({
  row,
  variant = "default",
}: {
  row: UserFlightView;
  variant?: "default" | "compact";
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
  const routeCaption = live
    ? `${formatDuration(m.remainingMin, locale)} · ${
        altitude ? `${altitude.primary} · ${altitude.secondary}` : t("flight.live")
      }`
    : (depStand ?? formatDuration(m.durationMin, locale));

  return (
    <Card className="relative overflow-hidden bg-card p-4 transition-colors hover:bg-muted">
      <Link
        href={`/flights/${flight.id}`}
        className="absolute inset-0 z-0 rounded-[var(--tile-radius)]"
        aria-label={label}
      />
      <div className="relative z-10 flex items-center justify-between gap-2 md:gap-3">
        <div className="pointer-events-none min-w-0 text-sm text-muted-foreground">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="break-words text-lg font-semibold text-foreground">{label}</span>
            <span className="break-words text-base font-semibold text-foreground">
              {flight.airline?.name ?? flight.airlineIata}
            </span>
            {originDate && <span className="text-xs text-muted-foreground">{originDate}</span>}
            <RecurringMark active={row.trackDaily} />
          </p>
          {aircraftLine && !flight.registration && !flight.icao24 && (
            <p className="text-xs text-muted-foreground">{aircraftLine}</p>
          )}
          <AircraftHistoryControl
            flightId={flight.id}
            registration={flight.registration}
            icao24={flight.icao24}
            aircraftType={flight.aircraftType}
            variant="compact"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 md:gap-2">
          <div className="pointer-events-none max-w-[6.5rem] md:max-w-none">
            <StatusBadge
              status={flight.status}
              delayMinutes={flight.delayMinutes}
              className="h-auto max-w-full whitespace-normal text-center line-clamp-2"
            />
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

      <div className="pointer-events-none mt-4 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_minmax(0,auto)] items-start gap-x-3">
        <p className="break-words text-2xl font-bold tracking-tight md:text-3xl">{from}</p>
        <div className="flex min-h-[2rem] items-center px-1 md:min-h-[2.25rem] md:px-2">
          <div className="relative h-px w-full bg-border">
            <div
              className="absolute inset-y-0 left-0 bg-primary"
              style={{ width: `${Math.round(m.progress * 100)}%` }}
            />
            <RoutePlane progress={m.progress} />
          </div>
        </div>
        <p className="break-words text-right text-2xl font-bold tracking-tight md:text-3xl">{to}</p>

        <p className="text-sm leading-snug text-muted-foreground">
          {flight.departureAirport?.city || "\u00a0"}
        </p>
        <p className="px-1 text-center text-xs leading-snug break-words text-muted-foreground md:px-2">
          {routeCaption}
        </p>
        <p className="text-right text-sm leading-snug text-muted-foreground">
          {flight.arrivalAirport?.city || "\u00a0"}
        </p>

        <AirportClock
          role="dep"
          scheduled={flight.scheduledDep}
          estimated={flight.estimatedDep}
          actual={flight.actualDep}
          iata={flight.departureAirport?.iata}
          storedTimeZone={flight.departureAirport?.timezone}
          status={flight.status}
        />
        <div />
        <AirportClock
          role="arr"
          align="right"
          scheduled={flight.scheduledArr}
          estimated={flight.estimatedArr}
          actual={flight.actualArr}
          iata={flight.arrivalAirport?.iata}
          storedTimeZone={flight.arrivalAirport?.timezone}
          status={flight.status}
        />

        {(depStand || arrStand) && (
          <>
            <p className="text-xs leading-snug text-muted-foreground">{depStand || "\u00a0"}</p>
            <div />
            <p className="text-right text-xs leading-snug text-muted-foreground">{arrStand || "\u00a0"}</p>
          </>
        )}
      </div>

      {variant === "default" && live && m.origin && m.dest && (
        <div className="pointer-events-none mt-4 h-36 overflow-hidden rounded-[calc(var(--tile-radius)*0.65)]">
          <FlightMap
            interactive={false}
            className="h-36 w-full"
            flights={[toMapFlight(flight, { now })]}
          />
        </div>
      )}

      {!live && (
        <div className="pointer-events-none mt-4 grid grid-cols-3 gap-2 text-center text-sm">
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
