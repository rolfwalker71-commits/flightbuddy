export type LatLon = { lat: number; lon: number };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineNm(a: LatLon, b: LatLon) {
  const R = 3440.065;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineMiles(a: LatLon, b: LatLon) {
  return haversineNm(a, b) * 1.15078;
}

export function initialBearing(a: LatLon, b: LatLon) {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function interpolateGreatCircle(a: LatLon, b: LatLon, steps = 64): [number, number][] {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lon);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lon);
  const Δ =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    );
  if (Δ === 0) return [[a.lon, a.lat], [b.lon, b.lat]];

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * Δ) / Math.sin(Δ);
    const B = Math.sin(f * Δ) / Math.sin(Δ);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
    const λ = Math.atan2(y, x);
    points.push([toDeg(λ), toDeg(φ)]);
  }
  return points;
}

export function pointAlongGreatCircle(a: LatLon, b: LatLon, fraction: number): LatLon {
  const f = Math.min(1, Math.max(0, fraction));
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lon);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lon);
  const Δ =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    );
  if (Δ === 0 || !Number.isFinite(Δ)) return a;
  const A = Math.sin((1 - f) * Δ) / Math.sin(Δ);
  const B = Math.sin(f * Δ) / Math.sin(Δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
  const λ = Math.atan2(y, x);
  return { lat: toDeg(φ), lon: toDeg(λ) };
}

/** Instantaneous course (0=N, 90=E) at `fraction` along the geodesic A→B. */
export function headingAlongGreatCircle(a: LatLon, b: LatLon, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  const here = pointAlongGreatCircle(a, b, f);
  const ahead = pointAlongGreatCircle(a, b, Math.min(1, f + 1 / 128));
  if (here.lat === ahead.lat && here.lon === ahead.lon) return initialBearing(a, b);
  return initialBearing(here, ahead);
}

/** Destination after travelling `distanceNm` along `headingDeg` (0=N). */
export function destinationPoint(start: LatLon, headingDeg: number, distanceNm: number): LatLon {
  if (!Number.isFinite(distanceNm) || distanceNm === 0) return start;
  const R = 3440.065;
  const δ = distanceNm / R;
  const θ = toRad(headingDeg);
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

export function boundingBox(points: LatLon[], pad = 4) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    lamin: Math.max(-90, Math.min(...lats) - pad),
    lamax: Math.min(90, Math.max(...lats) + pad),
    lomin: Math.max(-180, Math.min(...lons) - pad),
    lomax: Math.min(180, Math.max(...lons) + pad),
  };
}

export function flightProgress(opts: {
  origin?: LatLon | null;
  dest?: LatLon | null;
  current?: LatLon | null;
  scheduledDep?: Date | null;
  scheduledArr?: Date | null;
  estimatedDep?: Date | null;
  estimatedArr?: Date | null;
  actualDep?: Date | null;
  actualArr?: Date | null;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  if (opts.origin && opts.dest && opts.current) {
    const total = haversineNm(opts.origin, opts.dest);
    const remaining = haversineNm(opts.current, opts.dest);
    if (total > 0) return Math.min(0.98, Math.max(0.02, 1 - remaining / total));
  }
  const start = opts.actualDep ?? opts.estimatedDep ?? opts.scheduledDep;
  const end = opts.actualArr ?? opts.estimatedArr ?? opts.scheduledArr;
  if (!start || !end) return 0;
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 0;
  return Math.min(0.98, Math.max(0, (now.getTime() - start.getTime()) / span));
}
