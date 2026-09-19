"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { isAppleMobile } from "@/lib/platform";
import { usePrefs, useT } from "@/components/i18n/prefs-provider";
import { formatRelative } from "@/lib/i18n/format";

type TokenInfo = { hint: string; createdAt: string; lastUsedAt: string | null };

type WidgetOptions = {
  appearance: "auto" | "dark" | "light";
  showSeat: boolean;
  showTelemetry: boolean;
  nextFlights: number;
  includeDaily: boolean;
};

const SCRIPT_PATH = "/scriptable/FlightBuddy.js";
/** Scriptable's URL scheme; opens the saved script (or the app when it isn't there yet). */
const SCRIPTABLE_URL = "scriptable:///open/FlightBuddy";

function scriptWith(source: string, token: string) {
  // The phone reaches FlightBuddy at the same origin it uses right now.
  return source
    .replace("__FLIGHTBUDDY_URL__", window.location.origin)
    .replace("__FLIGHTBUDDY_TOKEN__", token);
}

export function WidgetSettings() {
  const t = useT();
  const { locale } = usePrefs();
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"script" | "token" | null>(null);
  const [error, setError] = useState(false);
  // Fetched up front: iOS Safari only allows clipboard writes synchronously inside the tap.
  const [source, setSource] = useState<string | null>(null);
  const [options, setOptions] = useState<WidgetOptions | null>(null);
  const [apple, setApple] = useState(false);

  useEffect(() => {
    setApple(isAppleMobile());
    void (async () => {
      const res = await fetch("/api/widget/options", { cache: "no-store" });
      if (res.ok) setOptions(((await res.json()) as { options: WidgetOptions }).options);
    })();
    void (async () => {
      const res = await fetch("/api/widget/token", { cache: "no-store" });
      if (res.ok) setInfo(((await res.json()) as { token: TokenInfo | null }).token);
      setLoaded(true);
    })();
    void (async () => {
      const res = await fetch(SCRIPT_PATH, { cache: "no-store" });
      if (res.ok) setSource(await res.text());
    })();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function create() {
    if (info && !window.confirm(t("widget.recreateConfirm"))) return;
    void run(async () => {
      const res = await fetch("/api/widget/token", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as TokenInfo & { token: string };
      setInfo({ hint: json.hint, createdAt: json.createdAt, lastUsedAt: json.lastUsedAt });
      setFresh(json.token);
    });
  }

  function revoke() {
    if (!window.confirm(t("widget.revokeConfirm"))) return;
    void run(async () => {
      const res = await fetch("/api/widget/token", { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setInfo(null);
      setFresh(null);
    });
  }

  function updateOption<K extends keyof WidgetOptions>(key: K, value: WidgetOptions[K]) {
    setOptions((prev) => (prev ? { ...prev, [key]: value } : prev));
    void run(async () => {
      const res = await fetch("/api/widget/options", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setOptions(((await res.json()) as { options: WidgetOptions }).options);
    });
  }

  function flashCopied(kind: "script" | "token") {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }

  function copyScript() {
    if (!fresh || !source) return;
    void run(async () => {
      await navigator.clipboard.writeText(scriptWith(source, fresh));
      flashCopied("script");
    });
  }

  function copyToken() {
    if (!fresh) return;
    void run(async () => {
      await navigator.clipboard.writeText(fresh);
      flashCopied("token");
    });
  }

  function download() {
    if (!fresh || !source) return;
    void run(async () => {
      const blob = new Blob([scriptWith(source, fresh)], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "FlightBuddy.js";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div>
      <p className="mb-2 px-1 text-sm text-muted-foreground">{t("widget.section")}</p>
      <Card className="space-y-4 p-4">
        <p className="text-sm leading-snug">{t("widget.intro")}</p>

        {loaded && (
          <div className="space-y-1 text-xs leading-snug text-muted-foreground">
            {info ? (
              <>
                <p className="flex items-center gap-1.5">
                  <KeyRound className="size-3.5 shrink-0" />
                  {t("widget.active", { hint: info.hint, created: formatRelative(info.createdAt, locale) })}
                </p>
                <p>
                  {info.lastUsedAt
                    ? t("widget.lastUsed", { when: formatRelative(info.lastUsedAt, locale) })
                    : t("widget.neverUsed")}
                </p>
              </>
            ) : (
              <p>{t("widget.none")}</p>
            )}
          </div>
        )}

        {fresh && (
          <div className="space-y-3 rounded-[calc(var(--tile-radius)*0.65)] bg-muted p-3">
            <p className="text-xs leading-snug">{t("widget.fresh")}</p>
            <code className="block break-all rounded-md bg-background px-2 py-1.5 font-mono text-xs">{fresh}</code>
            <div className="flex flex-wrap gap-2">
              <Button onClick={copyScript} disabled={busy || !source}>
                {copied === "script" ? <Check /> : <Copy />}
                {copied === "script" ? t("widget.copied") : t("widget.copyScript")}
              </Button>
              <Button variant="outline" onClick={download} disabled={busy || !source}>
                <Download />
                {t("widget.download")}
              </Button>
              <Button variant="ghost" onClick={copyToken} disabled={busy}>
                {copied === "token" ? <Check /> : <Copy />}
                {copied === "token" ? t("widget.copied") : t("widget.copyToken")}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant={info ? "outline" : "default"} onClick={create} disabled={busy || !loaded}>
            {info ? t("widget.recreate") : t("widget.create")}
          </Button>
          {info && (
            <Button variant="ghost" className="text-destructive" onClick={revoke} disabled={busy}>
              {t("widget.revoke")}
            </Button>
          )}
          {apple && (
            <Button variant="secondary" asChild>
              <a href={SCRIPTABLE_URL}>
                <ExternalLink />
                {t("widget.openScriptable")}
              </a>
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{t("widget.error")}</p>}

        {options && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{t("widget.options")}</p>
              <p className="text-xs leading-snug text-muted-foreground">{t("widget.scriptHint")}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm">{t("widget.appearance")}</p>
              <Segmented
                value={options.appearance}
                onChange={(value) => updateOption("appearance", value)}
                options={[
                  { id: "auto", label: t("widget.appearanceAuto") },
                  { id: "dark", label: t("widget.appearanceDark") },
                  { id: "light", label: t("widget.appearanceLight") },
                ]}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm">{t("widget.nextFlights")}</p>
              <Segmented
                value={String(options.nextFlights) as "0" | "1" | "2" | "3"}
                onChange={(value) => updateOption("nextFlights", Number(value))}
                options={[
                  { id: "0", label: t("widget.nextNone") },
                  { id: "1", label: "1" },
                  { id: "2", label: "2" },
                  { id: "3", label: "3" },
                ]}
              />
            </div>
            <OptionRow
              label={t("widget.showSeat")}
              checked={options.showSeat}
              onChange={(value) => updateOption("showSeat", value)}
            />
            <OptionRow
              label={t("widget.showTelemetry")}
              checked={options.showTelemetry}
              onChange={(value) => updateOption("showTelemetry", value)}
            />
            <OptionRow
              label={t("widget.includeDaily")}
              checked={options.includeDaily}
              onChange={(value) => updateOption("includeDaily", value)}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("widget.stepsTitle")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs leading-snug text-muted-foreground">
            <li>{t("widget.step1")}</li>
            <li>{t("widget.step2")}</li>
            <li>{t("widget.step3")}</li>
            <li>{t("widget.step4")}</li>
            <li>{t("widget.step5")}</li>
          </ol>
        </div>
      </Card>
    </div>
  );
}

function OptionRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="text-sm leading-snug">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
