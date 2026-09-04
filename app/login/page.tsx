import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "@/components/auth/login-form";
import { FlightMap } from "@/components/map/flight-map";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/");
  const { locale } = await getRequestPrefs();

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.2fr_0.8fr]">
      <div className="relative hidden lg:block">
        <FlightMap
          className="absolute inset-0"
          interactive={false}
          flights={[
            {
              id: "demo",
              from: { lat: 50.0379, lon: 8.5622 },
              to: { lat: 40.6413, lon: -73.7781 },
              progress: 0.55,
              label: "LH 441",
            },
          ]}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-background/80" />
      </div>
      <div
        className="flex flex-col justify-center px-6 py-10 sm:px-12"
        style={{ paddingTop: "max(2.5rem, var(--app-header-pad))" }}
      >
        <div className="mx-auto w-full max-w-sm">
          <div className="fb-card p-6">
            <h1 className="text-3xl font-semibold tracking-tight">
              Flight<span className="text-primary">Buddy</span>
            </h1>
            <p className="mt-2 text-muted-foreground">{t(locale, "auth.tagline")}</p>
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
          <p className="mt-10 text-center text-xs text-muted-foreground">
            {t(locale, "auth.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
