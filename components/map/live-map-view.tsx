"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FlightMap } from "./flight-map";
import { Card, tileClassName } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/flights/status-badge";
import { AddFlightDialog } from "@/components/flights/add-flight-dialog";
import { displayFlightNumber } from "@/lib/utils";
import {
  flightMetrics,
  flightNeedsLiveClock,
  flightTelemetry,
  toMapFlight,
  type UserFlightView,
} from "@/lib/flight-view";
import { useLiveClock } from "@/lib/use-live-clock";
import { isLiveStatus } from "@/lib/flight-status";
import { cn } from "@/lib/utils";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import type { Locale, MessageKey } from "@/lib/i18n/messages";
import {
  adsbCaption,
  formatAltitudePair,
  formatClock,
  formatDay,
  formatHeading,
  formatNumber,
  formatPollInterval,
  formatSpeedPair,
  metricLabel,
} from "@/lib/i18n/format";
import { airportTimeZone } from "@/lib/airport-tz";
import { isLegDelayed, resolveLegTimes } from "@/lib/flight-times";
import { AirlineLogo } from "@/components/flights/airline-logo";
import { RecurringMark, TrackDailyToggle } from "@/components/flights/track-daily-toggle";
import { useLiveFlights } from "@/lib/use-live-flights";
import { useTrackedAircraft } from "@/lib/use-tracked-aircraft";
import { useViewportTraffic } from "@/lib/use-viewport-traffic";
import type { TrackedAircraftView } from "@/lib/tracked-aircraft";
import { displayCallsign } from "@/lib/callsign";
import { TrackObjectButton } from "./track-object-button";
import { TrackedObjectsList } from "./tracked-objects-list";
import {
  boundsNearlyEqual,
  trafficMatchesFlight,
  type ViewportBounds,
  type ViewportTrafficAircraft,
} from "@/lib/viewport-traffic";

const TRACKED_OPEN_KEY = "fb:liveMap.trackedOpen";
const DETAIL_OPEN_KEY = "fb:liveMap.detailOpen";

function readOpenFlag(key: string, fallback = true) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // private mode / quota
  }
  return fallback;
}

function writeOpenFlag(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // private mode / quota
  }
}

function usePersistedOpen(key: string, fallback = true) {
  const [open, setOpen] = useState(fallback);
  useEffect(() => {
    setOpen(readOpenFlag(key, fallback));
  }, [key, fallback]);
  const set = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setOpen((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        writeOpenFlag(key, next);
        return next;
      });
    },
    [key],
  );
  return [open, set] as const;
}

export function LiveMapView({
  flights: initial,
  tracked: initialTracked = [],
}: {
  flights: UserFlightView[];
  tracked?: TrackedAircraftView[];
}) {
  const t = useT();
  const { locale, units } = usePrefs();
  const flights = useLiveFlights(initial);
  const nowMs = useLiveClock(flights.some((row) => flightNeedsLiveClock(row.flight)));
  const now = new Date(nowMs);
  const objects = useTrackedAircraft(initialTracked);
  const [selectedId, setSelectedId] = useState(flights[0]?.flight.id);
  const [selectedTraffic, setSelectedTraffic] = useState<ViewportTrafficAircraft | null>(null);
  const [trackedOpen, setTrackedOpen] = usePersistedOpen(TRACKED_OPEN_KEY, true);
  const [detailOpen, setDetailOpen] = usePersistedOpen(DETAIL_OPEN_KEY, true);
  const selectedFlight = flights.find((f) => f.flight.id === selectedId) ?? flights[0];
  const selected = selectedTraffic ? undefined : selectedFlight;
  const [trafficOn, setTrafficOn] = useState(false);
  const [viewport, setViewport] = useState<ViewportBounds | null>(null);
  const onViewportChange = useCallback((bounds: ViewportBounds) => {
    setViewport((prev) => (boundsNearlyEqual(prev, bounds) ? prev : bounds));
  }, []);
  const traffic = useViewportTraffic(trafficOn, viewport);

  useEffect(() => {
    if (!trafficOn) setSelectedTraffic(null);
  }, [trafficOn]);

  useEffect(() => {
    if (!selectedTraffic) return;
    const next = traffic.aircraft.find((ac) => ac.icao24 === selectedTraffic.icao24);
    if (next && next !== selectedTraffic) setSelectedTraffic(next);
  }, [traffic.aircraft, selectedTraffic]);

  const selectFlight = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSelectedTraffic(null);
      setDetailOpen(true);
    },
    [setDetailOpen],
  );

  const selectTraffic = useCallback(
    (ac: ViewportTrafficAircraft) => {
      const tracked = flights.find((row) => trafficMatchesFlight(ac, row.flight));
      if (tracked) {
        setSelectedId(tracked.flight.id);
        setSelectedTraffic(null);
        setDetailOpen(true);
        return;
      }
      setSelectedTraffic(ac);
      setDetailOpen(true);
    },
    [flights, setDetailOpen],
  );

  const mapFlights = useMemo(
    () =>
      flights.map((row) =>
        toMapFlight(row.flight, {
          active: !selectedTraffic && row.flight.id === selected?.flight.id,
          now,
        }),
      ),
    [flights, selected, selectedTraffic, now],
  );
  const selectedTel = selected ? flightTelemetry(selected.flight, flightMetrics(selected.flight, now)) : null;
  const selectedAltitude = formatAltitudePair(selectedTel?.altitudeFt, locale);
  const selectedSpeed = formatSpeedPair(selectedTel?.speedKts, locale);
  const showDetail = Boolean(selected || selectedTraffic);
  const trafficAlt = selectedTraffic ? formatAltitudePair(selectedTraffic.altitudeFt, locale) : null;
  const trafficSpeed = selectedTraffic ? formatSpeedPair(selectedTraffic.speedKts, locale) : null;

  return (
    <div className="relative -mx-4 h-[calc(100dvh-var(--app-header-pad)-var(--app-main-pb))] md:-mx-8">
      <FlightMap
        className="absolute inset-0"
        flights={mapFlights}
        focusedFlightId={selectedFlight?.flight.id}
        followCamera={false}
        showLocate
        locateClassName={cn("right-3 top-3", showDetail && detailOpen ? "md:right-[21.5rem]" : "md:right-16")}
        viewportTraffic={trafficOn ? traffic.aircraft : undefined}
        selectedTrafficId={selectedTraffic?.icao24}
        onViewportChange={onViewportChange}
        onSelectFlight={selectFlight}
        onSelectTraffic={selectTraffic}
      />

      <Card className="absolute left-3 top-3 z-10 max-w-[16.5rem] p-3 md:hidden">
        <ViewportTrafficToggle id="viewport-traffic-mobile" on={trafficOn} onToggle={setTrafficOn} traffic={traffic} />
        {objects.items.length > 0 && (
          <div className="mt-3">
            <TrackedObjectsList
              items={objects.items}
              selectedIcao24={selectedTraffic?.icao24}
              onSelect={(item) => {
                const ac = traffic.aircraft.find((row) => row.icao24 === item.icao24);
                if (ac) selectTraffic(ac);
              }}
              onUntrack={objects.untrack}
            />
          </div>
        )}
      </Card>

      <div className="absolute left-3 top-3 z-10 hidden space-y-2 md:block">
        <Card className="w-80 p-3">
          <ViewportTrafficToggle
            id="viewport-traffic-desktop"
            on={trafficOn}
            onToggle={setTrafficOn}
            traffic={traffic}
          />
        </Card>
        <Card className={cn("p-0", trackedOpen ? "w-80 max-h-[60vh] overflow-y-auto" : "w-11")}>
          {trackedOpen ? (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t("map.tracked")}</p>
                <button
                  type="button"
                  onClick={() => setTrackedOpen(false)}
                  aria-expanded
                  aria-label={t("map.collapseTracked")}
                  title={t("map.collapseTracked")}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft className="size-4" />
                </button>
              </div>
              <div className="space-y-2">
                {flights.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => selectFlight(row.flight.id)}
                    className={cn(
                      tileClassName,
                      "w-full p-3 text-left",
                      !selectedTraffic && selected?.flight.id === row.flight.id && "bg-secondary text-primary",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {displayFlightNumber(row.flight.flightNumber)}
                      </span>
                      <StatusBadge status={row.flight.status} delayMinutes={row.flight.delayMinutes} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.flight.departureAirport?.iata} → {row.flight.arrivalAirport?.iata}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDay(
                          row.flight.scheduledDep,
                          units,
                          airportTimeZone(
                            row.flight.departureAirport?.iata,
                            row.flight.departureAirport?.timezone,
                          ),
                        )}
                      </span>
                      <RecurringMark active={row.trackDaily} />
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <TrackedObjectsList
                  items={objects.items}
                  selectedIcao24={selectedTraffic?.icao24}
                  onSelect={(item) => {
                    const ac = traffic.aircraft.find((row) => row.icao24 === item.icao24);
                    if (ac) selectTraffic(ac);
                  }}
                  onUntrack={objects.untrack}
                />
              </div>
              <div className="mt-3">
                <AddFlightDialog />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTrackedOpen(true)}
              aria-expanded={false}
              aria-label={t("map.expandTracked")}
              title={t("map.tracked")}
              className="flex min-h-11 w-11 flex-col items-center gap-2 py-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" />
              <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-medium leading-none">
                {t("map.tracked")}
              </span>
            </button>
          )}
        </Card>
      </div>

      {showDetail && (
        <Card
          className={cn(
            "absolute z-10 overflow-hidden p-0",
            "bottom-3 left-3 right-3 md:bottom-auto md:left-auto md:right-3 md:top-3",
            detailOpen ? "md:w-80" : "md:w-11",
          )}
        >
          {detailOpen ? (
            <div className="p-4">
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  aria-expanded
                  aria-label={t("map.collapseDetail")}
                  title={t("map.collapseDetail")}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="hidden size-4 md:block" />
                  <ChevronLeft className="size-4 md:hidden" />
                </button>
              </div>
              {selectedTraffic ? (
                <TrafficDetailCard
                  aircraft={selectedTraffic}
                  altitude={trafficAlt!}
                  speed={trafficSpeed!}
                  locale={locale}
                  tracked={objects.byIcao.get(selectedTraffic.icao24)}
                  onSave={async (ac) => {
                    await objects.save({
                      icao24: ac.icao24,
                      callsign: ac.callsign,
                      operator: ac.airlineName,
                      airlineIata: ac.airlineIata,
                    });
                  }}
                  onUntrack={objects.untrack}
                />
              ) : selected ? (
                <>
                  <div className="flex items-center gap-2">
                    <AirlineLogo
                      size="md"
                      iata={selected.flight.airline?.iata ?? selected.flight.airlineIata}
                      name={selected.flight.airline?.name}
                      className="bg-transparent"
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">{selected.flight.airline?.name}</p>
                      <p className="text-xl font-semibold">{displayFlightNumber(selected.flight.flightNumber)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDay(
                          selected.flight.scheduledDep,
                          units,
                          airportTimeZone(
                            selected.flight.departureAirport?.iata,
                            selected.flight.departureAirport?.timezone,
                          ),
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">
                    {selected.flight.departureAirport?.iata ?? "—"} → {selected.flight.arrivalAirport?.iata ?? "—"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <Metric
                      label={t("flight.altitude")}
                      value={selectedAltitude.primary}
                      secondary={selectedAltitude.secondary}
                    />
                    <Metric
                      label={metricLabel(locale, "flight.speed", selectedTel?.speedEstimated)}
                      value={selectedSpeed.primary}
                      secondary={selectedSpeed.secondary}
                    />
                    <Metric
                      label={metricLabel(locale, "flight.heading", selectedTel?.headingEstimated)}
                      value={formatHeading(selectedTel?.heading, locale)}
                    />
                    <Metric
                      label={t("flight.eta")}
                      value={formatClock(
                        selected.flight.actualArr ?? selected.flight.estimatedArr ?? selected.flight.scheduledArr,
                        units,
                        airportTimeZone(selected.flight.arrivalAirport?.iata, selected.flight.arrivalAirport?.timezone),
                      )}
                      delayed={isLegDelayed(
                        resolveLegTimes(
                          selected.flight.scheduledArr,
                          selected.flight.estimatedArr,
                          selected.flight.actualArr,
                        ),
                        selected.flight.status,
                      )}
                    />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {isLiveStatus(selected.flight.status)
                      ? adsbCaption(selected.flight, locale)
                      : t("map.pollIdle")}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm">{t("map.pushAlerts")}</span>
                    <PushToggle flightId={selected.flight.id} initial={selected.pushAlerts} />
                  </div>
                  <div className="mt-2">
                    <TrackDailyToggle
                      key={selected.flight.id}
                      flightId={selected.flight.id}
                      initial={Boolean(selected.trackDaily)}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              aria-expanded={false}
              aria-label={t("map.expandDetail")}
              title={
                selectedTraffic
                  ? displayCallsign(selectedTraffic.callsign, selectedTraffic.icao24.toUpperCase())
                  : selected
                    ? displayFlightNumber(selected.flight.flightNumber)
                    : t("map.expandDetail")
              }
              className="flex min-h-11 w-full items-center justify-center gap-2 px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground md:w-11 md:flex-col"
            >
              <ChevronLeft className="hidden size-4 md:block" />
              <ChevronRight className="size-4 md:hidden" />
              <span className="text-xs font-medium leading-none md:[writing-mode:vertical-rl] md:rotate-180">
                {selectedTraffic
                  ? displayCallsign(selectedTraffic.callsign, selectedTraffic.icao24.slice(0, 6).toUpperCase())
                  : selected
                    ? displayFlightNumber(selected.flight.flightNumber)
                    : t("map.expandDetail")}
              </span>
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

function TrafficDetailCard({
  aircraft,
  altitude,
  speed,
  locale,
  tracked,
  onSave,
  onUntrack,
}: {
  aircraft: ViewportTrafficAircraft;
  altitude: { primary: string; secondary: string };
  speed: { primary: string; secondary: string };
  locale: Locale;
  tracked?: TrackedAircraftView | null;
  onSave: (ac: ViewportTrafficAircraft) => Promise<void>;
  onUntrack: (id: string) => Promise<void>;
}) {
  const t = useT();
  const callsign = displayCallsign(aircraft.callsign, aircraft.icao24.slice(0, 6).toUpperCase());
  return (
    <>
      <div className="flex items-center gap-3">
        <AirlineLogo
          size="md"
          iata={aircraft.airlineIata}
          name={aircraft.airlineName ?? callsign}
          className="bg-transparent"
        />
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{aircraft.airlineName ?? "—"}</p>
          <p className="text-xl font-semibold leading-snug">{callsign}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Metric label={t("flight.altitude")} value={altitude.primary} secondary={altitude.secondary} />
        <Metric label={t("flight.speed")} value={speed.primary} secondary={speed.secondary} />
        <Metric label={t("flight.heading")} value={formatHeading(aircraft.heading, locale)} />
        <Metric label={t("flight.icao24")} value={aircraft.icao24.toUpperCase()} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("map.trafficSnapshot")}</p>
      <TrackObjectButton aircraft={aircraft} tracked={tracked} onSave={onSave} onUntrack={onUntrack} />
    </>
  );
}

function ViewportTrafficToggle({
  id,
  on,
  onToggle,
  traffic,
}: {
  id: string;
  on: boolean;
  onToggle: (value: boolean) => void;
  traffic: ReturnType<typeof useViewportTraffic>;
}) {
  const t = useT();
  const { locale } = usePrefs();
  return (
    <div>
      <div className="flex items-center gap-3">
        <Switch id={id} checked={on} onCheckedChange={onToggle} />
        <Label htmlFor={id} className="text-sm font-medium leading-snug text-foreground">
          {t("map.viewportTraffic")}
        </Label>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
        {trafficCaption(t, locale, on, traffic)}
      </p>
    </div>
  );
}

function trafficCaption(
  translate: (key: MessageKey, vars?: Record<string, string | number>) => string,
  locale: Locale,
  on: boolean,
  traffic: ReturnType<typeof useViewportTraffic>,
) {
  if (!on) return translate("map.viewportTrafficHint");
  const credits =
    traffic.remaining != null
      ? translate("map.viewportTrafficCredits", { n: formatNumber(traffic.remaining, locale) })
      : null;
  if (traffic.status === "exhausted") return translate("map.viewportTrafficPaused");
  if (traffic.status === "throttled") {
    const muted = translate("map.viewportTrafficRateLimit");
    return credits ? `${muted} · ${credits}` : muted;
  }
  if (traffic.status === "zoom") return translate("map.viewportTrafficZoom");
  if (traffic.status === "error") return translate("map.viewportTrafficError");
  if (traffic.status === "live" && traffic.intervalMs) {
    const live = translate("map.viewportTrafficLive", {
      interval: formatPollInterval(traffic.intervalMs, locale),
      n: traffic.count,
    });
    return credits ? `${live} · ${credits}` : live;
  }
  return credits ?? translate("map.viewportTrafficHint");
}

function Metric({
  label,
  value,
  secondary,
  delayed,
}: {
  label: string;
  value: string;
  secondary?: string;
  delayed?: boolean;
}) {
  const showSecondary = Boolean(secondary && secondary !== "—" && value !== "—");
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold leading-snug", delayed && "text-destructive")}>{value}</p>
      {showSecondary && <p className="text-xs text-muted-foreground">{secondary}</p>}
    </div>
  );
}

function PushToggle({ flightId, initial }: { flightId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <Switch
      checked={on}
      onCheckedChange={async (value) => {
        setOn(value);
        await fetch(`/api/flights/${flightId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pushAlerts: value }),
        });
      }}
    />
  );
}
