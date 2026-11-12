import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServices } from "@biova/core";
import { createFakeProvider } from "@biova/payments";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createApp } from "./app";

// Shared secret for the fake provider, so the tests can sign webhook payloads.
const WEBHOOK_SECRET = "test-webhook-secret";

let context: TestDatabase;
let app: ReturnType<typeof createApp>;

// Two users so the tests can prove one creator cannot touch another's data.
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  const services = createServices(context.db, { paymentProvider: createFakeProvider({ secret: WEBHOOK_SECRET }) });

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

  test("a visitor can check out a published product and pay via a verified webhook", async () => {
    const checkout = await request("/v1/checkout", {
      method: "POST",
      body: JSON.stringify({
        creatorSlug: "alice",
        productSlug: "ebook",
        buyerName: "Buyer",
        buyerEmail: "buyer@example.com",
      }),
    });
    expect(checkout.status).toBe(201);
    const { order, redirectUrl } = (await checkout.json()) as {
      order: { reference: string; status: string; totalIdr: number };
      redirectUrl: string | null;
    };
    expect(order.status).toBe("pending");
    expect(order.totalIdr).toBe(49_000);
    expect(redirectUrl).toContain(order.reference);

    const pending = await request(`/v1/orders/${order.reference}`);
    expect(pending.status).toBe(200);

    const forged = await request("/v1/webhooks/fake", {
      method: "POST",
      body: JSON.stringify({
        order_id: order.reference,
        transaction_status: "settlement",
        gross_amount: "49000",
        signature: "not-the-secret",
      }),
    });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "invalid_signature" });

    const notification = {
      order_id: order.reference,
      transaction_status: "settlement",
      gross_amount: "49000",
      signature: WEBHOOK_SECRET,
    };
    const paid = await request("/v1/webhooks/fake", { method: "POST", body: JSON.stringify(notification) });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toEqual({ outcome: "processed" });

    // A replay is acknowledged but does nothing.
    const replay = await request("/v1/webhooks/fake", { method: "POST", body: JSON.stringify(notification) });
    expect(await replay.json()).toEqual({ outcome: "duplicate" });

    const confirmed = await request(`/v1/orders/${order.reference}`);
    expect(((await confirmed.json()) as { order: { status: string } }).order.status).toBe("paid");

    // The creator sees the order in their list, with the buyer details.
    const list = await request("/v1/orders", {}, aliceId);
    const orders = ((await list.json()) as { orders: { reference: string; status: string; buyerEmail: string }[] }).orders;
    expect(orders.some((row) => row.reference === order.reference && row.status === "paid")).toBe(true);

    // Another creator does not see it.
    const bobList = await request("/v1/orders", {}, bobId);
    expect(await bobList.json()).toEqual({ orders: [] });
  });

  test("checkout refuses an unpublished or foreign product and an amount mismatch is rejected", async () => {
    const draftProduct = await request(
      "/v1/products",
      { method: "POST", body: JSON.stringify({ title: "Hidden", slug: "hidden", priceIdr: 10_000 }) },
      aliceId,
    );
    expect(draftProduct.status).toBe(201);

    const unpublished = await request("/v1/checkout", {
      method: "POST",
      body: JSON.stringify({ creatorSlug: "alice", productSlug: "hidden", buyerName: "B", buyerEmail: "b@example.com" }),
    });
    expect(unpublished.status).toBe(404);

    const foreign = await request("/v1/checkout", {
      method: "POST",
      body: JSON.stringify({ creatorSlug: "bob", productSlug: "ebook", buyerName: "B", buyerEmail: "b@example.com" }),
    });
    expect(foreign.status).toBe(404);

    const badInput = await request("/v1/checkout", {
      method: "POST",
      body: JSON.stringify({ creatorSlug: "alice", productSlug: "ebook", buyerName: "", buyerEmail: "nope" }),
    });
    expect(badInput.status).toBe(422);

    const checkout = await request("/v1/checkout", {
      method: "POST",
      body: JSON.stringify({ creatorSlug: "alice", productSlug: "ebook", buyerName: "B", buyerEmail: "b@example.com" }),
    });
    const { order } = (await checkout.json()) as { order: { reference: string } };

    const mismatch = await request("/v1/webhooks/fake", {
      method: "POST",
      body: JSON.stringify({
        order_id: order.reference,
        transaction_status: "settlement",
        gross_amount: "1",
        signature: WEBHOOK_SECRET,
      }),
    });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: "amount_mismatch" });

    const stillPending = await request(`/v1/orders/${order.reference}`);
    expect(((await stillPending.json()) as { order: { status: string } }).order.status).toBe("pending");
  });

  test("an unknown order reference returns 404 to the buyer", async () => {
    const response = await request("/v1/orders/NOPE000000");
    expect(response.status).toBe(404);
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
