"use client";

import { useChrome } from "@/components/chrome/chrome-provider";
import { useT } from "@/components/i18n/prefs-provider";
import { CHROME_OPTIONS, type ChromePreference } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/messages";

export function ChromeSwitcher({ className }: { className?: string }) {
  const t = useT();
  const { preference, chrome, setChrome } = useChrome();
  const current = CHROME_OPTIONS.find((option) => option.value === preference);
  const activeLabel =
    chrome === "android" ? t("settings.chromeAndroid") : chrome === "desktop" ? t("settings.chromeWindows") : t("settings.chromeIos");

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm">{t("settings.chrome")}</p>
      <div className="grid grid-cols-4 gap-0.5 rounded-full bg-muted p-0.5">
        {CHROME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "flex h-10 min-h-0 items-center justify-center rounded-full px-1 text-sm font-medium leading-none",
              preference === option.value
                ? "bg-secondary text-primary shadow-none"
                : "text-muted-foreground",
            )}
            onClick={() => setChrome(option.value as ChromePreference)}
          >
            {t(option.labelKey as MessageKey)}
          </button>
        ))}
      </div>
      <p className="text-xs leading-snug text-muted-foreground">
        {current ? t(current.hintKey as MessageKey) : null} {t("settings.chromeActive", { name: activeLabel })}
      </p>
    </div>
  );
}
