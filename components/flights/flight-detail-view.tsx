"use client";

import Link from "next/link";
import { ArrowLeft, Compass, Gauge, Mountain, Route } from "lucide-react";
import { FlightMap } from "@/components/map/flight-map";
import { StatusBadge } from "@/components/flights/status-badge";
import { DeleteFlightButton } from "@/components/flights/delete-flight-button";
import { TrackDailyToggle } from "@/components/flights/track-daily-toggle";
import { RoutePlane } from "@/components/flights/route-plane";
import { cn, displayFlightNumber } from "@/lib/utils";
import {
  flightMetrics,
  flightNeedsLiveClock,
  flightTelemetry,
  toMapFlight,
  type UserFlightView,
} from "@/lib/flight-view";
import { useLiveClock } from "@/lib/use-live-clock";
import { Card, tileClassName } from "@/components/ui/card";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { AirportClock } from "@/components/flights/airport-clock";
import { AirlineLogo } from "@/components/flights/airline-logo";
import { AircraftHistoryControl } from "@/components/flights/aircraft-history";
import { AircraftPhotoCard } from "@/components/flights/aircraft-photo";
import {
  adsbCaption,
  formatAltitudePair,
  formatDistanceMiles,
  formatHeading,
  formatSpeedPair,
  formatStand,
  metricLabel,
} from "@/lib/i18n/format";
import { useLiveFlights } from "@/lib/use-live-flights";

export function FlightDetailView({ row: initial }: { row: UserFlightView }) {
  const t = useT();
  const { locale, units } = usePrefs();
  const [row] = useLiveFlights([initial]);
  const { flight } = row;
  const nowMs = useLiveClock(flightNeedsLiveClock(flight));
  const now = new Date(nowMs);
  const m = flightMetrics(flight, now);
  const tel = flightTelemetry(flight, m);
  const airlineIata = flight.airline?.iata ?? flight.airlineIata;
  const depStand = formatStand(locale, flight.gate, flight.terminal);
  const arrStand = formatStand(locale, flight.arrivalGate, flight.arrivalTerminal);
  const altitude = formatAltitudePair(tel.altitudeFt, locale);
  const speed = formatSpeedPair(tel.speedKts, locale);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex h-11 w-11 items-center justify-center rounded-full bg-card ring-1 ring-border">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">{displayFlightNumber(flight.flightNumber)}</h1>
        <div className="w-11" />
      </div>

      <div className="h-52 overflow-hidden rounded-2xl sm:h-56 md:h-80">
        {m.origin && m.dest ? (
          <FlightMap className="h-full w-full" flights={[toMapFlight(flight, { now })]} showLocate followCamera />
        ) : (
          <Card className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("flight.needAirports")}
          </Card>
        )}
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="break-words text-xl font-bold">
              {flight.airline?.name ?? flight.airlineIata ?? "—"}
            </p>
            <AircraftHistoryControl
              flightId={flight.id}
              registration={flight.registration}
              icao24={flight.icao24}
              aircraftType={flight.aircraftType}
              variant="detail"
            />
          </div>
          <div className="hidden min-h-24 min-w-0 flex-1 items-center justify-center md:flex">
            <AircraftPhotoCard flightId={flight.id} registration={flight.registration} />
          </div>
          <AirlineLogo size="md" className="md:hidden" iata={airlineIata} name={flight.airline?.name} />
          <AirlineLogo size="lg" className="hidden md:flex" iata={airlineIata} name={flight.airline?.name} />
        </div>
        <div className="mt-5 grid grid-cols-2 items-start gap-x-4">
          <div>
            <p className="break-words text-3xl font-bold tracking-tight md:text-4xl">{flight.departureAirport?.iata ?? "—"}</p>
            <p className="text-sm leading-snug text-muted-foreground">{flight.departureAirport?.city}</p>
            {depStand && <p className="text-sm leading-snug text-muted-foreground">{depStand}</p>}
          </div>
          <div className="text-right">
            <p className="break-words text-3xl font-bold tracking-tight md:text-4xl">{flight.arrivalAirport?.iata ?? "—"}</p>
            <p className="text-sm leading-snug text-muted-foreground">{flight.arrivalAirport?.city}</p>
            {arrStand && <p className="text-sm leading-snug text-muted-foreground">{arrStand}</p>}
          </div>
        </div>
        <div className="relative mt-4 h-1 rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.round(m.progress * 100)}%` }} />
          <RoutePlane progress={m.progress} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("flight.progress", { n: Math.round(m.progress * 100) })}
          {m.positionEstimated ? ` · ${t("flight.estimate")}` : ""}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <AirportClock
            variant="detail"
            role="dep"
            scheduled={flight.scheduledDep}
            estimated={flight.estimatedDep}
            actual={flight.actualDep}
            iata={flight.departureAirport?.iata}
            storedTimeZone={flight.departureAirport?.timezone}
            status={flight.status}
          />
          <AirportClock
            variant="detail"
            role="arr"
            align="right"
            scheduled={flight.scheduledArr}
            estimated={flight.estimatedArr}
            actual={flight.actualArr}
            iata={flight.arrivalAirport?.iata}
            storedTimeZone={flight.arrivalAirport?.timezone}
            status={flight.status}
          />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            icon={Mountain}
            label={t("flight.altitude")}
            value={altitude.primary}
            secondary={altitude.secondary}
          />
          <Metric
            icon={Gauge}
            label={metricLabel(locale, "flight.speed", tel.speedEstimated)}
            value={speed.primary}
            secondary={speed.secondary}
          />
          <Metric
            icon={Compass}
            label={metricLabel(locale, "flight.heading", tel.headingEstimated)}
            value={formatHeading(tel.heading, locale)}
          />
          <Metric
            icon={Route}
            label={t("flight.distRemaining")}
            value={formatDistanceMiles(m.remainingMiles, locale, units)}
          />
        </div>

        <div className="mt-5 flex items-center justify-between">
          <StatusBadge status={flight.status} delayMinutes={flight.delayMinutes} />
          <p className="text-sm text-muted-foreground">{t("flight.seat", { seat: row.seat ?? "—" })}</p>
        </div>
        <div className={cn(tileClassName, "mt-4 p-3")}>
          <TrackDailyToggle flightId={flight.id} initial={Boolean(row.trackDaily)} key={flight.id} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{adsbCaption(flight, locale)}</p>
      </Card>

      <DeleteFlightButton
        flightId={flight.id}
        flightNumber={flight.flightNumber}
        redirectTo="/"
      />
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  secondary,
}: {
  icon: typeof Mountain;
  label: string;
  value: string;
  secondary?: string;
}) {
  const showSecondary = Boolean(secondary && secondary !== "—" && value !== "—");
  return (
    <div className={cn(tileClassName, "p-3")}>
      <Icon className="mb-2 size-4 text-muted-foreground" />
      <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-snug">{value}</p>
      {showSecondary && <p className="text-xs text-muted-foreground">{secondary}</p>}
    </div>
  );
}
