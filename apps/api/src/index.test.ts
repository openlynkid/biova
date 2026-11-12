import { describe, expect, test } from "bun:test";

// The auth route imports @biova/auth lazily, and @biova/database requires a
// connection string at import time. Provide test values before importing the
// app so the request path can resolve without a live database.
Bun.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/biova";
Bun.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";

const { app } = await import("./index");

describe("biova api", () => {
  test("health endpoint reports ok", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "biova-api", runtime: "bun" });
  });

  test("v1 endpoint advertises the service", async () => {
    const response = await app.handle(new Request("http://localhost/v1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "Biova API", version: "0.1.0" });
  });

  test("session endpoint rejects requests without a session cookie", async () => {
    const response = await app.handle(new Request("http://localhost/v1/session"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});
