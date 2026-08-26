import { Plane } from "lucide-react";
import { PLANE_FILL, PLANE_HALO } from "@/lib/map-styles";
import { cn } from "@/lib/utils";

/** Lucide `Plane` nose points northeast; subtract from a geographic heading (0=N, 90=E). */
export const LUCIDE_PLANE_NOSE_DEG = 45;

export function lucidePlaneRotateDeg(headingDeg: number) {
  return headingDeg - LUCIDE_PLANE_NOSE_DEG;
}

/** Airplane sitting on a left-to-right progress line (course 90° / east). */
export function RoutePlane({
  progress,
  className,
}: {
  progress: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
        className,
      )}
      style={{ left: `${pct}%` }}
    >
      <Plane
        className="size-4"
        fill={PLANE_FILL}
        color={PLANE_HALO}
        strokeWidth={4}
        style={{
          transform: `rotate(${lucidePlaneRotateDeg(90)}deg)`,
          paintOrder: "stroke fill",
        }}
      />
    </span>
  );
}
