import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getApiUsageSnapshot } from "@/lib/api-quota";
import { getVapidConfig } from "@/lib/vapid";
import { SettingsPanel } from "@/components/settings/settings-panel";

export default async function SettingsPage() {
  const session = await auth();
  const userId = session!.user.id;
  const prefs =
    (await prisma.notificationPreference.findUnique({ where: { userId } })) ??
    (await prisma.notificationPreference.create({ data: { userId } }));

  const [vapid, apiUsage] = await Promise.all([getVapidConfig(), getApiUsageSnapshot()]);

  return (
    <SettingsPanel
      name={session!.user.name}
      email={session!.user.email}
      role={session!.user.role}
      prefs={prefs}
      vapidPublicKey={vapid?.publicKey}
      openSkyHealthy={apiUsage.opensky.healthy}
      apiUsage={apiUsage}
      canSeed={session!.user.role === "ADMIN"}
    />
  );
}
