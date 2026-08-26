export async function register() {
  // Intentionally empty. VAPID/web-push is initialized lazily from
  // lib/vapid.ts (settings, push API, notifyUsers). Importing it here
  // makes Next webpack bundle agent-base and fail on Node builtins
  // (http/https/net) during `next build`.
}
