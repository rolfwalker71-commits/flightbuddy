import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { PrefsProvider } from "@/components/i18n/prefs-provider";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const prefs = await getRequestPrefs();
  return {
    title: "FlightBuddy",
    description: t(prefs.locale, "meta.description"),
    applicationName: "FlightBuddy",
    appleWebApp: {
      capable: true,
      statusBarStyle: prefs.theme === "dark" ? "black-translucent" : "default",
      title: "FlightBuddy",
    },
    formatDetection: { telephone: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getRequestPrefs();
  return {
    themeColor: theme === "dark" ? "#0B0D10" : "#F7F9FB",
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const prefs = await getRequestPrefs();
  return (
    <html
      lang={prefs.locale}
      className={prefs.theme === "dark" ? "dark" : undefined}
      style={{ colorScheme: prefs.theme }}
      suppressHydrationWarning
    >
      <body>
        <PrefsProvider prefs={prefs}>
          <ServiceWorkerRegister />
          {children}
        </PrefsProvider>
      </body>
    </html>
  );
}
