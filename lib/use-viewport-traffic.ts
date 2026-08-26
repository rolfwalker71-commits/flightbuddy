"use client";

import { useEffect, useRef, useState } from "react";
import {
  isValidViewportBounds,
  isViewportTooLarge,
  viewportQuery,
  type ViewportBounds,
  type ViewportTrafficAircraft,
  type ViewportTrafficResponse,
} from "./viewport-traffic";

export type ViewportTrafficStatus =
  | "off"
  | "idle"
  | "live"
  | "zoom"
  | "exhausted"
  | "throttled"
  | "error";

export type ViewportTrafficState = {
  aircraft: ViewportTrafficAircraft[];
  remaining: number | null;
  intervalMs: number | null;
  status: ViewportTrafficStatus;
  count: number;
};

const EMPTY: ViewportTrafficState = {
  aircraft: [],
  remaining: null,
  intervalMs: null,
  status: "off",
  count: 0,
};

type TrafficBucket = {
  state: ViewportTrafficState;
  cooldownUntil: number;
  intervalMs: number;
};

const buckets = new Map<string, TrafficBucket>();

function tabHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function useViewportTraffic(
  enabled: boolean,
  bounds: ViewportBounds | null,
  cacheKey?: string,
) {
  const [state, setState] = useState<ViewportTrafficState>(
    () => (cacheKey ? buckets.get(cacheKey)?.state : undefined) ?? EMPTY,
  );
  const boundsRef = useRef(bounds);
  const intervalRef = useRef(90_000);
  const cooldownUntilRef = useRef(0);
  const tickRef = useRef<() => void>(() => {});
  const abortInflightRef = useRef<() => void>(() => {});
  boundsRef.current = bounds;

  useEffect(() => {
    if (!cacheKey || !enabled || state.status === "off") return;
    buckets.set(cacheKey, {
      state,
      cooldownUntil: cooldownUntilRef.current,
      intervalMs: intervalRef.current,
    });
  }, [cacheKey, enabled, state]);

  useEffect(() => {
    if (!enabled) {
      cooldownUntilRef.current = 0;
      setState(EMPTY);
      return;
    }

    const cached = cacheKey ? buckets.get(cacheKey) : undefined;
    if (cached) {
      intervalRef.current = cached.intervalMs;
      cooldownUntilRef.current = cached.cooldownUntil;
      setState(cached.state);
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;
    let exhausted = cached?.state.status === "exhausted";

    const clearTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (ms: number) => {
      clearTimer();
      if (cancelled || exhausted || tabHidden()) return;
      timer = setTimeout(() => {
        void tick();
      }, Math.max(250, ms));
    };

    const applyCooldown = (ms: number) => {
      const wait = Math.max(250, ms);
      cooldownUntilRef.current = Date.now() + wait;
      schedule(wait);
    };

    const tick = async () => {
      if (cancelled || exhausted || tabHidden()) return;
      const box = boundsRef.current;
      if (!box || !isValidViewportBounds(box)) {
        setState((prev) => ({ ...prev, status: prev.aircraft.length ? prev.status : "idle" }));
        schedule(1_000);
        return;
      }
      if (isViewportTooLarge(box)) {
        setState((prev) => ({ ...prev, status: "zoom" }));
        schedule(1_500);
        return;
      }

      const remainingCooldown = cooldownUntilRef.current - Date.now();
      if (remainingCooldown > 0) {
        schedule(remainingCooldown);
        return;
      }

      if (inflight) {
        schedule(250);
        return;
      }
      const ac = new AbortController();
      inflight = ac;
      try {
        const res = await fetch(`/api/traffic?${viewportQuery(box)}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) return;

        if (res.status === 429) {
          let remaining: number | null = null;
          let retryAfterMs = intervalRef.current;
          try {
            const body = (await res.json()) as ViewportTrafficResponse;
            remaining = body.remaining ?? null;
            if (body.intervalMs > 0) intervalRef.current = body.intervalMs;
            if (body.retryAfterMs > 0) retryAfterMs = body.retryAfterMs;
          } catch {
            remaining = null;
          }
          if (remaining === 0) {
            exhausted = true;
            setState((prev) => ({
              ...prev,
              remaining: 0,
              status: "exhausted",
            }));
            return;
          }
          setState((prev) => ({
            ...prev,
            remaining: remaining ?? prev.remaining,
            status: "throttled",
          }));
          applyCooldown(retryAfterMs);
          return;
        }

        if (res.status === 400) {
          setState((prev) => ({ ...prev, status: "zoom" }));
          applyCooldown(2_000);
          return;
        }

        if (res.status === 401) {
          setState((prev) => ({ ...prev, status: prev.aircraft.length ? prev.status : "error" }));
          return;
        }

        if (!res.ok) {
          setState((prev) => ({ ...prev, status: prev.aircraft.length ? "live" : "error" }));
          applyCooldown(intervalRef.current);
          return;
        }

        const data = (await res.json()) as ViewportTrafficResponse;
        if (cancelled || ac.signal.aborted) return;
        if (data.intervalMs > 0) intervalRef.current = data.intervalMs;

        if (data.exhausted || data.remaining === 0) {
          exhausted = true;
          setState((prev) => ({
            aircraft: prev.aircraft,
            remaining: data.remaining ?? 0,
            intervalMs: data.intervalMs,
            status: "exhausted",
            count: prev.aircraft.length,
          }));
          return;
        }

        setState((prev) => {
          const aircraft = data.fetched ? data.aircraft : prev.aircraft;
          const remaining = data.remaining ?? prev.remaining;
          const live = data.fetched || aircraft.length > 0;
          return {
            aircraft,
            remaining,
            intervalMs: data.intervalMs,
            status: live ? "live" : "idle",
            count: data.fetched ? data.aircraft.length : prev.count,
          };
        });

        const wait = data.retryAfterMs > 0 ? data.retryAfterMs : data.intervalMs;
        applyCooldown(wait);
      } catch {
        if (cancelled || ac.signal.aborted) return;
        applyCooldown(8_000);
      } finally {
        if (inflight === ac) inflight = null;
      }
    };

    abortInflightRef.current = () => {
      if (!inflight) return;
      inflight.abort();
      inflight = null;
    };

    tickRef.current = () => {
      void tick();
    };

    const onVis = () => {
      if (tabHidden()) {
        clearTimer();
        inflight?.abort();
        inflight = null;
      } else if (!exhausted) {
        void tick();
      }
    };

    setState((prev) => ({
      ...prev,
      status: prev.aircraft.length ? "live" : "idle",
    }));
    void tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      tickRef.current = () => {};
      abortInflightRef.current = () => {};
      clearTimer();
      inflight?.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, cacheKey]);

  useEffect(() => {
    if (!enabled || !bounds) return;
    const handle = setTimeout(() => {
      abortInflightRef.current();
      tickRef.current();
    }, 400);
    return () => clearTimeout(handle);
  }, [enabled, bounds]);

  return state;
}
