import webpush from "web-push";
import { prisma } from "./db";
import { ensureWebPushConfigured } from "./vapid";
import { isLocale, isUnits, type Locale, type Units } from "./i18n/messages";
import {
  buildAlertCopy,
  type AlertFlight,
  type NotifyKind,
} from "./alert-copy";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  kind: string;
  flightId?: string;
};

export { buildAlertCopy } from "./alert-copy";

export async function notifyUsers(opts: {
  userIds: string[];
  kind: NotifyKind;
  build?: (locale: Locale, units: Units) => PushPayload;
  flight?: AlertFlight;
  status?: string | null;
  gate?: string | null;
  terminal?: string | null;
  delayMinutes?: number | null;
}) {
  const [prefs, users] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId: { in: opts.userIds } },
    }),
    prisma.user.findMany({
      where: { id: { in: opts.userIds } },
      select: { id: true, locale: true, units: true },
    }),
  ]);
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
  const localeByUser = new Map(
    users.map((u) => [u.id, isLocale(u.locale) ? u.locale : ("de" as const)]),
  );
  const unitsByUser = new Map(
    users.map((u) => [u.id, isUnits(u.units) ? u.units : ("metric" as const)]),
  );

  const eligible = opts.userIds.filter((id) => {
    const p = prefByUser.get(id);
    if (!p) return true;
    if (!p.webPush) return false;
    if (opts.kind === "gate") return p.gateChanges;
    if (opts.kind === "status") return p.delaysStatus;
    if (opts.kind === "preflight") return p.preflight2h;
    if (opts.kind === "object") return p.objectAlerts !== false;
    return true;
  });

  if (!eligible.length) return;
  if (!opts.build && !opts.flight) return;

  const payloads = new Map(
    eligible.map((id) => {
      const locale = localeByUser.get(id) ?? "de";
      const units = unitsByUser.get(id) ?? "metric";
      if (opts.build) return [id, opts.build(locale, units)] as const;
      if (opts.flight) {
        const copy = buildAlertCopy({
          locale,
          units,
          kind: opts.kind,
          flight: opts.flight,
          status: opts.status,
          gate: opts.gate,
          terminal: opts.terminal,
          delayMinutes: opts.delayMinutes,
        });
        return [
          id,
          {
            title: copy.title,
            body: copy.body,
            kind: copy.persistKind,
            flightId: copy.flightId,
            url: copy.url,
          } satisfies PushPayload,
        ] as const;
      }
      return [id, { title: "", body: "", kind: opts.kind } satisfies PushPayload] as const;
    }),
  );

  await prisma.notification.createMany({
    data: eligible.map((userId) => {
      const payload = payloads.get(userId)!;
      return {
        userId,
        title: payload.title,
        body: payload.body,
        flightId: payload.flightId,
        kind: payload.kind,
      };
    }),
  });

  const vapid = await ensureWebPushConfigured();
  if (!vapid) return;

  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: eligible } },
  });

  await Promise.all(
    subs.map(async (sub) => {
      const payload = payloads.get(sub.userId);
      if (!payload) return;
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            url: payload.url ?? "/",
          }),
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        }
      }
    }),
  );
}
