import { auth } from "@/auth";
import { getUserFlights } from "@/lib/flights";
import { getLogbookStats } from "@/lib/stats";
import { listTrackedAircraft } from "@/lib/tracked-aircraft";
import { prisma } from "@/lib/db";
import { Dashboard } from "@/components/flights/dashboard";
import { toPlain } from "@/lib/serialize";

export default async function HomePage() {
  const session = await auth();
  const userId = session!.user.id;
  const [flights, stats, unreadAlerts, tracked] = await Promise.all([
    getUserFlights(userId),
    getLogbookStats(userId),
    prisma.notification.count({ where: { userId, readAt: null } }),
    listTrackedAircraft(userId),
  ]);

  return (
    <Dashboard
      userName={session!.user.name}
      flights={toPlain(flights)}
      unreadAlerts={unreadAlerts}
      stats={{ flights: stats.flights, hours: stats.hours, countries: stats.countries }}
      tracked={toPlain(tracked)}
    />
  );
}
