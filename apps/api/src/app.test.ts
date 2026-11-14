import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServices } from "@biova/core";
import { socialLinksManifest } from "@biova/plugin-social-links/manifest";
import { createFakeProvider } from "@biova/payments";
import { createRecordingProvider } from "@biova/notifications";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createApp } from "./app";

// Shared secret for the fake provider, so the tests can sign webhook payloads.
const WEBHOOK_SECRET = "test-webhook-secret";

let context: TestDatabase;
let app: ReturnType<typeof createApp>;
// Records the buyer receipt and creator sale alert a paid order triggers, so a
// test can assert the notification actually left the order flow.
let notifications: ReturnType<typeof createRecordingProvider>;

// Two users so the tests can prove one creator cannot touch another's data.
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  notifications = createRecordingProvider();
  const services = createServices(context.db, {
    paymentProvider: createFakeProvider({ secret: WEBHOOK_SECRET }),
    notificationProvider: notifications,
    siteUrl: "https://biova.test",
    // The API only needs the manifests; the React plugin packages stay in the
    // web build. The catalog here stands in for the build-time allowlist.
    pluginCatalog: { get: (id) => (id === socialLinksManifest.id ? socialLinksManifest : undefined), list: () => [socialLinksManifest] },
  });

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
    expect(((await afterPublish.json()) as { products: { id: string; slug: string; title: string; description: string | null; priceIdr: number; thumbnailUrl: string | null }[] }).products).toEqual([
      { id: product.id, slug: "ebook", title: "E-book", description: null, priceIdr: 49_000, thumbnailUrl: null },
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

    // The settled payment notifies the buyer (a receipt) and the creator (a sale
    // alert), and the receipt links back to the order on the configured origin.
    const recipients = notifications.messages.map((message) => message.to);
    expect(recipients).toContain("buyer@example.com");
    expect(notifications.messages.some((message) => message.subject.includes("sale"))).toBe(true);
    const receipt = notifications.messages.find((message) => message.to === "buyer@example.com");
    expect(receipt?.html).toContain(`https://biova.test/order/${order.reference}`);

    // A replay is acknowledged but does nothing.
    const replay = await request("/v1/webhooks/fake", { method: "POST", body: JSON.stringify(notification) });
    expect(await replay.json()).toEqual({ outcome: "duplicate" });
    expect(notifications.messages.filter((message) => message.to === "buyer@example.com")).toHaveLength(1);

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

  test("public page view events are recorded and summarized for the creator", async () => {
    const linkId = ((await (await request("/v1/links", {}, aliceId)).json()) as { links: { id: string }[] }).links[0].id;

    const view = await request("/v1/public/alice/events", {
      method: "POST",
      body: JSON.stringify({ type: "page_view", visitorId: "visitor-abc123", path: "/alice" }),
    });
    expect(view.status).toBe(202);
    expect(await view.json()).toEqual({ recorded: true });

    const click = await request("/v1/public/alice/events", {
      method: "POST",
      body: JSON.stringify({ type: "link_click", visitorId: "visitor-abc123", linkId }),
    });
    expect(click.status).toBe(202);

    // A product view gives the revenue breakdown a denominator to convert against.
    const productId = ((await (await request("/v1/products", {}, aliceId)).json()) as { products: { id: string }[] }).products[0].id;
    const productView = await request("/v1/public/alice/events", {
      method: "POST",
      body: JSON.stringify({ type: "product_view", visitorId: "visitor-abc123", productId }),
    });
    expect(productView.status).toBe(202);

    const summary = await request("/v1/analytics/summary?range=30d", {}, aliceId);
    expect(summary.status).toBe(200);
    const { summary: metrics } = (await summary.json()) as {
      summary: {
        pageViews: number;
        uniqueVisitors: number;
        linkClicks: number;
        clickThroughRate: number;
        productViews: number;
        revenueIdr: number;
        orders: number;
        averageOrderValueIdr: number;
        conversionRate: number;
        products: { productId: string; title: string; views: number; orders: number; revenueIdr: number; conversionRate: number }[];
      };
    };
    expect(metrics.pageViews).toBe(1);
    expect(metrics.uniqueVisitors).toBe(1);
    expect(metrics.linkClicks).toBe(1);
    expect(metrics.clickThroughRate).toBe(100);
    // The paid order from the earlier checkout test shows up in the range.
    expect(metrics.orders).toBe(1);
    expect(metrics.revenueIdr).toBe(49_000);
    expect(metrics.averageOrderValueIdr).toBe(49_000);
    // One product view and one order is a 100% product-view conversion.
    expect(metrics.productViews).toBe(1);
    expect(metrics.conversionRate).toBe(100);
    expect(metrics.products.find((row) => row.productId === productId)).toEqual({
      productId,
      title: "E-book",
      views: 1,
      orders: 1,
      revenueIdr: 49_000,
      conversionRate: 100,
    });
    // A product with no activity is still listed, at zero, so the breakdown is
    // never silently missing a product.
    const all = ((await (await request("/v1/products", {}, aliceId)).json()) as { products: { id: string }[] }).products;
    expect(metrics.products.map((row) => row.productId).sort()).toEqual(all.map((row) => row.id).sort());
    const idle = metrics.products.find((row) => row.productId !== productId);
    expect(idle).toMatchObject({ views: 0, orders: 0, revenueIdr: 0, conversionRate: 0 });
  });

  test("analytics ingest rejects unknown creators, foreign links and bad input", async () => {
    const unknownCreator = await request("/v1/public/nobody/events", {
      method: "POST",
      body: JSON.stringify({ type: "page_view", visitorId: "visitor-abc123" }),
    });
    expect(unknownCreator.status).toBe(404);

    // bob's page is still a draft, so it is not a valid ingest target.
    const draftPage = await request("/v1/public/bob/events", {
      method: "POST",
      body: JSON.stringify({ type: "page_view", visitorId: "visitor-abc123" }),
    });
    expect(draftPage.status).toBe(404);

    const foreignLink = await request("/v1/public/alice/events", {
      method: "POST",
      body: JSON.stringify({
        type: "link_click",
        visitorId: "visitor-abc123",
        linkId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    expect(foreignLink.status).toBe(404);

    const badType = await request("/v1/public/alice/events", {
      method: "POST",
      body: JSON.stringify({ type: "purchase", visitorId: "visitor-abc123" }),
    });
    expect(badType.status).toBe(422);
  });

  test("analytics summary is private and validates its range", async () => {
    expect((await request("/v1/analytics/summary")).status).toBe(401);
    expect((await request("/v1/analytics/summary?range=all", {}, aliceId)).status).toBe(422);

    // Bob has a creator profile but none of the events belong to him, so his
    // summary is all zeros rather than a leak of Alice's metrics.
    const bob = await request("/v1/analytics/summary", {}, bobId);
    expect(bob.status).toBe(200);
    const { summary } = (await bob.json()) as { summary: { pageViews: number; linkClicks: number; revenueIdr: number } };
    expect(summary).toMatchObject({ pageViews: 0, linkClicks: 0, revenueIdr: 0 });
  });

  test("analytics timeseries splits the same metrics into calendar days", async () => {
    expect((await request("/v1/analytics/timeseries")).status).toBe(401);
    expect((await request("/v1/analytics/timeseries?range=all", {}, aliceId)).status).toBe(422);

    const response = await request("/v1/analytics/timeseries?range=7d", {}, aliceId);
    expect(response.status).toBe(200);
    const { timeseries } = (await response.json()) as {
      timeseries: { range: string; days: { date: string; pageViews: number; linkClicks: number; productViews: number; orders: number; revenueIdr: number }[] };
    };
    expect(timeseries.range).toBe("7d");
    expect(timeseries.days).toHaveLength(7);

    // The chart is a breakdown of the same period as the summary, so the daily
    // buckets must add up to the totals rather than to a different set of events.
    const summary = await request("/v1/analytics/summary?range=7d", {}, aliceId);
    const { summary: metrics } = (await summary.json()) as {
      summary: { pageViews: number; linkClicks: number; productViews: number; orders: number; revenueIdr: number };
    };
    const total = (key: "pageViews" | "linkClicks" | "productViews" | "orders" | "revenueIdr") =>
      timeseries.days.reduce((sum, day) => sum + day[key], 0);
    expect(total("pageViews")).toBe(metrics.pageViews);
    expect(total("linkClicks")).toBe(metrics.linkClicks);
    expect(total("productViews")).toBe(metrics.productViews);
    expect(total("orders")).toBe(metrics.orders);
    expect(total("revenueIdr")).toBe(metrics.revenueIdr);

    // Bob's chart is empty, not a window onto Alice's days.
    const bob = await request("/v1/analytics/timeseries?range=7d", {}, bobId);
    const { timeseries: bobSeries } = (await bob.json()) as { timeseries: { days: { pageViews: number }[] } };
    expect(bobSeries.days.every((day) => day.pageViews === 0)).toBe(true);
  });

  test("a creator installs, enables and grants a plugin, then publishes a block", async () => {
    const installed = await request("/v1/plugins/social-links/install", { method: "POST" }, aliceId);
    expect(installed.status).toBe(200);
    const installedBody = (await installed.json()) as { plugin: { installed: boolean; enabled: boolean; grantedPermissions: string[] } };
    expect(installedBody.plugin.installed).toBe(true);
    // Installed is not enabled: nothing is active until the creator says so.
    expect(installedBody.plugin.enabled).toBe(false);
    expect(installedBody.plugin.grantedPermissions).toEqual([]);

    // A capability the manifest does not declare cannot be granted.
    const denied = await request("/v1/plugins/social-links/permissions", { method: "PUT", body: JSON.stringify({ grant: "commerce:write" }) }, aliceId);
    expect(denied.status).toBe(422);
    expect(await denied.json()).toEqual({ error: "permission_not_declared" });

    const granted = await request("/v1/plugins/social-links/permissions", { method: "PUT", body: JSON.stringify({ grant: "page:write" }) }, aliceId);
    expect(granted.status).toBe(200);
    expect(((await granted.json()) as { plugin: { grantedPermissions: string[] } }).plugin.grantedPermissions).toEqual(["page:write"]);

    const enabled = await request("/v1/plugins/social-links/enabled", { method: "PUT", body: JSON.stringify({ enabled: true }) }, aliceId);
    expect(((await enabled.json()) as { plugin: { enabled: boolean } }).plugin.enabled).toBe(true);

    const added = await request("/v1/blocks", {
      method: "POST",
      body: JSON.stringify({ pluginId: "social-links", blockType: "social-links", config: { links: [{ label: "Site", url: "https://example.com" }] } }),
    }, aliceId);
    expect(added.status).toBe(201);

    // The block is public only because the plugin is installed and enabled; the
    // public page read model carries it for the visitor.
    const page = await request("/v1/public/alice");
    const { blocks } = (await page.json()) as { blocks: { pluginId: string; blockType: string }[] };
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ pluginId: "social-links", blockType: "social-links" });
  });

  test("a block cannot be added while its plugin is disabled, and settings are validated", async () => {
    // Bob never installed the plugin, so he cannot add one of its blocks.
    const bobInstall = await request("/v1/plugins/social-links/install", { method: "POST" }, bobId);
    expect(bobInstall.status).toBe(200);
    const blocked = await request("/v1/blocks", {
      method: "POST",
      body: JSON.stringify({ pluginId: "social-links", blockType: "social-links" }),
    }, bobId);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: "plugin_disabled" });

    // Settings must be a JSON object; an array is rejected at the boundary.
    const badSettings = await request("/v1/plugins/social-links/settings", { method: "PUT", body: JSON.stringify([1, 2, 3]) }, aliceId);
    expect(badSettings.status).toBe(422);
    expect(await badSettings.json()).toEqual({ error: "invalid_input" });
  });

  test("a creator cannot install a plugin outside the allowlist", async () => {
    const response = await request("/v1/plugins/ghost/install", { method: "POST" }, aliceId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("a creator uploads branding and it appears on the published public page", async () => {
    // Publish alice's page so the public read model exposes branding.
    await request("/v1/page/status", { method: "PUT", body: JSON.stringify({ status: "published" }) }, aliceId);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" }));
    const uploaded = await app.handle(
      new Request("http://localhost/v1/media/avatar", { method: "PUT", headers: { "x-test-user": aliceId }, body: form }),
    );
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toEqual({ kind: "avatar" });

    const page = await request("/v1/public/alice");
    const { branding } = (await page.json()) as { branding: { avatar?: string; cover?: string } };
    expect(branding.avatar).toMatch(/^\/media\/alice\/avatar\?v=\d+$/);
    expect(branding.cover).toBeUndefined();

    // A non-image upload is refused with 415.
    const zipForm = new FormData();
    zipForm.set("file", new File([new Uint8Array([1, 2, 3])], "x.zip", { type: "application/zip" }));
    const rejected = await app.handle(
      new Request("http://localhost/v1/media/cover", { method: "PUT", headers: { "x-test-user": aliceId }, body: zipForm }),
    );
    expect(rejected.status).toBe(415);
    expect(await rejected.json()).toEqual({ error: "unsupported_type" });

    // Removing clears the slot.
    const removed = await request("/v1/media/avatar", { method: "DELETE" }, aliceId);
    expect(removed.status).toBe(200);
    const after = await request("/v1/public/alice");
    expect(((await after.json()) as { branding: Record<string, string> }).branding.avatar).toBeUndefined();
  });

  test("branding requires a session and only touches the caller's own slots", async () => {
    const anonymous = await app.handle(new Request("http://localhost/v1/media/avatar", { method: "DELETE" }));
    expect(anonymous.status).toBe(401);
  });

  test("a creator uploads a product thumbnail and it appears on the published public page", async () => {
    // A fresh product so the test owns its lifecycle regardless of test order.
    const created = await request(
      "/v1/products",
      { method: "POST", body: JSON.stringify({ title: "Thumbed", slug: "thumbed", priceIdr: 15_000 }) },
      aliceId,
    );
    const { product } = (await created.json()) as { product: { id: string } };
    await request(`/v1/products/${product.id}/status`, { method: "PUT", body: JSON.stringify({ status: "published" }) }, aliceId);

    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "cover.png", { type: "image/png" }));
    const uploaded = await app.handle(
      new Request(`http://localhost/v1/products/${product.id}/thumbnail`, {
        method: "PUT",
        headers: { "x-test-user": aliceId },
        body: form,
      }),
    );
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toEqual({ productId: product.id });

    const page = await request("/v1/public/alice");
    const { products } = (await page.json()) as { products: { slug: string; thumbnailUrl: string | null }[] };
    const thumbed = products.find((item) => item.slug === "thumbed");
    expect(thumbed?.thumbnailUrl).toMatch(new RegExp(`^/media/alice/product/${product.id}\\?v=\\d+$`));

    // A non-image upload is refused with 415.
    const zipForm = new FormData();
    zipForm.set("file", new File([new Uint8Array([1, 2, 3])], "x.zip", { type: "application/zip" }));
    const rejected = await app.handle(
      new Request(`http://localhost/v1/products/${product.id}/thumbnail`, {
        method: "PUT",
        headers: { "x-test-user": aliceId },
        body: zipForm,
      }),
    );
    expect(rejected.status).toBe(415);
    expect(await rejected.json()).toEqual({ error: "unsupported_type" });

    // Removing clears the thumbnail.
    const removed = await request(`/v1/products/${product.id}/thumbnail`, { method: "DELETE" }, aliceId);
    expect(removed.status).toBe(200);
    const after = await request("/v1/public/alice");
    const afterProducts = ((await after.json()) as { products: { slug: string; thumbnailUrl: string | null }[] }).products;
    expect(afterProducts.find((item) => item.slug === "thumbed")?.thumbnailUrl).toBeNull();
  });

  test("product thumbnails require a session and only touch the caller's own products", async () => {
    const anonymous = await app.handle(new Request("http://localhost/v1/products/00000000-0000-0000-0000-000000000000/thumbnail", { method: "DELETE" }));
    expect(anonymous.status).toBe(401);

    // Bob cannot touch a product he does not own; it reads as not found.
    const aliceProducts = (await (await request("/v1/products", {}, aliceId)).json()) as { products: { id: string }[] };
    const removed = await request(`/v1/products/${aliceProducts.products[0].id}/thumbnail`, { method: "DELETE" }, bobId);
    expect(removed.status).toBe(404);
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
