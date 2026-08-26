import webpush from "web-push";
import { prisma } from "./db";
import { env } from "./env";

export const VAPID_PUBLIC_KEY_SETTING = "vapid_public_key";
export const VAPID_PRIVATE_KEY_SETTING = "vapid_private_key";
export const VAPID_SUBJECT_SETTING = "vapid_subject";

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

function envOrEmpty(name: string) {
  return process.env[name]?.trim() || "";
}

function mailtoFromAppUrl() {
  try {
    const host = new URL(env.appUrl).hostname;
    return host ? `mailto:flightbuddy@${host}` : null;
  } catch {
    return null;
  }
}

function resolveSubject(stored?: string | null) {
  return (
    envOrEmpty("VAPID_SUBJECT") ||
    stored?.trim() ||
    mailtoFromAppUrl() ||
    "mailto:flightbuddy@localhost"
  );
}

function envOverride(): VapidConfig | null {
  const publicKey = envOrEmpty("VAPID_PUBLIC_KEY");
  const privateKey = envOrEmpty("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: resolveSubject(null) };
}

async function readStored(): Promise<VapidConfig | null> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [VAPID_PUBLIC_KEY_SETTING, VAPID_PRIVATE_KEY_SETTING, VAPID_SUBJECT_SETTING],
      },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const publicKey = map.get(VAPID_PUBLIC_KEY_SETTING)?.trim() || "";
  const privateKey = map.get(VAPID_PRIVATE_KEY_SETTING)?.trim() || "";
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: resolveSubject(map.get(VAPID_SUBJECT_SETTING)),
  };
}

async function generateAndPersist(): Promise<VapidConfig> {
  const existing = await readStored();
  if (existing) return existing;

  const keys = webpush.generateVAPIDKeys();
  const subject = resolveSubject(null);

  try {
    await prisma.$transaction(async (tx) => {
      const again = await tx.appSetting.findUnique({
        where: { key: VAPID_PUBLIC_KEY_SETTING },
      });
      if (again) return;
      await tx.appSetting.createMany({
        data: [
          { key: VAPID_PUBLIC_KEY_SETTING, value: keys.publicKey },
          { key: VAPID_PRIVATE_KEY_SETTING, value: keys.privateKey },
          { key: VAPID_SUBJECT_SETTING, value: subject },
        ],
      });
    });
  } catch {
    // unique race — another process wrote first
  }

  const stored = await readStored();
  if (stored) return stored;
  return { publicKey: keys.publicKey, privateKey: keys.privateKey, subject };
}

export async function getVapidConfig(): Promise<VapidConfig | null> {
  const fromEnv = envOverride();
  if (fromEnv) return fromEnv;
  try {
    return (await readStored()) ?? (await generateAndPersist());
  } catch {
    return null;
  }
}

export async function isWebPushConfigured() {
  return (await getVapidConfig()) != null;
}

let appliedSignature: string | null = null;

export async function ensureWebPushConfigured(): Promise<VapidConfig | null> {
  const cfg = await getVapidConfig();
  if (!cfg) return null;
  const signature = `${cfg.subject}\0${cfg.publicKey}\0${cfg.privateKey}`;
  if (appliedSignature !== signature) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    appliedSignature = signature;
  }
  return cfg;
}
