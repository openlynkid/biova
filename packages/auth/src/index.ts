import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, authSchema } from "@biova/database";
import { sessionPolicy } from "@biova/shared";

// Shared auth instance for the web app and the API. Better Auth routes are
// mounted by the consumer (e.g. /api/auth/*).
export const auth = betterAuth({
  appName: "Biova",
  baseURL: Bun.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: Bun.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true },
  session: sessionPolicy,
});

export type Auth = typeof auth;
