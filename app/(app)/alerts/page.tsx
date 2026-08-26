import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { NotificationCard } from "@/components/alerts/notification-card";
import { getRequestPrefs } from "@/lib/i18n/prefs";
import { t } from "@/lib/i18n/messages";

export default async function AlertsPage() {
  const session = await auth();
  const { locale, units } = await getRequestPrefs();
  const alerts = await prisma.notification.findMany({
    where: { userId: session!.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const flightIds = [...new Set(alerts.map((alert) => alert.flightId).filter((id): id is string => Boolean(id)))];
  const flights = flightIds.length
    ? await prisma.flight.findMany({
        where: { id: { in: flightIds } },
        include: { departureAirport: true, arrivalAirport: true },
      })
    : [];
  const flightById = new Map(flights.map((flight) => [flight.id, flight]));

  await prisma.notification.updateMany({
    where: { userId: session!.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "alerts.title")}</h1>
      {alerts.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">{t(locale, "alerts.empty")}</Card>
      )}
      {alerts.map((alert) => (
        <NotificationCard
          key={alert.id}
          title={alert.title}
          body={alert.body}
          kind={alert.kind}
          createdAt={alert.createdAt}
          locale={locale}
          units={units}
          flight={alert.flightId ? (flightById.get(alert.flightId) ?? null) : null}
        />
      ))}
    </div>
  );
}
