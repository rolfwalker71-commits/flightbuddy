import type { MapStyleId, MessageKey } from "./i18n/messages";

/** Top-down plane: dark fill + white halo so it sits on the arc without blending in. */
export const PLANE_FILL = "#0f172a";
export const PLANE_HALO = "#ffffff";

export type MapStyle = {
  id: MapStyleId;
  labelKey: MessageKey;
  tiles: string[];
  tileSize: number;
  attribution: string;
  arc: string;
  plane: string;
  planeStroke: string;
};

export const MAP_STYLES: Record<MapStyleId, MapStyle> = {
  dark: {
    id: "dark",
    labelKey: "settings.mapDark",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    ],
    tileSize: 256,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    arc: "#3DDCFF",
    plane: PLANE_FILL,
    planeStroke: PLANE_HALO,
  },
  voyager: {
    id: "voyager",
    labelKey: "settings.mapVoyager",
    tiles: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    ],
    tileSize: 256,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    arc: "#0284c7",
    plane: PLANE_FILL,
    planeStroke: PLANE_HALO,
  },
  positron: {
    id: "positron",
    labelKey: "settings.mapPositron",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    ],
    tileSize: 256,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    arc: "#0369a1",
    plane: PLANE_FILL,
    planeStroke: PLANE_HALO,
  },
  osm: {
    id: "osm",
    labelKey: "settings.mapOsm",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: "&copy; OpenStreetMap contributors",
    arc: "#0369a1",
    plane: PLANE_FILL,
    planeStroke: PLANE_HALO,
  },
  satellite: {
    id: "satellite",
    labelKey: "settings.mapSatellite",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    attribution: "Tiles &copy; Esri",
    arc: "#3DDCFF",
    plane: PLANE_FILL,
    planeStroke: PLANE_HALO,
  },
  topo: {
    id: "topo",
    labelKey: "settings.mapTopo",
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: "&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap",
    arc: "#0f766e",
    plane: PLANE_FILL,
    planeStroke: PLANE_HALO,
  },
};

export const MAP_STYLE_IDS = Object.keys(MAP_STYLES) as MapStyleId[];

export function mapLibreStyle(id: MapStyleId) {
  const style = MAP_STYLES[id] ?? MAP_STYLES.dark;
  return {
    version: 8 as const,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: {
        type: "raster" as const,
        tiles: style.tiles,
        tileSize: style.tileSize,
        attribution: style.attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster" as const, source: "basemap" }],
  };
}
