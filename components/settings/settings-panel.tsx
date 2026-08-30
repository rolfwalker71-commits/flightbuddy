"use client";

import { useEffect, useState } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { FlightMap } from "@/components/map/flight-map";
import { initials } from "@/lib/utils";
import type { NotificationPreference } from "@prisma/client";
import { usePrefs, useT, useUpdatePrefs } from "@/components/i18n/prefs-provider";
import type { Prefs } from "@/lib/i18n/messages";
import { MAP_STYLE_IDS, MAP_STYLES } from "@/lib/map-styles";
import { ChromeSwitcher } from "@/components/chrome/chrome-switcher";
import { TrackedObjectsList } from "@/components/map/tracked-objects-list";
import { useTrackedAircraft } from "@/lib/use-tracked-aircraft";
import type { TrackedAircraftView } from "@/lib/tracked-aircraft";

type PrefKey = "webPush" | "gateChanges" | "delaysStatus" | "preflight2h" | "objectAlerts";

type ProviderUsage = {
  configured: boolean;
  enabled?: boolean;
  preferenceEnabled?: boolean;
  envEnabled?: boolean;
  healthy: boolean;
  usedToday: number;
  remaining: number | null;
  limit: number | null;
  dailyRemaining: number | null;
  dailyLimit: number | null;
};

export function SettingsPanel({
  name,
  email,
  role,
  prefs,
  vapidPublicKey,
  openSkyHealthy,
  apiUsage,
  canSeed,
  tracked = [],
}: {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  prefs: NotificationPreference;
  vapidPublicKey?: string;
  openSkyHealthy: boolean;
  apiUsage?: {
    aerodatabox: ProviderUsage;
    opensky: ProviderUsage;
    fr24?: ProviderUsage;
  };
  canSeed: boolean;
  tracked?: TrackedAircraftView[];
}) {
  const t = useT();
  const appearance = usePrefs();
  const updatePrefs = useUpdatePrefs();
  const [local, setLocal] = useState(prefs);
  const objects = useTrackedAircraft(tracked);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [fr24On, setFr24On] = useState(apiUsage?.fr24?.preferenceEnabled !== false);
  const [publicKey, setPublicKey] = useState(vapidPublicKey);
  const { locale, units, theme, mapStyle } = appearance;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const key = publicKey || (await fetchVapidPublicKey());
      if (cancelled || !key) return;
      setPublicKey(key);
      if (local.webPush) await subscribePush(key);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveAppearance(next: Partial<Prefs>) {
    updatePrefs(next);
    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  async function updatePref(key: PrefKey, value: boolean) {
    setLocal((p) => ({ ...p, [key]: value }));
    await fetch("/api/notifications/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (key === "webPush" && value) {
      const keyValue = publicKey || (await fetchVapidPublicKey());
      if (keyValue) {
        setPublicKey(keyValue);
        await subscribePush(keyValue);
      }
    }
  }

  async function seed() {
    setSeedStatus(t("settings.importing"));
    const res = await fetch("/api/seed", { method: "POST" });
    const json = await res.json();
    setSeedStatus(res.ok ? JSON.stringify(json.imported ?? json.counts) : json.error);
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("settings.title")}</h1>

      <Card className="flex items-center gap-3 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium">
          {initials(name, email)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{name ?? t("settings.traveler")}</p>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>

      <div>
        <p className="mb-2 px-1 text-sm text-muted-foreground">{t("settings.notifications")}</p>
        <div className="space-y-2">
          <Card>
            <PrefRow label={t("settings.webPush")} checked={local.webPush} onChange={(v) => updatePref("webPush", v)} />
          </Card>
          <Card>
            <PrefRow label={t("settings.gateChanges")} checked={local.gateChanges} onChange={(v) => updatePref("gateChanges", v)} />
          </Card>
          <Card>
            <PrefRow label={t("settings.delaysStatus")} checked={local.delaysStatus} onChange={(v) => updatePref("delaysStatus", v)} />
          </Card>
          <Card>
            <PrefRow label={t("settings.preflight")} checked={local.preflight2h} onChange={(v) => updatePref("preflight2h", v)} />
          </Card>
          <Card>
            <PrefRow
              label={t("settings.objectAlerts")}
              checked={local.objectAlerts !== false}
              onChange={(v) => updatePref("objectAlerts", v)}
            />
          </Card>
        </div>
      </div>

      <div>
        <p className="mb-2 px-1 text-sm text-muted-foreground">{t("map.objects")}</p>
        <Card className="p-4">
          <TrackedObjectsList items={objects.items} onUntrack={objects.untrack} />
          <p className="mt-2 text-xs leading-snug text-muted-foreground">{t("map.objectHint")}</p>
        </Card>
      </div>

      <div>
        <p className="mb-2 px-1 text-sm text-muted-foreground">{t("settings.appearance")}</p>
        <Card className="space-y-4 p-4">
          <ChromeSwitcher />
          <div className="space-y-2">
            <p className="text-sm">{t("settings.theme")}</p>
            <Segmented
              value={theme}
              onChange={(value) => void saveAppearance({ theme: value })}
              options={[
                { id: "dark", label: t("settings.themeDark") },
                { id: "light", label: t("settings.themeLight") },
              ]}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm">{t("settings.language")}</p>
            <Segmented
              value={locale}
              onChange={(value) => void saveAppearance({ locale: value })}
              options={[
                { id: "de", label: t("settings.langDe") },
                { id: "en", label: t("settings.langEn") },
              ]}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm">{t("settings.units")}</p>
            <Segmented
              value={units}
              onChange={(value) => void saveAppearance({ units: value })}
              options={[
                { id: "metric", label: t("settings.unitsMetric") },
                { id: "imperial", label: t("settings.unitsImperial") },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              {units === "metric" ? t("settings.unitsMetricHint") : t("settings.unitsImperialHint")}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm">{t("settings.mapStyle")}</p>
            <div data-slot="segmented" className="flex flex-wrap gap-0.5 rounded-full bg-muted p-0.5">
              {MAP_STYLE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void saveAppearance({ mapStyle: id })}
                  data-slot="segmented-trigger"
                  data-active={mapStyle === id}
                  className={`min-h-10 rounded-full px-3 text-sm leading-none ${
                    mapStyle === id
                      ? "bg-secondary text-primary"
                      : "text-muted-foreground"
                  }`}
                >
                  {t(MAP_STYLES[id].labelKey)}
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-[var(--tile-radius)]">
              <FlightMap flights={[]} className="h-36 w-full" interactive={false} />
            </div>
          </div>
        </Card>
      </div>

      <div>
        <p className="mb-2 px-1 text-sm text-muted-foreground">{t("settings.data")}</p>
        <Card className="space-y-3 p-4">
          {canSeed && (
            <div>
              <Button variant="outline" className="w-full" onClick={() => void seed()}>
                {t("settings.importSeed")}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">{t("settings.importHint")}</p>
              {seedStatus && <p className="mt-2 text-xs text-muted-foreground">{seedStatus}</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("settings.logoNote")}</p>
          <div className="space-y-3">
            <p className="text-sm">{t("settings.apiStatus")}</p>
            <ProviderUsageRow
              name={t("settings.openskyName")}
              usage={apiUsage?.opensky}
              fallbackHealthy={openSkyHealthy}
              remainingKind="credits"
            />
            <ProviderUsageRow
              name={t("settings.aeroName")}
              usage={apiUsage?.aerodatabox}
              remainingKind="requests"
            />
            <div className="space-y-2">
              <ProviderUsageRow
                name={t("settings.fr24Name")}
                usage={apiUsage?.fr24}
                remainingKind="credits"
              />
              {apiUsage?.fr24?.configured && (
                <>
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <span className="text-sm leading-snug">{t("settings.fr24Enable")}</span>
                    <Switch
                      checked={fr24On}
                      disabled={apiUsage.fr24.envEnabled === false}
                      onCheckedChange={(value) => {
                        setFr24On(value);
                        void fetch("/api/settings/fr24", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ enabled: value }),
                        });
                      }}
                    />
                  </div>
                  <p className="text-xs leading-snug text-muted-foreground">{t("settings.fr24Hint")}</p>
                </>
              )}
            </div>
          </div>
          {role === "ADMIN" && (
            <p className="text-xs text-muted-foreground">{t("settings.admin")}</p>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-destructive"
          onClick={async () => {
            const { signOut } = await import("next-auth/react");
            await signOut({ callbackUrl: "/login" });
          }}
        >
          <span className="inline-flex items-center gap-2">
            <LogOut className="size-4" />
            {t("settings.signOut")}
          </span>
          <ChevronRight className="size-4" />
        </button>
      </Card>
    </div>
  );
}

function ProviderUsageRow({
  name,
  usage,
  fallbackHealthy,
  remainingKind,
}: {
  name: string;
  usage?: ProviderUsage;
  fallbackHealthy?: boolean;
  remainingKind: "credits" | "requests";
}) {
  const t = useT();
  const configured = usage?.configured ?? fallbackHealthy != null;
  const healthy = usage?.healthy ?? fallbackHealthy ?? false;
  const enabled = usage?.enabled ?? configured;
  const status = !configured
    ? t("settings.providerOff")
    : !enabled
      ? t("settings.providerPaused")
      : healthy
        ? t("settings.healthy")
        : t("settings.limited");
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="break-words leading-snug">{name}</span>
        <span className={configured && enabled && healthy ? "text-success" : "text-warning"}>{status}</span>
      </div>
      {configured && usage && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{t("settings.usedToday", { n: usage.usedToday })}</p>
          <RemainingLine usage={usage} remainingKind={remainingKind} />
        </div>
      )}
    </div>
  );
}

function RemainingLine({
  usage,
  remainingKind,
}: {
  usage: ProviderUsage;
  remainingKind: "credits" | "requests";
}) {
  const t = useT();
  const lines: string[] = [];
  if (usage.remaining != null && usage.limit != null) {
    lines.push(t("settings.remainingApiLimit", { n: usage.remaining, limit: usage.limit }));
  } else if (usage.remaining != null && remainingKind === "credits") {
    lines.push(t("settings.remainingCredits", { n: usage.remaining }));
  } else if (usage.remaining != null) {
    lines.push(t("settings.remainingApi", { n: usage.remaining }));
  }
  const dailyDistinct =
    usage.dailyRemaining != null && usage.dailyRemaining !== usage.remaining;
  if (dailyDistinct && usage.dailyLimit != null) {
    lines.push(t("settings.remainingDailyLimit", { n: usage.dailyRemaining!, limit: usage.dailyLimit }));
  } else if (dailyDistinct) {
    lines.push(t("settings.remainingDaily", { n: usage.dailyRemaining! }));
  }
  if (!lines.length) {
    lines.push(t("settings.noRemainingYet"));
  }
  return (
    <>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
}

function PrefRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between px-4 py-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

async function fetchVapidPublicKey() {
  const res = await fetch("/api/push/vapid");
  if (!res.ok) return undefined;
  const json = (await res.json()) as { publicKey?: string };
  return json.publicKey;
}

async function subscribePush(vapidPublicKey?: string) {
  if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
