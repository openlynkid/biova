import { describe, expect, test } from "bun:test";

// Exercises the production wiring in index.ts (real auth import, lazy database).
// The route behaviour itself is covered in app.test.ts against an in-process DB.
Bun.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/biova";
Bun.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const { app } = await import("./index");

describe("biova api wiring", () => {
  test("boots and serves health without a database connection", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "biova-api", runtime: "bun" });
  });

  test("session endpoint rejects requests without a session cookie", async () => {
    const response = await app.handle(new Request("http://localhost/v1/session"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("cors reflects only the configured origin", async () => {
    const allowed = await app.handle(
      new Request("http://localhost/health", { headers: { origin: "http://localhost:3000" } }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const denied = await app.handle(
      new Request("http://localhost/health", { headers: { origin: "https://evil.example" } }),
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
