import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { createProductRepository, createProductService, type ProductService } from "@biova/products";
import { createFakeProvider } from "@biova/payments";
import { createOrderRepository, createOrderService, type OrderService, type SellableProduct } from "./index";

const SECRET = "test-secret";

let context: TestDatabase;
let service: OrderService;
let products: ProductService;
let creatorId: string;
let productId: string;

// Test dependency: resolve a product only when it belongs to the creator with
// the requested slug and is published. This mirrors what core does in production.
function findSellableProduct(creatorSlug: string, productSlug: string): Promise<SellableProduct | undefined> {
  return (async () => {
    if (creatorSlug !== "seller") return undefined;
    const list = await products.listPublished(creatorId);
    const found = list.find((product) => product.slug === productSlug);
    if (!found) return undefined;
    return { creatorId, productId: found.id, slug: found.slug, title: found.title, priceIdr: found.priceIdr };
  })();
}

beforeAll(async () => {
  context = await createTestDatabase();
  products = createProductService(createProductRepository(context.db));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "seller", displayName: "Seller" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;

  const product = await products.create({ creatorId, title: "E-book", slug: "ebook", priceIdr: 75_000 });
  if (!product.ok) throw new Error("failed to create product");
  productId = product.value.id;
  await products.setStatus(creatorId, productId, "published");

  const provider = createFakeProvider({ secret: SECRET });
  service = createOrderService(createOrderRepository(context.db), { findSellableProduct }, provider);
});

afterAll(async () => {
  await context.close();
});

function notification(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "",
    transaction_status: "settlement",
    gross_amount: "75000",
    signature: SECRET,
    transaction_id: "tx-1",
    ...overrides,
  };
}

describe("order service", () => {
  test("checkout snapshots the server-side price, not a client value", async () => {
    const result = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Buyer",
      buyerEmail: "buyer@example.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.order.totalIdr).toBe(75_000);
    expect(result.value.order.status).toBe("pending");
    expect(result.value.redirectUrl).toBe("https://example.test/pay/" + result.value.order.reference);

    const found = await service.getByReference(result.value.order.reference);
    expect(found?.items.map((item) => item.title)).toEqual(["E-book"]);
    expect(found?.items[0].unitPriceIdr).toBe(75_000);
  });

  test("checkout rejects unknown buyers input and unpublished products", async () => {
    expect(
      await service.checkout({ creatorSlug: "seller", productSlug: "ebook", buyerName: "", buyerEmail: "x@example.com" }),
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(
      await service.checkout({ creatorSlug: "seller", productSlug: "ebook", buyerName: "B", buyerEmail: "nope" }),
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(
      await service.checkout({ creatorSlug: "seller", productSlug: "missing", buyerName: "B", buyerEmail: "b@example.com" }),
    ).toEqual({ ok: false, error: "not_found" });

    const draft = await products.create({ creatorId, title: "Draft", slug: "draft-item", priceIdr: 1000 });
    if (!draft.ok) throw new Error("setup failed");
    expect(
      await service.checkout({ creatorSlug: "seller", productSlug: "draft-item", buyerName: "B", buyerEmail: "b@example.com" }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  test("a signed webhook marks the order paid and grants an entitlement", async () => {
    const checkout = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Payer",
      buyerEmail: "payer@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;

    const result = await service.handleWebhook(notification({ order_id: reference, transaction_id: "tx-paid" }));
    expect(result.ok && result.value.outcome).toBe("processed");
    if (!result.ok) return;
    expect(result.value.order?.status).toBe("paid");
    expect(result.value.order?.paidAt).not.toBeNull();

    const found = await service.getByReference(reference);
    expect(found?.order.status).toBe("paid");

    const entitlements = await service.listEntitlementsByEmail("payer@example.com");
    expect(entitlements.some((row) => row.orderId === found?.order.id && row.productId === productId)).toBe(true);
  });

  test("a replayed webhook is idempotent and does not grant twice", async () => {
    const checkout = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Replay",
      buyerEmail: "replay@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;
    const payload = notification({ order_id: reference, transaction_id: "tx-replay" });

    expect((await service.handleWebhook(payload)).ok).toBe(true);
    const replay = await service.handleWebhook(payload);
    expect(replay.ok && replay.value.outcome).toBe("duplicate");

    const entitlements = await service.listEntitlementsByEmail("replay@example.com");
    expect(entitlements).toHaveLength(1);
  });

  test("an unsigned or forged webhook is rejected without recording an event", async () => {
    const checkout = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Forged",
      buyerEmail: "forged@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;

    const forged = notification({ order_id: reference, signature: "wrong" });
    expect(await service.handleWebhook(forged)).toEqual({ ok: false, error: "invalid_signature" });

    // A correctly signed delivery for the same order still works afterwards,
    // proving the forged one did not consume the idempotency key.
    const valid = notification({ order_id: reference, transaction_id: "tx-after-forgery" });
    const result = await service.handleWebhook(valid);
    expect(result.ok && result.value.outcome).toBe("processed");

    const found = await service.getByReference(reference);
    expect(found?.order.status).toBe("paid");
  });

  test("an amount mismatch is refused and leaves the order pending", async () => {
    const checkout = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Cheapskate",
      buyerEmail: "cheap@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;

    const result = await service.handleWebhook(
      notification({ order_id: reference, gross_amount: "1", transaction_id: "tx-cheap" }),
    );
    expect(result).toEqual({ ok: false, error: "amount_mismatch" });

    const found = await service.getByReference(reference);
    expect(found?.order.status).toBe("pending");
  });

  test("a wrong-amount delivery does not block the later valid settlement", async () => {
    const checkout = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "WrongFirst",
      buyerEmail: "wrong-first@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;

    // Signed with the real secret but carrying the wrong amount. It is refused,
    // and it must not consume the idempotency key for the order.
    const wrong = await service.handleWebhook(
      notification({ order_id: reference, gross_amount: "1", transaction_id: "tx-wrong" }),
    );
    expect(wrong).toEqual({ ok: false, error: "amount_mismatch" });

    // The correct settlement for the same order still goes through.
    const right = await service.handleWebhook(
      notification({ order_id: reference, gross_amount: "75000", transaction_id: "tx-right" }),
    );
    expect(right.ok && right.value.outcome).toBe("processed");
    if (!right.ok) return;
    expect(right.value.order?.status).toBe("paid");
  });

  test("a webhook for an unknown order is ignored", async () => {
    const result = await service.handleWebhook(notification({ order_id: "NOSUCHORDER123", transaction_id: "tx-x" }));
    expect(result.ok && result.value.outcome).toBe("ignored");
  });

  test("a failed payment moves the order to failed and cannot be resurrected", async () => {
    const checkout = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Unlucky",
      buyerEmail: "unlucky@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;

    const denied = await service.handleWebhook(
      notification({ order_id: reference, transaction_status: "deny", transaction_id: "tx-deny" }),
    );
    expect(denied.ok && denied.value.order?.status).toBe("failed");

    // A later settlement for the same order is not an allowed edge from failed.
    const settle = await service.handleWebhook(
      notification({ order_id: reference, transaction_status: "settlement", transaction_id: "tx-late" }),
    );
    expect(settle.ok && settle.value.outcome).toBe("ignored");

    const found = await service.getByReference(reference);
    expect(found?.order.status).toBe("failed");
  });

  test("free products are fulfilled without contacting a provider", async () => {
    const free = await products.create({ creatorId, title: "Freebie", slug: "freebie", priceIdr: 0 });
    if (!free.ok) throw new Error("setup failed");
    await products.setStatus(creatorId, free.value.id, "published");

    const result = await service.checkout({
      creatorSlug: "seller",
      productSlug: "freebie",
      buyerName: "Free",
      buyerEmail: "free@example.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order.status).toBe("paid");
    expect(result.value.redirectUrl).toBeNull();
  });

  test("a creator sees only their own orders", async () => {
    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "other-seller", displayName: "Other" });
    if (!other.ok) throw new Error("setup failed");

    const mine = await service.listByCreator(creatorId);
    expect(mine.length).toBeGreaterThan(0);
    expect(await service.listByCreator(other.value.id)).toEqual([]);
  });

  test("paid revenue is grouped by UTC day and scoped to the creator", async () => {
    const paid = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Daily",
      buyerEmail: "daily@example.com",
    });
    if (!paid.ok) throw new Error("setup failed");
    await service.handleWebhook(notification({ order_id: paid.value.order.reference, transaction_id: "tx-daily" }));

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const days = await service.paidRevenueByDay(creatorId, since);
    const today = new Date().toISOString().slice(0, 10);
    const bucket = days.find((day) => day.date === today);

    // Several orders were paid above; this asserts the grouping runs and the
    // day is present, while the exact counts stay covered by the totals test.
    expect(bucket?.revenueIdr).toBeGreaterThanOrEqual(75_000);
    expect(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))).toBe(true);

    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "revenue-other", displayName: "Other" });
    if (!other.ok) throw new Error("setup failed");
    expect(await service.paidRevenueByDay(other.value.id, since)).toEqual([]);
  });

  test("paid revenue is grouped by product and scoped to the creator", async () => {
    const paid = await service.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "PerProduct",
      buyerEmail: "per-product@example.com",
    });
    if (!paid.ok) throw new Error("setup failed");
    await service.handleWebhook(
      notification({ order_id: paid.value.order.reference, transaction_id: "tx-per-product" }),
    );

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const byProduct = await service.paidRevenueByProduct(creatorId, since);
    const ebook = byProduct.find((row) => row.productId === productId);
    expect(ebook?.count).toBeGreaterThanOrEqual(1);
    expect(ebook?.revenueIdr).toBeGreaterThanOrEqual(75_000);

    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "product-other", displayName: "Other" });
    if (!other.ok) throw new Error("setup failed");
    expect(await service.paidRevenueByProduct(other.value.id, since)).toEqual([]);
  });

  test("notifies once when an order becomes paid, and not for a failed payment", async () => {
    const paidCalls: { orderReference: string; items: string[] }[] = [];
    const notifying = createOrderService(
      createOrderRepository(context.db),
      {
        findSellableProduct,
        async onOrderPaid(input) {
          paidCalls.push({ orderReference: input.orderReference, items: input.items });
        },
      },
      createFakeProvider({ secret: SECRET }),
    );

    const checkout = await notifying.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Notified",
      buyerEmail: "notified@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const reference = checkout.value.order.reference;

    const settled = await notifying.handleWebhook(notification({ order_id: reference, transaction_id: "tx-notify" }));
    expect(settled.ok && settled.value.outcome).toBe("processed");
    expect(paidCalls).toEqual([{ orderReference: reference, items: ["E-book"] }]);

    // The replay is a duplicate, so the buyer is not notified a second time.
    await notifying.handleWebhook(notification({ order_id: reference, transaction_id: "tx-notify" }));
    expect(paidCalls).toHaveLength(1);

    const denied = await notifying.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Denied",
      buyerEmail: "denied-notify@example.com",
    });
    if (!denied.ok) throw new Error("setup failed");
    await notifying.handleWebhook(
      notification({ order_id: denied.value.order.reference, transaction_status: "deny", transaction_id: "tx-deny-notify" }),
    );
    expect(paidCalls).toHaveLength(1);
  });

  test("a notification failure never fails the settled payment", async () => {
    const brittle = createOrderService(
      createOrderRepository(context.db),
      {
        findSellableProduct,
        async onOrderPaid() {
          throw new Error("email provider down");
        },
      },
      createFakeProvider({ secret: SECRET }),
    );

    const checkout = await brittle.checkout({
      creatorSlug: "seller",
      productSlug: "ebook",
      buyerName: "Resilient",
      buyerEmail: "resilient@example.com",
    });
    if (!checkout.ok) throw new Error("setup failed");
    const result = await brittle.handleWebhook(
      notification({ order_id: checkout.value.order.reference, transaction_id: "tx-resilient" }),
    );
    expect(result.ok && result.value.order?.status).toBe("paid");
  });
});
