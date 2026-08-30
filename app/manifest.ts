import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FlightBuddy",
    short_name: "FlightBuddy",
    description: "Selbst gehosteter Live-Flugtracker",
    start_url: "/",
    display: "standalone",
    background_color: "#141218",
    theme_color: "#141218",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    // iOS / Android install metas (also set in app/layout.tsx)
    ...({
      "apple-mobile-web-app-capable": "yes",
      "mobile-web-app-capable": "yes",
    } as object),
  };
}
