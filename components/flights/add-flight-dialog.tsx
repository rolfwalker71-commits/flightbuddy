"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Bookmark, Loader2, Plus, Repeat, Search } from "lucide-react";
import { useChrome } from "@/components/chrome/chrome-provider";
import { fabClass } from "@/lib/platform";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, tileClassName } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "./status-badge";
import { FlightStatus } from "@prisma/client";
import { cn, displayFlightNumber, parseFlightQuery } from "@/lib/utils";
import type { FlightSearchEmptyReason, FlightSearchResult } from "@/lib/flights";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { formatClock, formatStand } from "@/lib/i18n/format";
import { airportTimeZone } from "@/lib/airport-tz";
import type { MessageKey } from "@/lib/i18n/messages";
import { AirlineLogo } from "./airline-logo";
import { DateField } from "./date-field";

type Draft = {
  flightNumber: string;
  fromIata: string;
  toIata: string;
  depTime: string;
  arrTime: string;
};

const emptyDraft: Draft = {
  flightNumber: "",
  fromIata: "",
  toIata: "",
  depTime: "",
  arrTime: "",
};

function combineLocalDateTime(isoDate: string, hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

function emptyMessageKey(reason?: FlightSearchEmptyReason): MessageKey {
  switch (reason) {
    case "unknown_query":
      return "flight.unknownQuery";
    case "unconfigured":
      return "flight.noApi";
    case "rate_limited":
      return "flight.rateLimited";
    case "api_error":
      return "flight.apiError";
    default:
      return "flight.noResults";
  }
}

export function AddFlightDialog({ triggerLabel, fab }: { triggerLabel?: string; fab?: boolean }) {
  const t = useT();
  const { chrome } = useChrome();
  const { units, locale } = usePrefs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("LH441");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [results, setResults] = useState<FlightSearchResult[]>([]);
  const [emptyReason, setEmptyReason] = useState<FlightSearchEmptyReason | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [trackDaily, setTrackDaily] = useState(false);

  function primeDraft(nextQuery: string, local?: FlightSearchResult) {
    const parsed = parseFlightQuery(nextQuery);
    setDraft({
      flightNumber:
        local?.flightNumber || (parsed.kind === "flight" ? parsed.flightNumber : ""),
      fromIata: local?.fromIata || (parsed.kind === "route" ? parsed.from : ""),
      toIata: local?.toIata || (parsed.kind === "route" ? parsed.to : ""),
      depTime: "",
      arrTime: "",
    });
  }

  async function search() {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch("/api/flights/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, date }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t("flight.searchFailed"));
      const next: FlightSearchResult[] = json.results ?? [];
      setResults(next);
      setEmptyReason(next.length ? null : (json.emptyReason ?? "not_found"));
      const local = next.find((item) => item.source === "local");
      primeDraft(query, local);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("flight.searchFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function save(result: FlightSearchResult) {
    const key = `${result.flightNumber}-${result.scheduledDep ?? "manual"}`;
    setSaving(key);
    try {
      const res = await fetch("/api/flights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result, trackDaily }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? t("flight.saveFailed"));
      setOpen(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("flight.saveFailed"));
    } finally {
      setSaving(null);
    }
  }

  function saveDraft(base?: FlightSearchResult) {
    const flightNumber = draft.flightNumber.replace(/\s+/g, "").toUpperCase();
    if (!flightNumber || !draft.depTime) {
      setError(t("flight.needDetails"));
      return;
    }
    const parsedNumber = parseFlightQuery(flightNumber);
    void save({
      flightNumber,
      airlineName: base?.airlineName,
      airlineIata: base?.airlineIata ?? (parsedNumber.kind === "flight" ? parsedNumber.airline : null),
      airlineIcao: base?.airlineIcao,
      fromIata: (draft.fromIata || base?.fromIata || "").toUpperCase() || null,
      toIata: (draft.toIata || base?.toIata || "").toUpperCase() || null,
      fromCity: base?.fromCity,
      toCity: base?.toCity,
      scheduledDep: combineLocalDateTime(date, draft.depTime),
      scheduledArr: draft.arrTime ? combineLocalDateTime(date, draft.arrTime) : null,
      status: FlightStatus.UNKNOWN,
      source: "local",
      timesEstimated: true,
    });
  }

  const official = results.filter((item) => item.source === "aerodatabox");
  const local = results.filter((item) => item.source === "local");
  const showManual = searched && !loading && official.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className={cn(fab && fabClass(chrome), fab && "!h-auto !w-auto bg-primary text-primary-foreground")}
          aria-label={triggerLabel ?? t("flight.add")}
        >
          {fab ? <Plus className={chrome === "android" ? "size-7" : "size-5"} /> : (triggerLabel ?? t("flight.add"))}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t("flight.addTitle")}</DialogTitle>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="flight-query">{t("flight.query")}</Label>
            <Input
              id="flight-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("flight.queryPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("flight.queryHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="flight-date">{t("flight.date")}</Label>
            <DateField
              id="flight-date"
              value={date}
              onChange={setDate}
              units={units}
              locale={locale}
              openLabel={t("flight.openDatePicker")}
            />
          </div>
          <div className={cn(tileClassName, "flex items-start justify-between gap-3 p-3")}>
            <div className="min-w-0">
              <Label htmlFor="flight-daily" className="flex items-center gap-2 text-foreground">
                <Repeat className="size-4" />
                {t("flight.trackDaily")}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">{t("flight.trackDailyHint")}</p>
            </div>
            <Switch id="flight-daily" checked={trackDaily} onCheckedChange={setTrackDaily} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            {t("flight.find")}
          </Button>
        </form>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {official.length > 0 && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground">{t("flight.results")}</p>
            {official.map((result) => (
              <Card key={`${result.flightNumber}-${result.scheduledDep}`} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <AirlineLogo iata={result.airlineIata} name={result.airlineName} />
                    <div className="min-w-0">
                      <p className="font-medium">{displayFlightNumber(result.flightNumber)}</p>
                      <p className="break-words text-sm text-muted-foreground">{result.airlineName}</p>
                      {(result.aircraftType || result.registration) && (
                        <p className="text-xs text-muted-foreground">
                          {[result.aircraftType, result.registration].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={result.status} />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-semibold">{result.fromIata ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {result.scheduledDep
                        ? formatClock(
                            result.scheduledDep,
                            units,
                            airportTimeZone(result.fromIata, result.fromTimezone),
                          )
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{result.fromCity}</p>
                    {formatStand(locale, result.gate, result.terminal) && (
                      <p className="text-xs text-muted-foreground">
                        {formatStand(locale, result.gate, result.terminal)}
                      </p>
                    )}
                  </div>
                  <div className="h-px w-16 bg-border" />
                  <div className="text-right">
                    <p className="text-2xl font-semibold">{result.toIata ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {result.scheduledArr
                        ? formatClock(
                            result.scheduledArr,
                            units,
                            airportTimeZone(result.toIata, result.toTimezone),
                          )
                        : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">{result.toCity}</p>
                    {formatStand(locale, result.arrivalGate, result.arrivalTerminal) && (
                      <p className="text-xs text-muted-foreground">
                        {formatStand(locale, result.arrivalGate, result.arrivalTerminal)}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => void save(result)}
                  disabled={saving === `${result.flightNumber}-${result.scheduledDep}`}
                >
                  <Bookmark />
                  {t("flight.save")}
                </Button>
              </Card>
            ))}
          </div>
        )}

        {showManual && (
          <div className="mt-6 space-y-3">
            {official.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t(emptyMessageKey(emptyReason ?? undefined), { query })}
              </p>
            )}
            {local.map((result) => (
              <Card key={`${result.fromIata}-${result.toIata}-local`} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-2xl font-semibold">
                      {result.fromIata} – {result.toIata}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[result.fromCity, result.toCity].filter(Boolean).join(" → ")}
                    </p>
                    {result.airlineName && (
                      <p className="text-xs text-muted-foreground">{result.airlineName}</p>
                    )}
                  </div>
                  <Badge>{t("flight.estimate")}</Badge>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{t("flight.routeHint")}</p>
              </Card>
            ))}
            <Card className="p-4">
              <p className="text-sm font-medium">{t("flight.manual")}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="manual-number">{t("flight.flightNumber")}</Label>
                  <Input
                    id="manual-number"
                    value={draft.flightNumber}
                    onChange={(e) => setDraft((d) => ({ ...d, flightNumber: e.target.value }))}
                    placeholder={t("flight.queryPlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-from">{t("flight.from")}</Label>
                  <Input
                    id="manual-from"
                    value={draft.fromIata}
                    onChange={(e) => setDraft((d) => ({ ...d, fromIata: e.target.value.toUpperCase() }))}
                    placeholder="FRA"
                    maxLength={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-to">{t("flight.to")}</Label>
                  <Input
                    id="manual-to"
                    value={draft.toIata}
                    onChange={(e) => setDraft((d) => ({ ...d, toIata: e.target.value.toUpperCase() }))}
                    placeholder="JFK"
                    maxLength={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-dep">{t("flight.depTime")}</Label>
                  <Input
                    id="manual-dep"
                    type="time"
                    data-empty={draft.depTime ? "false" : "true"}
                    value={draft.depTime}
                    onChange={(e) => setDraft((d) => ({ ...d, depTime: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-arr">{t("flight.arrTime")}</Label>
                  <Input
                    id="manual-arr"
                    type="time"
                    data-empty={draft.arrTime ? "false" : "true"}
                    value={draft.arrTime}
                    onChange={(e) => setDraft((d) => ({ ...d, arrTime: e.target.value }))}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => saveDraft(local[0])}
                disabled={saving != null}
              >
                <Bookmark />
                {t("flight.save")}
              </Button>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
