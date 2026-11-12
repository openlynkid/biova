import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServices } from "@biova/core";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createApp } from "./app";

let context: TestDatabase;
let app: ReturnType<typeof createApp>;

// Two users so the tests can prove one creator cannot touch another's data.
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  const services = createServices(context.db);

  aliceId = (await createTestUser(context.db)).id;
  bobId = (await createTestUser(context.db)).id;

  app = createApp({
    getServices: async () => services,
    // Test-only session: the x-test-user header stands in for a Better Auth session.
    getSessionUser: async (headers) => {
      const id = headers.get("x-test-user");
      return id ? { id } : null;
    },
    allowedOrigins: ["http://localhost:3000"],
  });
});

afterAll(async () => {
  await context.close();
});

function request(path: string, init: RequestInit = {}, userId?: string) {
  const headers = new Headers(init.headers);
  if (userId) headers.set("x-test-user", userId);
  if (init.body) headers.set("content-type", "application/json");
  return app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
}

describe("biova api", () => {
  test("health and version endpoints", async () => {
    const health = await request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", service: "biova-api", runtime: "bun" });

    const version = await request("/v1");
    expect(await version.json()).toEqual({ name: "Biova API", version: "0.1.0" });
  });

  test("session endpoint rejects anonymous requests", async () => {
    const response = await request("/v1/session");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("onboarding creates a creator with a draft page", async () => {
    const response = await request(
      "/v1/creator",
      { method: "POST", body: JSON.stringify({ slug: "alice", displayName: "Alice" }) },
      aliceId,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { creator: { slug: string }; page: { status: string } };
    expect(body.creator.slug).toBe("alice");
    expect(body.page.status).toBe("draft");
  });

  test("onboarding rejects a reserved slug with 422", async () => {
    const response = await request(
      "/v1/creator",
      { method: "POST", body: JSON.stringify({ slug: "admin", displayName: "Nope" }) },
      bobId,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_input" });
  });

  test("a creator cannot publish before adding an enabled link", async () => {
    const response = await request(
      "/v1/page/status",
      { method: "PUT", body: JSON.stringify({ status: "published" }) },
      aliceId,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "not_publishable" });
  });

  test("links require an http(s) url", async () => {
    const response = await request(
      "/v1/links",
      { method: "POST", body: JSON.stringify({ title: "Bad", url: "javascript:alert(1)" }) },
      aliceId,
    );
    expect(response.status).toBe(422);
  });

  test("creator manages links and publishes the page", async () => {
    const created = await request(
      "/v1/links",
      { method: "POST", body: JSON.stringify({ title: "My site", url: "https://example.com" }) },
      aliceId,
    );
    expect(created.status).toBe(201);
    const { link } = (await created.json()) as { link: { id: string } };

    const published = await request(
      "/v1/page/status",
      { method: "PUT", body: JSON.stringify({ status: "published" }) },
      aliceId,
    );
    expect(published.status).toBe(200);

    const publicPage = await request("/v1/public/alice");
    expect(publicPage.status).toBe(200);
    const body = (await publicPage.json()) as { creator: { displayName: string }; links: { id: string }[] };
    expect(body.creator.displayName).toBe("Alice");
    expect(body.links.map((item) => item.id)).toEqual([link.id]);
  });

  test("draft pages are hidden from visitors", async () => {
    const response = await request("/v1/public/bob");
    expect(response.status).toBe(404);
  });

  test("creators only see their own data", async () => {
    await request(
      "/v1/creator",
      { method: "POST", body: JSON.stringify({ slug: "bob", displayName: "Bob" }) },
      bobId,
    );
    const bobLinks = await request("/v1/links", {}, bobId);
    expect((await bobLinks.json()) as { links: unknown[] }).toEqual({ links: [] });

    const aliceLinks = await request("/v1/links", {}, aliceId);
    expect(((await aliceLinks.json()) as { links: unknown[] }).links.length).toBe(1);
  });

  test("creator manages products and only published ones reach the public page", async () => {
    const draft = await request(
      "/v1/products",
      { method: "POST", body: JSON.stringify({ title: "E-book", slug: "ebook", priceIdr: 49_000 }) },
      aliceId,
    );
    expect(draft.status).toBe(201);
    const { product } = (await draft.json()) as { product: { id: string; status: string } };
    expect(product.status).toBe("draft");

    const duplicate = await request(
      "/v1/products",
      { method: "POST", body: JSON.stringify({ title: "Again", slug: "ebook", priceIdr: 1000 }) },
      aliceId,
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "slug_taken" });

    const invalidPrice = await request(
      "/v1/products",
      { method: "POST", body: JSON.stringify({ title: "Cheap", slug: "cheap", priceIdr: -5 }) },
      aliceId,
    );
    expect(invalidPrice.status).toBe(422);

    const beforePublish = await request("/v1/public/alice");
    expect(((await beforePublish.json()) as { products: unknown[] }).products).toEqual([]);

    const published = await request(
      `/v1/products/${product.id}/status`,
      { method: "PUT", body: JSON.stringify({ status: "published" }) },
      aliceId,
    );
    expect(published.status).toBe(200);

    const afterPublish = await request("/v1/public/alice");
    expect(((await afterPublish.json()) as { products: { slug: string; title: string; description: string | null; priceIdr: number }[] }).products).toEqual([
      { slug: "ebook", title: "E-book", description: null, priceIdr: 49_000 },
    ]);
  });

  test("a creator cannot read or modify another creator's products", async () => {
    const aliceProducts = await request("/v1/products", {}, aliceId);
    const { products } = (await aliceProducts.json()) as { products: { id: string }[] };
    expect(products.length).toBe(1);

    const bobProducts = await request("/v1/products", {}, bobId);
    expect(await bobProducts.json()).toEqual({ products: [] });

    const stolen = await request(
      `/v1/products/${products[0].id}`,
      { method: "PATCH", body: JSON.stringify({ title: "Stolen" }) },
      bobId,
    );
    expect(stolen.status).toBe(404);

    const removed = await request(`/v1/products/${products[0].id}`, { method: "DELETE" }, bobId);
    expect(removed.status).toBe(404);
  });

  test("anonymous access to private endpoints is unauthorized", async () => {
    for (const [method, path] of [
      ["GET", "/v1/creator"],
      ["GET", "/v1/links"],
      ["POST", "/v1/links"],
      ["PATCH", "/v1/page"],
      ["GET", "/v1/products"],
      ["POST", "/v1/products"],
    ] as const) {
      const response = await request(path, { method, body: method === "GET" ? undefined : "{}" });
      expect(response.status).toBe(401);
    }
  });

  test("unknown errors do not leak internals", async () => {
    const originalError = console.error;
    console.error = () => {};
    const failing = createApp({
      getServices: async () => {
        throw new Error("database exploded: secret detail");
      },
      getSessionUser: async () => ({ id: aliceId }),
      allowedOrigins: ["http://localhost:3000"],
    });
    const response = await failing.handle(new Request("http://localhost/v1/links", { headers: { "x-test-user": aliceId } }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
    console.error = originalError;
  });
});
