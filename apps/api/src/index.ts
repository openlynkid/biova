import { Elysia } from "elysia";

export const app = new Elysia()
  .get("/health", () => ({ status: "ok", service: "biova-api", runtime: "bun" }))
  .get("/v1", () => ({ name: "Biova API", version: "0.1.0" }));

if (import.meta.main) {
  app.listen(Number(Bun.env.PORT ?? 3001));
  console.log(`Biova API listening on ${app.server?.hostname}:${app.server?.port}`);
}
