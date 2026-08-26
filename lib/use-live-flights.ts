"use client";

import { useEffect, useRef, useState } from "react";
import { msUntilNextClientPoll, type ClientPollFlight } from "@/lib/flight-status";
import type { UserFlightView } from "@/lib/flight-view";

function tabHidden() {
  return document.visibilityState === "hidden";
}

function asPollFlight(flight: UserFlightView["flight"]): ClientPollFlight {
  return {
    status: flight.status,
    scheduledDep: flight.scheduledDep,
    actualDep: flight.actualDep,
    estimatedDep: flight.estimatedDep,
    scheduledArr: flight.scheduledArr,
    estimatedArr: flight.estimatedArr,
    lastLat: flight.lastLat,
    lastLon: flight.lastLon,
    lastPositionAt: flight.lastPositionAt,
    actualArr: flight.actualArr,
    nextPollAt: flight.nextPollAt,
    departureAirport: flight.departureAirport,
    arrivalAirport: flight.arrivalAirport,
  };
}

/**
 * Follow live flights on the same adaptive interval as the server.
 * Hidden tabs pause; timers and in-flight fetches clear on unmount.
 */
export function useLiveFlights(initial: UserFlightView[]) {
  const [flights, setFlights] = useState(initial);
  const flightsRef = useRef(flights);
  flightsRef.current = flights;

  useEffect(() => {
    let cancelled = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const inflight = new Map<string, AbortController>();

    const clearTimer = (id: string) => {
      const handle = timers.get(id);
      if (handle != null) {
        clearTimeout(handle);
        timers.delete(id);
      }
    };

    const clearAll = () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };

    const abortAll = () => {
      for (const ac of inflight.values()) ac.abort();
      inflight.clear();
    };

    const schedule = (row: UserFlightView, mode: "due" | "afterFetch") => {
      clearTimer(row.flight.id);
      const delay = msUntilNextClientPoll(asPollFlight(row.flight), new Date(), mode);
      if (delay == null) return;
      timers.set(
        row.flight.id,
        setTimeout(() => {
          void tick(row.flight.id);
        }, delay),
      );
    };

    const tick = async (id: string) => {
      if (cancelled || tabHidden()) return;
      inflight.get(id)?.abort();
      const ac = new AbortController();
      inflight.set(id, ac);
      try {
        const res = await fetch(`/api/flights/${id}/live`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) return;
        if (res.status === 401 || res.status === 404) return;
        if (!res.ok) {
          const row = flightsRef.current.find((f) => f.flight.id === id);
          if (row && !tabHidden()) schedule(row, "afterFetch");
          return;
        }
        const updated = (await res.json()) as UserFlightView;
        if (cancelled || ac.signal.aborted) return;
        setFlights((prev) =>
          prev.map((f) => {
            if (f.flight.id !== id) return f;
            return {
              ...updated,
              trackDaily: typeof updated.trackDaily === "boolean" ? updated.trackDaily : f.trackDaily,
            };
          }),
        );
        if (!tabHidden()) schedule(updated, "afterFetch");
      } catch {
        if (cancelled || ac.signal.aborted) return;
        const row = flightsRef.current.find((f) => f.flight.id === id);
        if (row && !tabHidden()) schedule(row, "afterFetch");
      } finally {
        if (inflight.get(id) === ac) inflight.delete(id);
      }
    };

    const armAll = (mode: "due" | "afterFetch") => {
      clearAll();
      if (tabHidden()) return;
      for (const row of flightsRef.current) schedule(row, mode);
    };

    const onVis = () => {
      if (tabHidden()) {
        clearAll();
        abortAll();
      } else {
        armAll("due");
      }
    };

    armAll("due");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearAll();
      abortAll();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return flights;
}
