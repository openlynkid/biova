import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, authSchema } from "@biova/database";
import { readEnv, sessionPolicy } from "@biova/shared";

// Hosts allowed to reach the auth endpoints. In development the dev tunnel
// forwards its own Host header, so the list has to include it; in production
// this is the real domain. `*.all-hands.dev` covers the local runtime tunnels.
function allowedAuthHosts(): string[] {
  const fromEnv = readEnv("BETTER_AUTH_ALLOWED_HOSTS");
  if (fromEnv) {
    return fromEnv.split(",").map((host) => host.trim()).filter(Boolean);
  }
  if (readEnv("NODE_ENV") === "production") return [];
  return ["localhost", "127.0.0.1", "*.all-hands.dev"];
}

function trustedOrigins(): string[] {
  return (readEnv("CORS_ORIGINS") ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedHosts = allowedAuthHosts();

// Shared auth instance for the web app and the API. Better Auth routes are
// mounted by the consumer (e.g. /api/auth/*).
export const auth = betterAuth({
  appName: "Biova",
  // A dynamic base URL keeps the cookie prefix and the trusted origins correct
  // behind a proxy: `http://localhost:3000` locally, `https://…` on the tunnel.
  baseURL: allowedHosts.length
    ? { allowedHosts, protocol: "auto", fallback: readEnv("BETTER_AUTH_URL") ?? "http://localhost:3000" }
    : (readEnv("BETTER_AUTH_URL") ?? "http://localhost:3000"),
  secret: readEnv("BETTER_AUTH_SECRET"),
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true },
  session: sessionPolicy,
  trustedOrigins: trustedOrigins(),
});

export type Auth = typeof auth;
