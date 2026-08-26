import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { PrefsProvider } from "@/components/i18n/prefs-provider";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

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
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
    },
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
      className={cn(inter.variable, prefs.theme === "dark" && "dark")}
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
