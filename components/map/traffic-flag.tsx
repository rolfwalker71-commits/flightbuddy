"use client";

import { AirlineLogo } from "@/components/flights/airline-logo";
import { useT } from "@/components/i18n/prefs-provider";
import { displayCallsign } from "@/lib/callsign";
import { formatAltitudePair, formatSpeedPair } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import type { ViewportTrafficAircraft } from "@/lib/viewport-traffic";

export function trafficCallsign(ac: ViewportTrafficAircraft) {
  return displayCallsign(ac.callsign, ac.icao24.slice(0, 6).toUpperCase());
}

export function TrafficFlag({
  aircraft,
  locale,
  selected,
  onSelect,
}: {
  aircraft: ViewportTrafficAircraft;
  locale: Locale;
  selected?: boolean;
  onSelect: (aircraft: ViewportTrafficAircraft) => void;
}) {
  const t = useT();
  const callsign = trafficCallsign(aircraft);
  const alt = formatAltitudePair(aircraft.altitudeFt, locale).primary;
  const spd = formatSpeedPair(aircraft.speedKts, locale).primary;
  const airline = aircraft.airlineName?.trim();

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(aircraft);
      }}
      aria-label={t("map.trafficSelect", { callsign })}
      aria-pressed={selected}
      className={cn(
        "fb-card flex max-w-[9.5rem] items-center gap-1 px-1.5 py-1 text-left",
        selected && "bg-secondary text-primary",
      )}
    >
      <AirlineLogo
        size="xs"
        iata={aircraft.airlineIata}
        name={airline || callsign}
        className="bg-transparent"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium leading-snug text-foreground">{callsign}</span>
        {airline && (
          <span className="block text-[0.625rem] leading-snug text-muted-foreground">{airline}</span>
        )}
        <span className="block text-[0.625rem] leading-snug text-muted-foreground">
          {alt} · {spd}
        </span>
      </span>
    </button>
  );
}
