"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map } from "maplibre-gl";
import { Crosshair, Plane } from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  headingAlongGreatCircle,
  initialBearing,
  interpolateGreatCircle,
  pointAlongGreatCircle,
  type LatLon,
} from "@/lib/geo";
import { formatAltitudePair, formatSpeedPair } from "@/lib/i18n/format";
import { MAP_STYLES, mapLibreStyle } from "@/lib/map-styles";
import { readSavedMapZoom, writeSavedMapZoom } from "@/lib/map-zoom";
import type { ViewportBounds, ViewportTrafficAircraft } from "@/lib/viewport-traffic";
import { deadReckonAircraft } from "@/lib/viewport-traffic";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { cn } from "@/lib/utils";
import { createNorthPlaneImage } from "./plane-icon";

const TRAFFIC_SOURCE = "viewport-traffic";
const TRAFFIC_LAYER = "viewport-traffic-planes";

const PLANE_IMAGE_ID = "flightbuddy-plane";

export type MapFlight = {
  id: string;
  from?: LatLon | null;
  to?: LatLon | null;
  current?: LatLon | null;
  progress?: number;
  heading?: number | null;
  label?: string;
  active?: boolean;
  track?: LatLon[];
  icao24?: string | null;
};

function normalizeHeading(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function planeHeading(flight: MapFlight, from: LatLon, to: LatLon, at: LatLon, progress: number) {
  if (flight.heading != null && Number.isFinite(flight.heading)) {
    return normalizeHeading(flight.heading);
  }
  if (!flight.current) return headingAlongGreatCircle(from, to, progress);
  return initialBearing(at, to);
}

function ensurePlaneImage(map: Map, fill: string, stroke: string) {
  if (map.hasImage(PLANE_IMAGE_ID)) return;
  const { pixelRatio, ...image } = createNorthPlaneImage(fill, stroke);
  map.addImage(PLANE_IMAGE_ID, image, { pixelRatio });
}

function planeFix(flight: MapFlight): LatLon | null {
  const p = flight.current;
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  return p;
}

function trafficFlag(ac: ViewportTrafficAircraft, locale: "de" | "en") {
  const callsign = ac.callsign?.trim() || ac.icao24.slice(0, 6).toUpperCase();
  const alt = formatAltitudePair(ac.altitudeFt, locale).primary;
  const spd = formatSpeedPair(ac.speedKts, locale).primary;
  const metrics = `${alt} · ${spd}`;
  return ac.airlineName ? `${callsign}\n${ac.airlineName}\n${metrics}` : `${callsign}\n${metrics}`;
}

function mapBoundsBox(map: Map): ViewportBounds {
  const b = map.getBounds();
  return {
    lamin: b.getSouth(),
    lomin: b.getWest(),
    lamax: b.getNorth(),
    lomax: b.getEast(),
  };
}

function resolveFocused(flights: MapFlight[], focusedFlightId?: string): MapFlight | undefined {
  if (focusedFlightId) return flights.find((f) => f.id === focusedFlightId);
  const marked = flights.find((f) => f.active === true);
  if (marked) return marked;
  if (flights.length === 1) return flights[0];
  return undefined;
}

const USER_LOCATE_ZOOM = 12;

function hasRouteBounds(flights: MapFlight[]) {
  return flights.some(
    (f) => Boolean(f.from) || Boolean(f.to) || (f.track?.length ?? 0) > 0,
  );
}

function followFocusedPlane(
  map: Map,
  flights: MapFlight[],
  focusedFlightId: string | undefined,
  follow: { map: Map | null; flightId: string | null },
  programmatic: { current: boolean },
) {
  const focused = resolveFocused(flights, focusedFlightId);
  const fix = focused ? planeFix(focused) : null;
  if (!focused || !fix) return false;
  const switched = follow.map !== map || follow.flightId !== focused.id;
  const zoom = switched ? readSavedMapZoom(focused.id) : map.getZoom();
  follow.map = map;
  follow.flightId = focused.id;
  programmatic.current = true;
  map.jumpTo({ center: [fix.lon, fix.lat], zoom });
  programmatic.current = false;
  return true;
}

function fitFlightBounds(map: Map, flights: MapFlight[], programmatic: { current: boolean }) {
  const bounds = new maplibregl.LngLatBounds();
  let has = false;
  for (const f of flights) {
    if (f.from) {
      bounds.extend([f.from.lon, f.from.lat]);
      has = true;
    }
    if (f.to) {
      bounds.extend([f.to.lon, f.to.lat]);
      has = true;
    }
    for (const p of f.track ?? []) {
      bounds.extend([p.lon, p.lat]);
      has = true;
    }
  }
  if (!has) return false;
  programmatic.current = true;
  map.fitBounds(bounds, { padding: 64, maxZoom: 5, duration: 0 });
  programmatic.current = false;
  return true;
}

function applyFollowOrBounds(
  map: Map,
  flights: MapFlight[],
  focusedFlightId: string | undefined,
  follow: { map: Map | null; flightId: string | null },
  programmatic: { current: boolean },
  gesturing: boolean,
) {
  const focused = resolveFocused(flights, focusedFlightId);
  const fix = focused ? planeFix(focused) : null;
  if (fix && !gesturing) {
    followFocusedPlane(map, flights, focusedFlightId, follow, programmatic);
    return;
  }
  if (!fix) {
    follow.map = map;
    follow.flightId = focused?.id ?? null;
    fitFlightBounds(map, flights, programmatic);
  }
}

export function FlightMap({
  flights,
  className,
  interactive = true,
  focusedFlightId,
  showLocate = false,
  autoLocateIfGranted = false,
  locateClassName,
  viewportTraffic,
  onViewportChange,
  onSelectFlight,
  onSelectTraffic,
}: {
  flights: MapFlight[];
  className?: string;
  interactive?: boolean;
  focusedFlightId?: string;
  showLocate?: boolean;
  autoLocateIfGranted?: boolean;
  locateClassName?: string;
  viewportTraffic?: ViewportTrafficAircraft[];
  onViewportChange?: (bounds: ViewportBounds) => void;
  onSelectFlight?: (flightId: string) => void;
  onSelectTraffic?: (aircraft: ViewportTrafficAircraft) => void;
}) {
  const t = useT();
  const { mapStyle, locale } = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const flightsRef = useRef(flights);
  const focusedIdRef = useRef(focusedFlightId);
  const followRef = useRef<{ map: Map | null; flightId: string | null }>({ map: null, flightId: null });
  const programmaticRef = useRef(false);
  const gesturingRef = useRef(false);
  const userOverrideRef = useRef(false);
  const autoLocateRef = useRef(autoLocateIfGranted);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectFlightRef = useRef(onSelectFlight);
  const onSelectTrafficRef = useRef(onSelectTraffic);
  const trafficPollRef = useRef<{ at: number; aircraft: ViewportTrafficAircraft[] }>({
    at: 0,
    aircraft: [],
  });
  const trafficSigRef = useRef("");
  const [userOverride, setUserOverride] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  flightsRef.current = flights;
  focusedIdRef.current = focusedFlightId;
  autoLocateRef.current = autoLocateIfGranted;
  onViewportChangeRef.current = onViewportChange;
  onSelectFlightRef.current = onSelectFlight;
  onSelectTrafficRef.current = onSelectTraffic;

  useEffect(() => {
    if (!ref.current) return;
    mapRef.current?.remove();
    followRef.current = { map: null, flightId: null };
    const map = new maplibregl.Map({
      container: ref.current,
      style: mapLibreStyle(mapStyle),
      center: [-20, 45],
      zoom: 2.4,
      attributionControl: { compact: true },
      interactive,
    });
    mapRef.current = map;

    const persistZoom = () => {
      if (!interactive) return;
      const focused = resolveFocused(flightsRef.current, focusedIdRef.current);
      if (!focused) return;
      writeSavedMapZoom(focused.id, map.getZoom());
    };

    const onGestureStart = () => {
      if (!programmaticRef.current) gesturingRef.current = true;
    };
    const reportViewport = () => {
      onViewportChangeRef.current?.(mapBoundsBox(map));
    };

    const onGestureEnd = () => {
      reportViewport();
      if (programmaticRef.current) return;
      gesturingRef.current = false;
      persistZoom();
      if (userOverrideRef.current) return;
      followFocusedPlane(
        map,
        flightsRef.current,
        focusedIdRef.current,
        followRef.current,
        programmaticRef,
      );
    };

    if (interactive) {
      map.on("dragstart", onGestureStart);
      map.on("zoomstart", onGestureStart);
      map.on("zoomend", onGestureEnd);
      map.on("moveend", onGestureEnd);
    }

    if (map.isStyleLoaded()) reportViewport();
    else map.once("load", reportViewport);

    if (showLocate && autoLocateRef.current) {
      const tryAuto = () => {
        const focused = resolveFocused(flightsRef.current, focusedIdRef.current);
        if (focused && planeFix(focused)) return;
        if (hasRouteBounds(flightsRef.current)) return;
        if (!navigator.geolocation) return;
        const query = navigator.permissions?.query;
        const locateSilent = () => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              userOverrideRef.current = true;
              setUserOverride(true);
              const zoom = map.getZoom() < 5 ? USER_LOCATE_ZOOM : map.getZoom();
              programmaticRef.current = true;
              map.jumpTo({
                center: [pos.coords.longitude, pos.coords.latitude],
                zoom,
              });
              programmaticRef.current = false;
            },
            () => {},
            { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
          );
        };
        if (!query) return;
        void query({ name: "geolocation" })
          .then((status) => {
            if (status.state === "granted") locateSilent();
          })
          .catch(() => {});
      };
      if (map.isStyleLoaded()) tryAuto();
      else map.once("load", tryAuto);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [interactive, mapStyle, showLocate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const palette = MAP_STYLES[mapStyle] ?? MAP_STYLES.dark;

    const draw = () => {
      const features = flights.flatMap((flight) => {
        if (!flight.from || !flight.to) return [];
        const progress = flight.progress ?? 0.4;
        const plane = flight.current ?? pointAlongGreatCircle(flight.from, flight.to, progress);
        const color = flight.active !== false ? palette.arc : "#64748b";
        const track = (flight.track ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
        const trackCoords = track.map((p) => [p.lon, p.lat] as [number, number]);
        const remainingFrom = flight.current ?? (track.length ? track[track.length - 1] : flight.from);
        const arcCoords = interpolateGreatCircle(remainingFrom, flight.to);
        const out = [];
        if (trackCoords.length >= 2) {
          out.push({
            type: "Feature" as const,
            id: `${flight.id}-track`,
            properties: { color, kind: "track" },
            geometry: { type: "LineString" as const, coordinates: trackCoords },
          });
        }
        out.push({
          type: "Feature" as const,
          id: `${flight.id}-arc`,
          properties: { color, kind: "arc", opacity: trackCoords.length >= 2 ? 0.45 : 0.9 },
          geometry: { type: "LineString" as const, coordinates: arcCoords },
        });
        out.push({
          type: "Feature" as const,
          id: `${flight.id}-plane`,
          properties: {
            color,
            kind: "plane",
            heading: planeHeading(flight, flight.from, flight.to, plane, progress),
            label: flight.label ?? "",
            flightId: flight.id,
          },
          geometry: { type: "Point" as const, coordinates: [plane.lon, plane.lat] },
        });
        return out;
      });

      ensurePlaneImage(map, palette.plane, palette.planeStroke);

      const source = map.getSource("flights") as maplibregl.GeoJSONSource | undefined;
      const data = { type: "FeatureCollection" as const, features };
      if (source) {
        source.setData(data);
      } else {
        map.addSource("flights", { type: "geojson", data });
      }

      if (!map.getLayer("arcs")) {
        map.addLayer({
          id: "arcs",
          type: "line",
          source: "flights",
          filter: ["==", ["get", "kind"], "arc"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2.2,
            "line-opacity": ["coalesce", ["get", "opacity"], 0.9],
          },
        });
      }

      if (!map.getLayer("tracks")) {
        map.addLayer({
          id: "tracks",
          type: "line",
          source: "flights",
          filter: ["==", ["get", "kind"], "track"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2.8,
            "line-opacity": 0.95,
          },
        });
      }

      const planes = map.getLayer("planes");
      if (planes && planes.type !== "symbol") {
        map.removeLayer("planes");
      }
      if (!map.getLayer("planes")) {
        map.addLayer({
          id: "planes",
          type: "symbol",
          source: "flights",
          filter: ["==", ["get", "kind"], "plane"],
          layout: {
            "icon-image": PLANE_IMAGE_ID,
            "icon-size": 1,
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "center",
          },
        });
      }

      if (!userOverrideRef.current) {
        applyFollowOrBounds(
          map,
          flights,
          focusedFlightId,
          followRef.current,
          programmaticRef,
          gesturingRef.current,
        );
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [flights, focusedFlightId, mapStyle]);

  useEffect(() => {
    const list = viewportTraffic ?? [];
    const sig = list.map((ac) => `${ac.icao24}:${ac.lat.toFixed(5)}:${ac.lon.toFixed(5)}`).join("|");
    if (sig !== trafficSigRef.current) {
      trafficSigRef.current = sig;
      trafficPollRef.current = { at: Date.now(), aircraft: list };
    } else {
      trafficPollRef.current = { ...trafficPollRef.current, aircraft: list };
    }
  }, [viewportTraffic]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const paint = () => {
      if (!map.isStyleLoaded()) return;
      const skip = new Set(
        flightsRef.current
          .map((f) => f.icao24?.toLowerCase())
          .filter((id): id is string => Boolean(id)),
      );
      const palette = MAP_STYLES[mapStyle] ?? MAP_STYLES.dark;
      ensurePlaneImage(map, palette.plane, palette.planeStroke);
      const elapsed = Date.now() - trafficPollRef.current.at;
      const hidden = document.visibilityState === "hidden";
      const features = trafficPollRef.current.aircraft
        .filter((ac) => !skip.has(ac.icao24))
        .map((ac) => {
          const pos = hidden ? { lat: ac.lat, lon: ac.lon } : deadReckonAircraft(ac, elapsed);
          return {
            type: "Feature" as const,
            id: ac.icao24,
            properties: {
              kind: "traffic",
              heading: ac.heading ?? 0,
              flag: trafficFlag(ac, locale),
              icao24: ac.icao24,
            },
            geometry: { type: "Point" as const, coordinates: [pos.lon, pos.lat] },
          };
        });
      const data = { type: "FeatureCollection" as const, features };
      const source = map.getSource(TRAFFIC_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else map.addSource(TRAFFIC_SOURCE, { type: "geojson", data });

      if (!map.getLayer(TRAFFIC_LAYER)) {
        map.addLayer({
          id: TRAFFIC_LAYER,
          type: "symbol",
          source: TRAFFIC_SOURCE,
          layout: {
            "icon-image": PLANE_IMAGE_ID,
            "icon-size": 0.9,
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "center",
            "text-field": ["get", "flag"],
            "text-size": 11,
            "text-anchor": "left",
            "text-offset": [1.35, 0],
            "text-allow-overlap": false,
            "text-optional": true,
            "text-line-height": 1.15,
            "text-font": ["Open Sans Regular"],
          },
          paint: {
            "text-color": palette.plane,
            "text-halo-color": palette.planeStroke,
            "text-halo-width": 1.4,
            "text-halo-blur": 0.2,
          },
        }, map.getLayer("planes") ? "planes" : undefined);
      }
    };

    if (map.isStyleLoaded()) paint();
    else map.once("load", paint);

    const interval =
      (viewportTraffic?.length ?? 0) > 0
        ? window.setInterval(() => {
            if (document.visibilityState === "hidden") return;
            paint();
          }, 250)
        : 0;

    return () => {
      if (interval) window.clearInterval(interval);
      map.off("load", paint);
    };
  }, [viewportTraffic, mapStyle, locale]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;

    const layerIds = () =>
      [TRAFFIC_LAYER, "planes"].filter((id) => Boolean(map.getLayer(id)));

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const layers = layerIds();
      if (!layers.length) return;
      const hits = map.queryRenderedFeatures(e.point, { layers });
      const hit = hits[0];
      if (!hit) return;
      const props = hit.properties ?? {};
      if (props.kind === "traffic" && typeof props.icao24 === "string") {
        const ac = trafficPollRef.current.aircraft.find((a) => a.icao24 === props.icao24);
        if (ac) {
          userOverrideRef.current = true;
          setUserOverride(true);
          onSelectTrafficRef.current?.(ac);
        }
        return;
      }
      if (typeof props.flightId === "string") {
        onSelectFlightRef.current?.(props.flightId);
      }
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const layers = layerIds();
      if (!layers.length) {
        map.getCanvas().style.cursor = "";
        return;
      }
      const hits = map.queryRenderedFeatures(e.point, { layers });
      map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    };

    const bind = () => {
      map.on("click", onClick);
      map.on("mousemove", onMove);
    };
    if (map.isStyleLoaded()) bind();
    else map.once("load", bind);

    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("load", bind);
      map.getCanvas().style.cursor = "";
    };
  }, [interactive, mapStyle, viewportTraffic]);

  const prevFocusedRef = useRef(focusedFlightId);
  useEffect(() => {
    if (prevFocusedRef.current === focusedFlightId) return;
    prevFocusedRef.current = focusedFlightId;
    userOverrideRef.current = false;
    setUserOverride(false);
    setLocateError(null);
  }, [focusedFlightId]);

  const pauseFollowForUser = () => {
    userOverrideRef.current = true;
    setUserOverride(true);
  };

  const resumePlaneFollow = () => {
    userOverrideRef.current = false;
    setUserOverride(false);
    setLocateError(null);
    const map = mapRef.current;
    if (!map) return;
    applyFollowOrBounds(
      map,
      flightsRef.current,
      focusedIdRef.current,
      followRef.current,
      programmaticRef,
      false,
    );
  };

  const centerOnUser = () => {
    const map = mapRef.current;
    if (!map || locating) return;
    if (!navigator.geolocation) {
      setLocateError(t("map.locateUnavailable"));
      return;
    }
    setLocateError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pauseFollowForUser();
        const zoom = map.getZoom() < 5 ? USER_LOCATE_ZOOM : map.getZoom();
        programmaticRef.current = true;
        map.jumpTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom,
        });
        programmaticRef.current = false;
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocateError(err.code === 1 ? t("map.locateDenied") : t("map.locateUnavailable"));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const focused = resolveFocused(flights, focusedFlightId);
  const canResumeFollow = Boolean(focused && planeFix(focused)) || hasRouteBounds(flights);

  return (
    <div className={cn("relative", className ?? "h-full w-full")}>
      <div ref={ref} className="h-full w-full" />
      {showLocate && (
        <div className={cn("absolute right-2 top-2 z-10 flex flex-col items-end gap-1", locateClassName)}>
          <button
            type="button"
            onClick={centerOnUser}
            disabled={locating}
            aria-label={t("map.locate")}
            title={t("map.locate")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-foreground shadow-sm ring-1 ring-border disabled:opacity-50"
          >
            <Crosshair className={cn("size-4", locating && "animate-pulse")} />
          </button>
          {userOverride && canResumeFollow && (
            <button
              type="button"
              onClick={resumePlaneFollow}
              aria-label={t("map.followPlane")}
              title={t("map.followPlane")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-foreground shadow-sm ring-1 ring-border"
            >
              <Plane className="size-4" />
            </button>
          )}
          {locateError && (
            <p className="max-w-[9.5rem] text-right text-xs leading-snug text-muted-foreground">{locateError}</p>
          )}
        </div>
      )}
    </div>
  );
}
