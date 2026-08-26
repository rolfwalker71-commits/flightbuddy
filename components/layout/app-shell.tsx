"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { desktopNav, mobileNav } from "./nav-config";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/prefs-provider";

export function AppShell({
  children,
  userName,
}: {
  children: ReactNode;
  userName?: string | null;
}) {
  const pathname = usePathname();
  const t = useT();

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-background px-3 py-5 md:flex">
        <Link href="/" className="mb-8 px-3 text-lg font-semibold tracking-tight">
          Flight<span className="text-primary">Buddy</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {desktopNav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium",
                  active
                    ? "bg-muted text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
        {userName && (
          <p className="px-3 text-sm text-muted-foreground">{userName}</p>
        )}
      </aside>

      <main className="md:pl-56">
        <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:px-8 md:pb-10">{children}</div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 md:hidden"
        style={{ padding: "max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left)) max(0.75rem, env(safe-area-inset-right))" }}
      >
        <div className="flex items-center justify-around rounded-2xl border border-border bg-card p-1 shadow-dock">
          {mobileNav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.7rem] font-medium",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
