"use client";

import { useState } from "react";
import { airlineInitials, airlineLogoUrl } from "@/lib/airline-logo";
import { cn } from "@/lib/utils";

const SIZE = {
  sm: { box: "size-8", fallback: "text-xs", px: 32 },
  md: { box: "size-12", fallback: "text-sm", px: 48 },
  lg: { box: "size-24", fallback: "text-lg", px: 96 },
} as const;

export function AirlineLogo({
  iata,
  name,
  size = "sm",
  className,
}: {
  iata?: string | null;
  name?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = airlineLogoUrl(iata);
  const fallback = airlineInitials(iata, name);
  const label = name?.trim() || iata?.trim() || fallback;
  const dim = SIZE[size];

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center font-medium text-muted-foreground",
          dim.box,
          dim.fallback,
          className,
        )}
        aria-hidden
      >
        {fallback}
      </div>
    );
  }

  return (
    // External CDN; hide on error. Decorative next to the airline name.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      width={dim.px}
      height={dim.px}
      className={cn("shrink-0 bg-transparent object-contain", dim.box, className)}
      onError={() => setFailed(true)}
    />
  );
}
