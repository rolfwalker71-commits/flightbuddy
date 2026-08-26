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
import { MAP_STYLES, mapLibreStyle } from "@/lib/map-styles";
import { readSavedMapCamera, writeSavedMapCamera } from "@/lib/map-camera";
import { readSavedMapZoom, writeSavedMapZoom } from "@/lib/map-zoom";
import type { ViewportBounds, ViewportTrafficAircraft } from "@/lib/viewport-traffic";
import { deadReckonAircraft } from "@/lib/viewport-traffic";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { cn } from "@/lib/utils";
import { createNorthPlaneImage } from "./plane-icon";
import { TrafficFlag } from "./traffic-flag";

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

const CLICK_PAD = 16;

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
    return followFocusedPlane(map, flights, focusedFlightId, follow, programmatic);
  }
  if (!fix) {
    follow.map = map;
    follow.flightId = focused?.id ?? null;
    return fitFlightBounds(map, flights, programmatic);
  }
  return false;
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
  selectedTrafficId,
  onViewportChange,
  onSelectFlight,
  onSelectTraffic,
  followCamera = false,
  persistCameraKey,
  showFollowResume = true,
}: {
  flights: MapFlight[];
  className?: string;
  interactive?: boolean;
  focusedFlightId?: string;
  showLocate?: boolean;
  autoLocateIfGranted?: boolean;
  locateClassName?: string;
  viewportTraffic?: ViewportTrafficAircraft[];
  selectedTrafficId?: string | null;
  onViewportChange?: (bounds: ViewportBounds) => void;
  onSelectFlight?: (flightId: string) => void;
  onSelectTraffic?: (aircraft: ViewportTrafficAircraft) => void;
  followCamera?: boolean;
  persistCameraKey?: string;
  showFollowResume?: boolean;
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
  const pendingJumpRef = useRef(true);
  const followCameraRef = useRef(followCamera);
  const persistCameraKeyRef = useRef(persistCameraKey);
  const autoLocateRef = useRef(autoLocateIfGranted);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectFlightRef = useRef(onSelectFlight);
  const onSelectTrafficRef = useRef(onSelectTraffic);
  const trafficPollRef = useRef<{ at: number; aircraft: ViewportTrafficAircraft[] }>({
    at: 0,
    aircraft: [],
  });
  const trafficSigRef = useRef("");
  const paintTrafficRef = useRef<() => void>(() => {});
  const boundLayersRef = useRef(new Set<string>());
  const [userOverride, setUserOverride] = useState(false);
  const [trafficFlags, setTrafficFlags] = useState<
    Array<{ ac: ViewportTrafficAircraft; x: number; y: number }>
  >([]);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  flightsRef.current = flights;
  focusedIdRef.current = focusedFlightId;
  followCameraRef.current = followCamera;
  persistCameraKeyRef.current = persistCameraKey;
  autoLocateRef.current = autoLocateIfGranted;
  onViewportChangeRef.current = onViewportChange;
  onSelectFlightRef.current = onSelectFlight;
  onSelectTrafficRef.current = onSelectTraffic;
  const prevFocusedRef = useRef(focusedFlightId);
  if (prevFocusedRef.current !== focusedFlightId) {
    prevFocusedRef.current = focusedFlightId;
    if (!persistCameraKey) {
      pendingJumpRef.current = true;
      userOverrideRef.current = false;
    }
  }

  useEffect(() => {
    if (!ref.current) return;
    mapRef.current?.remove();
    followRef.current = { map: null, flightId: null };
    const savedCamera = persistCameraKey ? readSavedMapCamera(persistCameraKey) : null;
    pendingJumpRef.current = !persistCameraKey;
    userOverrideRef.current = Boolean(savedCamera);
    setUserOverride(Boolean(savedCamera));
    const map = new maplibregl.Map({
      container: ref.current,
      style: mapLibreStyle(mapStyle),
      center: savedCamera ? [savedCamera.lng, savedCamera.lat] : [-20, 45],
      zoom: savedCamera ? savedCamera.zoom : 2.4,
      attributionControl: { compact: true },
      interactive,
    });
    mapRef.current = map;

    const persistCamera = () => {
      if (!persistCameraKey || programmaticRef.current || !userOverrideRef.current) return;
      const center = map.getCenter();
      writeSavedMapCamera(persistCameraKey, {
        lng: center.lng,
        lat: center.lat,
        zoom: map.getZoom(),
      });
    };

    const persistZoom = () => {
      if (!interactive) return;
      const focused = resolveFocused(flightsRef.current, focusedIdRef.current);
      if (!focused) return;
      writeSavedMapZoom(focused.id, map.getZoom());
    };

    const onGestureStart = () => {
      if (programmaticRef.current) return;
      gesturingRef.current = true;
      if (!followCameraRef.current) {
        pendingJumpRef.current = false;
        userOverrideRef.current = true;
        setUserOverride(true);
      }
    };
    const reportViewport = () => {
      onViewportChangeRef.current?.(mapBoundsBox(map));
    };

    const onGestureEnd = () => {
      reportViewport();
      if (programmaticRef.current) return;
      gesturingRef.current = false;
      persistZoom();
      persistCamera();
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
        if (persistCameraKey && readSavedMapCamera(persistCameraKey)) return;
        if (!persistCameraKey) {
          const focused = resolveFocused(flightsRef.current, focusedIdRef.current);
          if (focused && planeFix(focused)) return;
          if (hasRouteBounds(flightsRef.current)) return;
        }
        if (!navigator.geolocation) return;
        const query = navigator.permissions?.query;
        const locateSilent = () => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              pendingJumpRef.current = false;
              userOverrideRef.current = true;
              setUserOverride(true);
              const zoom = map.getZoom() < 5 ? USER_LOCATE_ZOOM : map.getZoom();
              programmaticRef.current = true;
              map.jumpTo({
                center: [pos.coords.longitude, pos.coords.latitude],
                zoom,
              });
              programmaticRef.current = false;
              if (persistCameraKey) {
                writeSavedMapCamera(persistCameraKey, {
                  lng: pos.coords.longitude,
                  lat: pos.coords.latitude,
                  zoom,
                });
              }
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
      boundLayersRef.current = new Set();
      map.remove();
      mapRef.current = null;
    };
  }, [interactive, mapStyle, showLocate, persistCameraKey]);

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

      const freeCamera = Boolean(persistCameraKey);
      const continuousFollow = !freeCamera && (followCamera || !interactive);
      if (!freeCamera && !userOverrideRef.current && (continuousFollow || pendingJumpRef.current)) {
        const moved = applyFollowOrBounds(
          map,
          flights,
          focusedFlightId,
          followRef.current,
          programmaticRef,
          gesturingRef.current,
        );
        if (moved && !continuousFollow) {
          pendingJumpRef.current = false;
          userOverrideRef.current = true;
          setUserOverride(true);
        }
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [flights, focusedFlightId, mapStyle, followCamera, interactive, persistCameraKey]);

  useEffect(() => {
    const list = viewportTraffic ?? [];
    const sig = list.map((ac) => `${ac.icao24}:${ac.lat.toFixed(5)}:${ac.lon.toFixed(5)}`).join("|");
    if (sig !== trafficSigRef.current) {
      trafficSigRef.current = sig;
      trafficPollRef.current = { at: Date.now(), aircraft: list };
    } else {
      trafficPollRef.current = { ...trafficPollRef.current, aircraft: list };
    }
    paintTrafficRef.current();
  }, [viewportTraffic]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    let alive = true;

    const visibleTraffic = () => {
      const elapsed = Date.now() - trafficPollRef.current.at;
      const frozen = document.visibilityState === "hidden";
      const skip = new Set(
        flightsRef.current
          .map((flight) => flight.icao24?.toLowerCase())
          .filter((id): id is string => Boolean(id)),
      );
      return trafficPollRef.current.aircraft
        .filter((ac) => !skip.has(ac.icao24))
        .map((ac) => {
          const pos = frozen ? { lat: ac.lat, lon: ac.lon } : deadReckonAircraft(ac, elapsed);
          return { ac, pos };
        });
    };

    const syncFlags = () => {
      if (!alive) return;
      try {
        const width = map.getContainer().clientWidth;
        const height = map.getContainer().clientHeight;
        if (width < 8 || height < 8) return;
        const next: Array<{ ac: ViewportTrafficAircraft; x: number; y: number }> = [];
        for (const { ac, pos } of visibleTraffic()) {
          const p = map.project([pos.lon, pos.lat]);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          if (p.x <= -120 || p.y <= -48 || p.x >= width + 24 || p.y >= height + 24) continue;
          next.push({ ac, x: p.x, y: p.y });
        }
        setTrafficFlags(next);
      } catch {
        // Keep last-known flags if the camera transform is mid-update.
      }
    };

    const paint = () => {
      if (!alive) return;
      try {
        if (map.isStyleLoaded()) {
          const palette = MAP_STYLES[mapStyle] ?? MAP_STYLES.dark;
          ensurePlaneImage(map, palette.plane, palette.planeStroke);
          const features = visibleTraffic().map(({ ac, pos }) => ({
            type: "Feature" as const,
            properties: {
              kind: "traffic",
              heading: ac.heading ?? 0,
              icao24: ac.icao24,
            },
            geometry: { type: "Point" as const, coordinates: [pos.lon, pos.lat] },
          }));
          const data = { type: "FeatureCollection" as const, features };
          const source = map.getSource(TRAFFIC_SOURCE) as maplibregl.GeoJSONSource | undefined;
          if (source) source.setData(data);
          else map.addSource(TRAFFIC_SOURCE, { type: "geojson", data });

          if (!map.getLayer(TRAFFIC_LAYER)) {
            map.addLayer(
              {
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
                  "text-allow-overlap": true,
                  "text-ignore-placement": true,
                  "icon-anchor": "center",
                },
              },
              map.getLayer("planes") ? "planes" : undefined,
            );
          } else if (map.getLayoutProperty(TRAFFIC_LAYER, "text-field")) {
            map.setLayoutProperty(TRAFFIC_LAYER, "text-field", "");
          }
        }
      } catch {
        // Style/source can be mid-reload after zoom; flags still sync below.
      }
      syncFlags();
    };

    paintTrafficRef.current = paint;

    const onMove = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        syncFlags();
      });
    };

    if (map.isStyleLoaded()) paint();
    else map.once("load", paint);
    map.on("move", onMove);
    map.on("rotate", onMove);
    map.on("pitch", onMove);
    map.on("idle", syncFlags);

    const interval = window.setInterval(() => {
      if (!alive || document.visibilityState === "hidden") return;
      if (trafficPollRef.current.aircraft.length === 0) {
        syncFlags();
        return;
      }
      paint();
    }, 250);

    return () => {
      alive = false;
      paintTrafficRef.current = () => {};
      window.clearInterval(interval);
      if (raf) window.cancelAnimationFrame(raf);
      map.off("load", paint);
      map.off("move", onMove);
      map.off("rotate", onMove);
      map.off("pitch", onMove);
      map.off("idle", syncFlags);
    };
  }, [mapStyle, interactive, showLocate, persistCameraKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;

    const layerIds = () => [TRAFFIC_LAYER, "planes"].filter((id) => Boolean(map.getLayer(id)));

    const queryHits = (point: maplibregl.Point) => {
      const layers = layerIds();
      if (!layers.length) return [];
      return map.queryRenderedFeatures(
        [
          [point.x - CLICK_PAD, point.y - CLICK_PAD],
          [point.x + CLICK_PAD, point.y + CLICK_PAD],
        ],
        { layers },
      );
    };

    const selectHit = (hit: maplibregl.MapGeoJSONFeature | undefined) => {
      if (!hit) return false;
      const props = hit.properties ?? {};
      if (props.kind === "traffic" && typeof props.icao24 === "string") {
        const ac = trafficPollRef.current.aircraft.find((a) => a.icao24 === props.icao24);
        if (!ac) return false;
        pendingJumpRef.current = false;
        userOverrideRef.current = true;
        setUserOverride(true);
        onSelectTrafficRef.current?.(ac);
        return true;
      }
      if (typeof props.flightId === "string") {
        onSelectFlightRef.current?.(props.flightId);
        return true;
      }
      return false;
    };

    let layerHandled = false;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (layerHandled) {
        layerHandled = false;
        return;
      }
      const hits = queryHits(e.point);
      if (!hits.length) return;
      selectHit(hits[0]);
    };

    const onLayerClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (selectHit(e.features?.[0])) layerHandled = true;
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const layers = layerIds();
      if (!layers.length) {
        map.getCanvas().style.cursor = "";
        return;
      }
      map.getCanvas().style.cursor = queryHits(e.point).length ? "pointer" : "";
    };

    const onLayerEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLayerLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const bindLayers = () => {
      for (const id of [TRAFFIC_LAYER, "planes"]) {
        if (!map.getLayer(id) || boundLayersRef.current.has(id)) continue;
        boundLayersRef.current.add(id);
        map.on("click", id, onLayerClick);
        map.on("mouseenter", id, onLayerEnter);
        map.on("mouseleave", id, onLayerLeave);
      }
    };

    const bind = () => {
      map.on("click", onClick);
      map.on("mousemove", onMove);
      bindLayers();
    };
    if (map.isStyleLoaded()) bind();
    else map.once("load", bind);

    const retry = window.setInterval(bindLayers, 400);

    return () => {
      window.clearInterval(retry);
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("load", bind);
      for (const id of [TRAFFIC_LAYER, "planes"]) {
        map.off("click", id, onLayerClick);
        map.off("mouseenter", id, onLayerEnter);
        map.off("mouseleave", id, onLayerLeave);
      }
      boundLayersRef.current = new Set();
      map.getCanvas().style.cursor = "";
    };
  }, [interactive, mapStyle, viewportTraffic]);

  useEffect(() => {
    setUserOverride(userOverrideRef.current);
    setLocateError(null);
  }, [focusedFlightId]);

  const pauseFollowForUser = () => {
    pendingJumpRef.current = false;
    userOverrideRef.current = true;
    setUserOverride(true);
  };

  const resumePlaneFollow = () => {
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
    if (followCamera) {
      pendingJumpRef.current = false;
      userOverrideRef.current = false;
      setUserOverride(false);
    } else {
      pendingJumpRef.current = false;
      userOverrideRef.current = true;
      setUserOverride(true);
    }
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
        const key = persistCameraKeyRef.current;
        if (key) {
          writeSavedMapCamera(key, {
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
            zoom,
          });
        }
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
      {trafficFlags.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
          {trafficFlags.map((flag) => (
            <div
              key={flag.ac.icao24}
              className={cn("absolute", interactive && "pointer-events-auto")}
              style={{
                left: flag.x,
                top: flag.y,
                transform: "translate(1.15rem, -50%)",
              }}
            >
              <TrafficFlag
                aircraft={flag.ac}
                locale={locale}
                selected={flag.ac.icao24 === selectedTrafficId}
                onSelect={(ac) => {
                  pendingJumpRef.current = false;
                  userOverrideRef.current = true;
                  setUserOverride(true);
                  onSelectTrafficRef.current?.(ac);
                }}
              />
            </div>
          ))}
        </div>
      )}
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
          {showFollowResume && userOverride && canResumeFollow && (
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
