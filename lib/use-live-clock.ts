"use client";

import { useEffect, useState } from "react";

/**
 * Re-render on a short interval so time-based interpolation can advance
 * between server polls. Hidden tabs pause.
 */
export function useLiveClock(active: boolean, intervalMs = 2_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
    };
    tick();
    const id = window.setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState !== "hidden") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, intervalMs]);

  return now;
}
