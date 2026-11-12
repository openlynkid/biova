import { createServices, type BiovaServices } from "@biova/core";
import { createRateLimiter, readEnv } from "@biova/shared";
import { createApp } from "./app";

// Everything that touches the database is loaded lazily so the API can boot and
// serve /health even when DATABASE_URL is missing (for example in tests).
let servicesPromise: Promise<BiovaServices> | undefined;
function getServices(): Promise<BiovaServices> {
  servicesPromise ??= import("@biova/database").then(({ db }) => createServices(db));
  return servicesPromise;
}

async function getSessionUser(headers: Headers) {
  const { auth } = await import("@biova/auth");
  const session = await auth.api.getSession({ headers });
  return session ? { id: session.user.id } : null;
}

const allowedOrigins = (readEnv("CORS_ORIGINS") ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const app = createApp({
  getServices,
  getSessionUser,
  allowedOrigins,
  rateLimiter: createRateLimiter({ windowMs: 60_000, max: 120 }),
  // Webhooks have no session, so they get their own per-address budget.
  webhookRateLimiter: createRateLimiter({ windowMs: 60_000, max: 240 }),
});

if (import.meta.main) {
  app.listen(Number(readEnv("PORT") ?? 3001));
  console.log(`Biova API listening on ${app.server?.hostname}:${app.server?.port}`);
}
