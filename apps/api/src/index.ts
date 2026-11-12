import { Elysia } from "elysia";

export const app = new Elysia()
  .get("/health", () => ({ status: "ok", service: "biova-api", runtime: "bun" }))
  .get("/v1", () => ({ name: "Biova API", version: "0.1.0" }))
  .get("/v1/session", async ({ request, set }) => {
    // Imported lazily so the API can boot and its tests can run without DATABASE_URL.
    const { auth } = await import("@biova/auth");
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    return { user: session.user, session: { expiresAt: session.session.expiresAt } };
  });

if (import.meta.main) {
  app.listen(Number(Bun.env.PORT ?? 3001));
  console.log(`Biova API listening on ${app.server?.hostname}:${app.server?.port}`);
}
