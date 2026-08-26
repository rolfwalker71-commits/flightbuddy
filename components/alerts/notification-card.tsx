import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { alertCardModel, eventBadgeVariant, type AlertFlight } from "@/lib/alert-copy";
import { formatRelative } from "@/lib/i18n/format";
import { t, type Locale, type Units } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

export function NotificationCard({
  title,
  body,
  kind,
  createdAt,
  locale,
  units,
  flight,
}: {
  title: string;
  body: string;
  kind: string;
  createdAt: Date;
  locale: Locale;
  units: Units;
  flight?: AlertFlight | null;
}) {
  const relative = formatRelative(createdAt, locale);
  const model = flight ? alertCardModel(flight, kind, locale, units) : null;

  return (
    <Card className="relative overflow-hidden p-4 transition-colors hover:bg-muted">
      {flight && (
        <Link
          href={`/flights/${flight.id}`}
          className="absolute inset-0 z-0 rounded-2xl"
          aria-label={model?.code ?? title}
        />
      )}
      <div className="relative z-10">
        {model ? (
          <EnrichedAlert model={model} relative={relative} locale={locale} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words font-medium">{title}</p>
              {(kind === "object_airborne" || kind === "object_landed") && (
                <Badge variant={eventBadgeVariant(kind)} className="shrink-0">
                  {kind === "object_airborne"
                    ? t(locale, "alerts.eventObjectAirborne")
                    : t(locale, "alerts.eventObjectLanded")}
                </Badge>
              )}
            </div>
            {body && <p className="text-sm text-muted-foreground">{body}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{relative}</p>
          </>
        )}
      </div>
    </Card>
  );
}

function EnrichedAlert({
  model,
  relative,
  locale,
}: {
  model: ReturnType<typeof alertCardModel>;
  relative: string;
  locale: Locale;
}) {
  const hasRoute = model.fromIata || model.toIata;
  const hasCities = model.fromCity || model.toCity;

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-lg font-semibold tracking-tight">{model.code}</p>
        <Badge variant={eventBadgeVariant(model.eventKind)} className="shrink-0">
          {model.event}
        </Badge>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {hasRoute && (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-2xl font-semibold tracking-tight">{model.fromIata ?? "—"}</span>
              <span className="text-lg font-medium text-primary" aria-hidden>
                →
              </span>
              <span className="text-2xl font-semibold tracking-tight">{model.toIata ?? "—"}</span>
            </p>
          )}
          {hasCities && (
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              <span>{model.fromCity}</span>
              {model.fromCity && model.toCity && (
                <span className="text-muted-foreground" aria-hidden>
                  →
                </span>
              )}
              <span>{model.toCity}</span>
            </p>
          )}
        </div>

        <div className="shrink-0 space-y-1 text-right text-sm">
          {model.plannedClock && model.planned && (
            <p>
              <span className="text-muted-foreground">{t(locale, "alerts.planned")} </span>
              <time dateTime={model.planned.toISOString()} className="text-foreground">
                {model.plannedClock}
              </time>
              {model.plannedZone && (
                <span className="ml-1 text-[0.7rem] text-muted-foreground">{model.plannedZone}</span>
              )}
            </p>
          )}
          {model.showEffective && model.effectiveClock && model.effective && (
            <p>
              <span className="text-muted-foreground">{t(locale, "alerts.effective")} </span>
              <time
                dateTime={model.effective.toISOString()}
                className={cn("font-medium", model.delayed ? "text-destructive" : "text-foreground")}
              >
                {model.effectiveClock}
              </time>
            </p>
          )}
          {model.stand && <p className="text-muted-foreground">{model.stand}</p>}
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{relative}</p>
    </>
  );
}
