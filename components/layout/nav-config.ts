import { Bell, BookOpen, Map, Plane, Settings, User } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/messages";

export const desktopNav: { href: string; labelKey: MessageKey; icon: typeof Plane }[] = [
  { href: "/", labelKey: "nav.flights", icon: Plane },
  { href: "/map", labelKey: "nav.liveMap", icon: Map },
  { href: "/logbook", labelKey: "nav.logbook", icon: BookOpen },
  { href: "/alerts", labelKey: "nav.alerts", icon: Bell },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
];

export const mobileNav: { href: string; labelKey: MessageKey; icon: typeof Plane }[] = [
  { href: "/", labelKey: "nav.flights", icon: Plane },
  { href: "/map", labelKey: "nav.map", icon: Map },
  { href: "/logbook", labelKey: "nav.log", icon: BookOpen },
  { href: "/settings", labelKey: "nav.me", icon: User },
];
