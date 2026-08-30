import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ChromeStyle } from "@/lib/platform";

export function ChromeNavItem({
  href,
  label,
  icon: Icon,
  active,
  chrome,
  layout,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  chrome: ChromeStyle;
  layout: "dock" | "rail";
}) {
  if (layout === "rail") {
    return (
      <Link
        href={href}
        className={cn(
          "relative flex min-h-12 items-center gap-3 px-3 text-sm font-medium",
          chrome === "desktop" ? "rounded-md" : chrome === "android" ? "rounded-full" : "rounded-xl",
          active
            ? chrome === "desktop"
              ? "bg-primary/10 text-primary"
              : chrome === "android"
                ? "bg-secondary text-primary"
                : "bg-muted text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {chrome === "desktop" && active ? (
          <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
        ) : null}
        <Icon className="size-4" />
        <span className="break-words leading-snug">{label}</span>
      </Link>
    );
  }

  if (chrome === "android") {
    return (
      <Link href={href} className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1">
        <span
          className={cn(
            "inline-flex h-8 min-w-14 items-center justify-center rounded-full px-5",
            active ? "bg-secondary text-primary" : "text-muted-foreground",
          )}
        >
          <Icon className="size-6" />
        </span>
        <span
          className={cn(
            "max-w-full px-0.5 text-center text-[0.6875rem] font-medium leading-snug break-words",
            active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </Link>
    );
  }

  if (chrome === "desktop") {
    return (
      <Link
        href={href}
        className={cn(
          "relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-sm px-1 py-1.5",
          active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Icon className="size-5" />
        <span className="max-w-full text-center text-[0.6875rem] font-medium leading-snug break-words">{label}</span>
        {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.7rem] font-medium",
        active ? "bg-muted text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="leading-snug break-words">{label}</span>
    </Link>
  );
}
