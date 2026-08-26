"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/i18n/prefs-provider";
import { displayFlightNumber } from "@/lib/utils";

export function DeleteFlightButton({
  flightId,
  flightNumber,
  variant = "full",
  redirectTo,
}: {
  flightId: string;
  flightNumber: string;
  variant?: "full" | "icon";
  redirectTo?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = displayFlightNumber(flightNumber);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/flights/${flightId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("flight.deleteFailed"));
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch {
      setError(t("flight.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative z-10 text-muted-foreground hover:text-destructive"
          aria-label={t("flight.delete")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full text-destructive hover:bg-muted hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="size-4" />
          {t("flight.delete")}
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("flight.deleteTitle")}</DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">{t("flight.deleteBody", { code })}</p>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t("flight.deleteCancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {busy ? t("flight.deleting") : t("flight.deleteConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
