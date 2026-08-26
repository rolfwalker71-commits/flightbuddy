"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TrackedAircraftView } from "./tracked-aircraft";

export function useTrackedAircraft(initial: TrackedAircraftView[] = []) {
  const [items, setItems] = useState(initial);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tracked-aircraft", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { items?: TrackedAircraftView[] };
    if (json.items) setItems(json.items);
  }, []);

  const save = useCallback(
    async (input: {
      icao24: string;
      callsign?: string | null;
      operator?: string | null;
      airlineIata?: string | null;
    }) => {
      const res = await fetch("/api/tracked-aircraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("save");
      const json = (await res.json()) as { item?: TrackedAircraftView };
      if (json.item) {
        setItems((prev) => [json.item!, ...prev.filter((row) => row.icao24 !== json.item!.icao24)]);
      } else {
        await refresh();
      }
    },
    [refresh],
  );

  const untrack = useCallback(async (id: string) => {
    const previous = items;
    setItems((prev) => prev.filter((row) => row.id !== id));
    const res = await fetch(`/api/tracked-aircraft/${id}`, { method: "DELETE", cache: "no-store" });
    if (!res.ok) {
      setItems(previous);
      throw new Error("untrack");
    }
  }, [items]);

  const byIcao = useMemo(() => new Map(items.map((row) => [row.icao24.toLowerCase(), row])), [items]);

  return { items, byIcao, save, untrack, refresh };
}
