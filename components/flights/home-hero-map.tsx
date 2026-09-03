"use client";

import { useCallback, useEffect, useState } from "react";
import { FlightMap, type MapFlight } from "@/components/map/flight-map";
import { TrackObjectButton } from "@/components/map/track-object-button";
import { AirlineLogo } from "@/components/flights/airline-logo";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { displayCallsign } from "@/lib/callsign";
import { formatAltitudePair, formatNumber, formatPollInterval, formatSpeedPair } from "@/lib/i18n/format";
import type { Locale, MessageKey } from "@/lib/i18n/messages";
import {
  HOME_MAP_CAMERA_KEY,
  HOME_MAP_TRAFFIC_KEY,
  readFlag,
  writeFlag,
} from "@/lib/map-camera";
import type { TrackedAircraftView } from "@/lib/tracked-aircraft-types";
import { useTrackedAircraft } from "@/lib/use-tracked-aircraft";
import { useViewportTraffic } from "@/lib/use-viewport-traffic";
import {
  boundsNearlyEqual,
  type ViewportBounds,
  type ViewportTrafficAircraft,
} from "@/lib/viewport-traffic";

export function HomeHeroMap({
  flights,
  tracked = [],
}: {
  flights: MapFlight[];
  tracked?: TrackedAircraftView[];
}) {
  const t = useT();
  const { locale } = usePrefs();
  const [trafficOn, setTrafficOn] = useState(true);
  const [trafficReady, setTrafficReady] = useState(false);
  const [viewport, setViewport] = useState<ViewportBounds | null>(null);

  useEffect(() => {
    setTrafficOn(readFlag(HOME_MAP_TRAFFIC_KEY, true));
    setTrafficReady(true);
  }, []);

  const onToggle = useCallback((value: boolean) => {
    setTrafficOn(value);
    writeFlag(HOME_MAP_TRAFFIC_KEY, value);
  }, []);

  const onViewportChange = useCallback((bounds: ViewportBounds) => {
    setViewport((prev) => (boundsNearlyEqual(prev, bounds) ? prev : bounds));
  }, []);

  const traffic = useViewportTraffic(trafficReady && trafficOn, viewport, "home");
  const objects = useTrackedAircraft(tracked);
  const [selectedTraffic, setSelectedTraffic] = useState<ViewportTrafficAircraft | null>(null);

  useEffect(() => {
    if (!trafficOn) setSelectedTraffic(null);
  }, [trafficOn]);

  useEffect(() => {
    if (!selectedTraffic) return;
    const next = traffic.aircraft.find((ac) => ac.icao24 === selectedTraffic.icao24);
    if (next && next !== selectedTraffic) setSelectedTraffic(next);
  }, [traffic.aircraft, selectedTraffic]);

  return (
    <div>
      <div className="h-56">
        <FlightMap
          interactive
          followCamera={false}
          persistCameraKey={HOME_MAP_CAMERA_KEY}
          showLocate
          showFollowResume={false}
          autoLocateIfGranted
          flights={flights}
          viewportTraffic={trafficOn ? traffic.aircraft : undefined}
          selectedTrafficId={selectedTraffic?.icao24}
          onViewportChange={onViewportChange}
          onSelectTraffic={setSelectedTraffic}
        />
      </div>
      <div className="flex min-h-11 items-start gap-3 border-t border-border px-3 py-2">
        <Switch
          id="home-viewport-traffic"
          checked={trafficOn}
          onCheckedChange={onToggle}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label htmlFor="home-viewport-traffic" className="text-sm font-medium leading-snug text-foreground">
            {t("map.viewportTraffic")}
          </Label>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {trafficCaption(t, locale, trafficOn, traffic)}
          </p>
        </div>
      </div>
      {selectedTraffic && (
        <HomeTrafficSave
          aircraft={selectedTraffic}
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
      )}
    </div>
  );
}

function HomeTrafficSave({
  aircraft,
  tracked,
  onSave,
  onUntrack,
}: {
  aircraft: ViewportTrafficAircraft;
  tracked?: TrackedAircraftView | null;
  onSave: (ac: ViewportTrafficAircraft) => Promise<void>;
  onUntrack: (id: string) => Promise<void>;
}) {
  const { locale } = usePrefs();
  const callsign = displayCallsign(aircraft.callsign, aircraft.icao24.slice(0, 6).toUpperCase());
  const alt = formatAltitudePair(aircraft.altitudeFt, locale);
  const speed = formatSpeedPair(aircraft.speedKts, locale);
  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <AirlineLogo
          size="sm"
          iata={aircraft.airlineIata}
          name={aircraft.airlineName ?? callsign}
          className="bg-transparent"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{callsign}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {aircraft.airlineName ?? aircraft.icao24.toUpperCase()} · {alt.primary} · {speed.primary}
          </p>
        </div>
      </div>
      <TrackObjectButton aircraft={aircraft} tracked={tracked} onSave={onSave} onUntrack={onUntrack} />
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
