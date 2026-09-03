"use client";

import { FlightMap } from "@/components/map/flight-map";
import { StatusBadge } from "@/components/flights/status-badge";
import { Card } from "@/components/ui/card";
import { AirlineLogo } from "@/components/flights/airline-logo";
import { AirportClock } from "@/components/flights/airport-clock";
import { RoutePlane } from "@/components/flights/route-plane";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { formatStand } from "@/lib/i18n/format";
import { flightMetrics, toMapFlight, type FlightWithRelations } from "@/lib/flight-view";
import { displayFlightNumber } from "@/lib/utils";
import type { SharePayload } from "@/lib/share";
import { connectionBetween, type ConnectionInfo } from "@/lib/trips-shared";
import { ConnectionBadge } from "@/components/flights/trip-panel";

function SharedLeg({ flight }: { flight: FlightWithRelations }) {
  const t = useT();
  const { locale } = usePrefs();
  const m = flightMetrics(flight);
  const depStand = formatStand(locale, flight.gate, flight.terminal);
  const arrStand = formatStand(locale, flight.arrivalGate, flight.arrivalTerminal);
  const airlineIata = flight.airline?.iata ?? flight.airlineIata;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{displayFlightNumber(flight.flightNumber)}</p>
          <p className="text-sm text-muted-foreground">{flight.airline?.name ?? airlineIata ?? "—"}</p>
        </div>
        <AirlineLogo size="md" iata={airlineIata} name={flight.airline?.name} />
      </div>

      {m.origin && m.dest && (
        <div className="h-40 overflow-hidden rounded-[var(--tile-radius)]">
          <FlightMap className="h-full w-full" flights={[toMapFlight(flight)]} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xl font-bold">{flight.departureAirport?.iata ?? "—"}</p>
          <p className="text-sm text-muted-foreground">{flight.departureAirport?.city}</p>
          {depStand && <p className="text-sm text-muted-foreground">{depStand}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{flight.arrivalAirport?.iata ?? "—"}</p>
          <p className="text-sm text-muted-foreground">{flight.arrivalAirport?.city}</p>
          {arrStand && <p className="text-sm text-muted-foreground">{arrStand}</p>}
        </div>
      </div>

      <div className="relative h-1 rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.round(m.progress * 100)}%` }} />
        <RoutePlane progress={m.progress} />
      </div>

      <div className="grid grid-cols-2 gap-4">
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

      <StatusBadge status={flight.status} delayMinutes={flight.delayMinutes} />
      <p className="text-xs text-muted-foreground">{t("share.readOnly")}</p>
    </Card>
  );
}

export function ShareFlightView({ payload }: { payload: SharePayload }) {
  if (payload.kind === "flight") {
    return <SharedLeg flight={payload.flight as FlightWithRelations} />;
  }

  const connections: Array<ConnectionInfo | null> = [];
  for (let i = 0; i < payload.flights.length - 1; i++) {
    const a = payload.flights[i];
    const b = payload.flights[i + 1];
    connections.push(
      connectionBetween(
        a.actualArr ?? a.estimatedArr ?? a.scheduledArr,
        b.actualDep ?? b.estimatedDep ?? b.scheduledDep,
        a.arrivalAirport?.iata,
        b.departureAirport?.iata,
      ),
    );
  }

  return (
    <div className="space-y-3">
      {payload.flights.map((flight, index) => (
        <div key={flight.id} className="space-y-2">
          <SharedLeg flight={flight as FlightWithRelations} />
          {connections[index] && <ConnectionBadge info={connections[index]!} />}
        </div>
      ))}
    </div>
  );
}
