import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Flex } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import { PrefsProvider } from "@/components/i18n/prefs-provider";
import { ChromeProvider } from "@/components/chrome/chrome-provider";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";
import { CHROME_BOOT_SCRIPT } from "@/lib/platform";
import { cn } from "@/lib/utils";
import Script from "next/script";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const robotoFlex = Roboto_Flex({
  subsets: ["latin"],
  variable: "--font-roboto",
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
    themeColor: theme === "dark" ? "#141218" : "#f7f2fa",
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
      className={cn(inter.variable, robotoFlex.variable, prefs.theme === "dark" && "dark")}
      style={{ colorScheme: prefs.theme }}
      data-chrome="android"
      suppressHydrationWarning
    >
      <body>
        <Script id="chrome-boot" strategy="beforeInteractive">
          {CHROME_BOOT_SCRIPT}
        </Script>
        <PrefsProvider prefs={prefs}>
          <ChromeProvider>
            <ServiceWorkerRegister />
            {children}
          </ChromeProvider>
        </PrefsProvider>
      </body>
    </html>
  );
}
