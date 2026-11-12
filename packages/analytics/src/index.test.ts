import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { createLinkRepository, createLinkService, type LinkService } from "@biova/links";
import { createProductRepository, createProductService, type ProductService } from "@biova/products";
import { createAnalyticsRepository, createAnalyticsService, type AnalyticsService } from "./index";

let context: TestDatabase;
let service: AnalyticsService;
let links: LinkService;
let products: ProductService;
let creatorId: string;
let linkId: string;
let productId: string;

const VISITOR = "visitor-0001";

beforeAll(async () => {
  context = await createTestDatabase();

  links = createLinkService(createLinkRepository(context.db));
  products = createProductService(createProductRepository(context.db));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "metrics", displayName: "Metrics" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;

  const link = await links.create({ creatorId, title: "My site", url: "https://example.com" });
  if (!link.ok) throw new Error("failed to create link");
  linkId = link.value.id;

  const product = await products.create({ creatorId, title: "Preset", slug: "preset", priceIdr: 25000 });
  if (!product.ok) throw new Error("failed to create product");
  productId = product.value.id;

  service = createAnalyticsService(createAnalyticsRepository(context.db), {
    listLinks: async (id) => (id === creatorId ? [{ id: linkId, title: "My site" }] : []),
    listProducts: async (id) => (id === creatorId ? [{ id: productId, title: "Preset" }] : []),
    // One paid order worth 25,000 IDR, mirroring what the orders domain reports.
    paidOrders: async (id) => (id === creatorId ? { count: 1, revenueIdr: 25000 } : { count: 0, revenueIdr: 0 }),
  });
});

afterAll(async () => {
  await context.close();
});

describe("analytics service", () => {
  test("records a page view and counts it once", async () => {
    const result = await service.track({ creatorId, type: "page_view", visitorId: VISITOR, path: "/metrics" });
    expect(result).toEqual({ ok: true, value: { recorded: true } });

    const summary = await service.summary(creatorId, "30d");
    expect(summary.pageViews).toBe(1);
    expect(summary.uniqueVisitors).toBe(1);
  });

  test("counts a repeat visit as a view but not a new visitor", async () => {
    await service.track({ creatorId, type: "page_view", visitorId: VISITOR, path: "/metrics" });
    const summary = await service.summary(creatorId, "30d");
    expect(summary.pageViews).toBe(2);
    expect(summary.uniqueVisitors).toBe(1);
  });

  test("records link clicks and reports the click-through rate", async () => {
    await service.track({ creatorId, type: "link_click", visitorId: VISITOR, linkId });
    const summary = await service.summary(creatorId, "30d");
    expect(summary.linkClicks).toBe(1);
    // 1 click over 2 page views is 50%.
    expect(summary.clickThroughRate).toBe(50);
    expect(summary.links).toEqual([{ linkId, title: "My site", clicks: 1 }]);
  });

  test("records product views and reports revenue from paid orders", async () => {
    await service.track({ creatorId, type: "product_view", visitorId: VISITOR, productId });
    const summary = await service.summary(creatorId, "30d");
    expect(summary.productViews).toBe(1);
    expect(summary.products).toEqual([{ productId, title: "Preset", views: 1 }]);
    expect(summary.orders).toBe(1);
    expect(summary.revenueIdr).toBe(25000);
  });

  test("rejects an event with an unknown type or a malformed visitor id", async () => {
    expect(await service.track({ creatorId, type: "purchase", visitorId: VISITOR })).toEqual({ ok: false, error: "invalid_input" });
    expect(await service.track({ creatorId, type: "page_view", visitorId: "x" })).toEqual({ ok: false, error: "invalid_input" });
  });

  test("rejects a link click for a link the creator does not own", async () => {
    const foreign = await service.track({
      creatorId,
      type: "link_click",
      visitorId: VISITOR,
      linkId: "00000000-0000-0000-0000-000000000000",
    });
    expect(foreign).toEqual({ ok: false, error: "not_found" });
  });

  test("requires a link id for a click and a product id for a product view", async () => {
    expect(await service.track({ creatorId, type: "link_click", visitorId: VISITOR })).toEqual({ ok: false, error: "invalid_input" });
    expect(await service.track({ creatorId, type: "product_view", visitorId: VISITOR })).toEqual({ ok: false, error: "invalid_input" });
  });

  test("counts only events inside the requested range", async () => {
    // A service with a clock far in the future sees none of the events above.
    const future = createAnalyticsService(createAnalyticsRepository(context.db), {
      listLinks: async () => [{ id: linkId, title: "My site" }],
      listProducts: async () => [{ id: productId, title: "Preset" }],
      paidOrders: async () => ({ count: 0, revenueIdr: 0 }),
    }, { now: () => Date.now() + 100 * 24 * 60 * 60 * 1000 });
    const summary = await future.summary(creatorId, "7d");
    expect(summary.pageViews).toBe(0);
    expect(summary.linkClicks).toBe(0);
  });

  test("reports a zero click-through rate when there are no views", async () => {
    const empty = createAnalyticsService(createAnalyticsRepository(context.db), {
      listLinks: async () => [],
      listProducts: async () => [],
      paidOrders: async () => ({ count: 0, revenueIdr: 0 }),
    }, { now: () => Date.now() + 200 * 24 * 60 * 60 * 1000 });
    const summary = await empty.summary(creatorId, "7d");
    expect(summary.pageViews).toBe(0);
    expect(summary.clickThroughRate).toBe(0);
  });
});
