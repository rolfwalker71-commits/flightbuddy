"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cardClassName } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatIsoDateInput, parseIsoDateInput } from "@/lib/i18n/format";
import type { Locale, Units } from "@/lib/i18n/messages";
import { useT } from "@/components/i18n/prefs-provider";

function datePlaceholder(units: Units, locale: Locale) {
  if (units === "imperial") return "mm/dd/yyyy";
  return locale === "de" ? "tt.mm.jjjj" : "dd.mm.yyyy";
}

function parseYmd(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

function toYmd(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekdayLabels(locale: Locale) {
  const fmt = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", { weekday: "short" });
  // 2026-08-24 is a Monday — week always starts Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 7, 24 + i)));
}

function monthTitle(year: number, month: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1));
}

/** Monday-first month grid, including muted leading/trailing days. */
export function mondayFirstCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      iso: toYmd(date.getFullYear(), date.getMonth(), date.getDate()),
      inMonth: date.getMonth() === month,
    };
  });
}

function MondayCalendar({
  value,
  onChange,
  locale,
}: {
  value: string;
  onChange: (iso: string) => void;
  locale: Locale;
}) {
  const t = useT();
  const selected = parseYmd(value);
  const today = new Date();
  const todayIso = toYmd(today.getFullYear(), today.getMonth(), today.getDate());
  const [cursor, setCursor] = useState(() => ({
    year: selected?.year ?? today.getFullYear(),
    month: selected?.month ?? today.getMonth(),
  }));

  useEffect(() => {
    if (!selected) return;
    setCursor({ year: selected.year, month: selected.month });
  }, [value, selected?.year, selected?.month]);

  const cells = useMemo(() => mondayFirstCells(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const labels = useMemo(() => weekdayLabels(locale), [locale]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const next = new Date(c.year, c.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <div className={cn(cardClassName, "p-3")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => shiftMonth(-1)}
          aria-label={t("cal.prevMonth")}
        >
          <ChevronLeft className="size-4" />
        </button>
        <p className="text-sm font-medium capitalize">{monthTitle(cursor.year, cursor.month, locale)}</p>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => shiftMonth(1)}
          aria-label={t("cal.nextMonth")}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {labels.map((label) => (
          <div key={label} className="py-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
        ))}
        {cells.map((cell) => {
          const isSelected = cell.iso === value;
          const isToday = cell.iso === todayIso;
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onChange(cell.iso)}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-full text-sm",
                !cell.inMonth && "text-muted-foreground/60",
                isSelected && "bg-primary text-primary-foreground",
                !isSelected && isToday && "ring-1 ring-primary",
                !isSelected && "hover:bg-muted",
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateField({
  id,
  value,
  onChange,
  units,
  locale,
  openLabel,
}: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  units: Units;
  locale: Locale;
  openLabel: string;
}) {
  const [text, setText] = useState(() => formatIsoDateInput(value, units));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(formatIsoDateInput(value, units));
  }, [value, units]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function applyText(raw: string) {
    const iso = parseIsoDateInput(raw, units);
    if (iso) onChange(iso);
    else setText(formatIsoDateInput(value, units));
  }

  return (
    <div ref={rootRef} className="space-y-2">
      <div className="relative">
        <button
          type="button"
          className="absolute left-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-muted-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-label={openLabel}
          aria-expanded={open}
          aria-controls={`${id}-calendar`}
        >
          <CalendarDays className="size-4" />
        </button>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={datePlaceholder(units, locale)}
          className="pl-12"
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const iso = parseIsoDateInput(next, units);
            if (iso) onChange(iso);
          }}
          onBlur={() => applyText(text)}
        />
      </div>
      {open && (
        <div id={`${id}-calendar`}>
          <MondayCalendar
            value={value}
            locale={locale}
            onChange={(iso) => {
              onChange(iso);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
