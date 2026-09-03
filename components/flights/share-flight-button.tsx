"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tileClassName } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/prefs-provider";

export function ShareFlightButton({
  flightId,
  tripId,
}: {
  flightId?: string;
  tripId?: string;
}) {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!flightId || tripId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/share?flightId=${encodeURIComponent(flightId)}`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const json = (await res.json()) as { token?: string | null };
      if (!cancelled) setToken(json.token ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [flightId, tripId]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tripId ? { tripId } : { flightId }),
      });
      if (!res.ok) throw new Error("share");
      const json = (await res.json()) as { token: string; url: string };
      setToken(json.token);
      const absolute = `${window.location.origin}${json.url}`;
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!token) return;
    setBusy(true);
    try {
      await fetch(`/api/share?token=${encodeURIComponent(token)}`, { method: "DELETE" });
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!token) return;
    const absolute = `${window.location.origin}/s/${token}`;
    await navigator.clipboard.writeText(absolute);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn(tileClassName, "space-y-2 p-3")}>
      <p className="text-sm font-medium">{t("share.title")}</p>
      <p className="text-xs leading-snug text-muted-foreground">{t("share.hint")}</p>
      <div className="flex flex-wrap gap-2">
        {!token ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void create()}>
            <Link2 className="size-4" />
            {t("share.create")}
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void copy()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t("share.copied") : t("share.copy")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void revoke()}>
              <Link2Off className="size-4" />
              {t("share.revoke")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
