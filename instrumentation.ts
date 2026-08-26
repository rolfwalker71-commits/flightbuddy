export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureWebPushConfigured } = await import("@/lib/vapid");
  await ensureWebPushConfigured();
}
