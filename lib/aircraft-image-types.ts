export type AircraftPhotoSource = "aerodatabox" | "planespotters";

export type AircraftPhoto = {
  url: string;
  photographer?: string;
  source: AircraftPhotoSource;
  sourceUrl?: string;
  license?: string;
};
