"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n/prefs-provider";
import type { AircraftPhoto } from "@/lib/aircraft-image-types";

export function AircraftPhotoCard({
  flightId,
  registration,
}: {
  flightId: string;
  registration?: string | null;
}) {
  const t = useT();
  const [photo, setPhoto] = useState<AircraftPhoto | null>(null);
  const [failed, setFailed] = useState(false);
  const tail = registration?.trim() ?? "";

  useEffect(() => {
    if (!tail) return;
    let cancelled = false;
    fetch(`/api/flights/${flightId}/aircraft-photo`)
      .then(async (res) => {
        if (res.status === 204 || !res.ok) return null;
        return (await res.json()) as AircraftPhoto;
      })
      .then((next) => {
        if (!cancelled) setPhoto(next);
      })
      .catch(() => {
        if (!cancelled) setPhoto(null);
      });
    return () => {
      cancelled = true;
    };
  }, [flightId, tail]);

  if (!tail || !photo || failed) return null;

  return (
    // External photo CDN; hide if the URL 404s.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt={t("aircraft.photoAlt", { reg: tail })}
      title={photo.photographer || undefined}
      width={144}
      height={96}
      loading="lazy"
      decoding="async"
      className="h-24 w-full max-w-36 rounded-xl object-cover object-center"
      onError={() => setFailed(true)}
    />
  );
}
