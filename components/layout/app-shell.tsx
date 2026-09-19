"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { desktopNav, isNavActive, mobileNav } from "./nav-config";
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
  const glass = chrome === "ios";
  const railIndex = desktopNav.findIndex((item) => isNavActive(item.href, pathname));
  const dockIndex = mobileNav.findIndex((item) => isNavActive(item.href, pathname));

  return (
    <div className="min-h-dvh bg-background">
      {glass && <div className="glass-scroll-edge" aria-hidden />}

      <aside
        className={cn(
          "app-rail fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border px-3 py-5 lg:flex",
          glass
            ? "glass-sidebar glass-surface"
            : chrome === "desktop"
              ? "bg-card/80"
              : "bg-surface-container",
        )}
      >
        <Link href="/" className="mb-8 px-3 text-lg font-semibold tracking-tight">
          Flight<span className="text-primary">Buddy</span>
        </Link>
        <nav
          className="relative flex flex-1 flex-col gap-1"
          style={{ "--i": railIndex } as CSSProperties}
        >
          {glass && railIndex >= 0 && <span className="glass-rail-indicator" aria-hidden />}
          {desktopNav.map((item, index) => (
            <ChromeNavItem
              key={item.href}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={index === railIndex}
              chrome={chrome}
              layout="rail"
            />
          ))}
        </nav>
        {userName && <p className="px-3 text-sm text-muted-foreground">{userName}</p>}
      </aside>

      <main className="lg:pl-[var(--rail-offset)]">
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
        className="app-dock fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{
          paddingTop: "var(--dock-pad-top)",
          paddingBottom: "var(--dock-pad-bottom)",
          paddingLeft: "var(--dock-pad-left)",
          paddingRight: "var(--dock-pad-right)",
        }}
      >
        <div
          className={cn("flex items-center justify-around", dockBarClass(chrome))}
          style={glass ? ({ "--i": dockIndex, "--n": mobileNav.length } as CSSProperties) : undefined}
        >
          {glass && dockIndex >= 0 && <span className="glass-tab-indicator" aria-hidden />}
          {mobileNav.map((item, index) => (
            <ChromeNavItem
              key={item.href}
              href={item.href}
              label={t(item.labelKey)}
              icon={item.icon}
              active={index === dockIndex}
              chrome={chrome}
              layout="dock"
            />
          ))}
        </div>
      </nav>
    </div>
  );
}
