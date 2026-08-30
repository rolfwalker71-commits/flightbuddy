"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { desktopNav, mobileNav } from "./nav-config";
import { ChromeNavItem } from "./chrome-nav-item";
import { useT } from "@/components/i18n/prefs-provider";
import { useChrome } from "@/components/chrome/chrome-provider";
import { dockBarClass } from "@/lib/platform";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  userName,
}: {
  children: ReactNode;
  userName?: string | null;
}) {
  const pathname = usePathname();
  const t = useT();
  const { chrome } = useChrome();

  return (
    <div className="min-h-dvh bg-background">
      <aside
        className={cn(
          "app-rail fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border px-3 py-5 lg:flex",
          chrome === "desktop" ? "bg-card/80" : "bg-surface-container",
        )}
      >
        <Link href="/" className="mb-8 px-3 text-lg font-semibold tracking-tight">
          Flight<span className="text-primary">Buddy</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {desktopNav.map((item) => (
            <ChromeNavItem
              key={item.href}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={pathname === item.href}
              chrome={chrome}
              layout="rail"
            />
          ))}
        </nav>
        {userName && <p className="px-3 text-sm text-muted-foreground">{userName}</p>}
      </aside>

      <main className="lg:pl-56">
        <div
          className="mx-auto max-w-6xl px-4 md:px-8"
          style={{
            paddingTop: "var(--app-header-pad)",
            paddingBottom: "var(--app-main-pb)",
          }}
        >
          {children}
        </div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{
          paddingTop: "var(--dock-pad-top)",
          paddingBottom: "var(--dock-pad-bottom)",
          paddingLeft: "var(--dock-pad-left)",
          paddingRight: "var(--dock-pad-right)",
        }}
      >
        <div className={cn("flex items-center justify-around", dockBarClass(chrome))}>
          {mobileNav.map((item) => (
            <ChromeNavItem
              key={item.href}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={pathname === item.href}
              chrome={chrome}
              layout="dock"
            />
          ))}
        </div>
      </nav>
    </div>
  );
}
