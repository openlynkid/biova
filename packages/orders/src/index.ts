import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  orderItems,
  orders,
  paymentTransactions,
  paymentWebhookEvents,
  productEntitlements,
} from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import {
  createOrderSchema,
  canTransitionOrder,
  isPaymentFailed,
  isPaymentPaid,
  type OrderStatus,
  type PaymentStatus,
  type Result,
  ok,
  fail,
} from "@biova/shared";
import type { PaymentProvider } from "@biova/payments";

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type ProductEntitlement = typeof productEntitlements.$inferSelect;

export type OrderError =
  | "invalid_input"
  | "not_found"
  | "invalid_transition"
  | "amount_mismatch"
  | "invalid_signature"
  | "payment_unavailable";

// A product the buyer is allowed to purchase: published, owned by the creator
// whose slug was requested, with the price read from the database — never from
// the request body.
export interface SellableProduct {
  creatorId: string;
  productId: string;
  slug: string;
  title: string;
  priceIdr: number;
}

export interface OrderDeps {
  findSellableProduct(creatorSlug: string, productSlug: string): Promise<SellableProduct | undefined>;
}

export interface OrderWithItems {
  order: Order;
  items: OrderItem[];
}

export interface OrderRepository {
  create(args: { creatorId: string; reference: string; buyerName: string; buyerEmail: string; buyerPhone: string | null; totalIdr: number }): Promise<Order>;
  addItem(args: { orderId: string; productId: string; productSlug: string; title: string; unitPriceIdr: number }): Promise<OrderItem>;
  findByReference(reference: string): Promise<Order | undefined>;
  findById(id: string): Promise<Order | undefined>;
  listItems(orderId: string): Promise<OrderItem[]>;
  listByCreator(creatorId: string): Promise<Order[]>;
  // Paid orders since a date, for the analytics revenue read. Counts only
  // orders that are actually paid, so a refunded order drops out.
  paidTotalsSince(creatorId: string, since: Date): Promise<{ count: number; revenueIdr: number }>;
  recordWebhookEvent(args: { provider: string; eventId: string; eventType: string; payload: Record<string, unknown> }): Promise<boolean>;
  upsertPaymentTransaction(args: {
    orderId: string;
    provider: string;
    providerReference: string;
    status: PaymentStatus;
    amountIdr: number;
    currency: string;
    redirectUrl: string | null;
    rawPayload: Record<string, unknown>;
  }): Promise<void>;
  // Applies an order status change and, when the order becomes paid, grants the
  // entitlements. Runs in one transaction so the order and the entitlements can
  // never disagree. Returns the updated order, or undefined when the order was
  // not in the expected `fromStatus` (a concurrent update won).
  applyStatus(args: { orderId: string; fromStatus: OrderStatus; toStatus: OrderStatus; paidAt: Date | null }): Promise<Order | undefined>;
  listEntitlements(orderId: string): Promise<ProductEntitlement[]>;
  listEntitlementsByEmail(email: string): Promise<ProductEntitlement[]>;
  // Used by delivery, which knows an entitlement id from a signed token but not
  // the order it belongs to. Unscoped by design: the caller is the token check.
  findEntitlementById(entitlementId: string): Promise<ProductEntitlement | undefined>;
}

export function createOrderRepository(db: Database): OrderRepository {
  return {
    async create(args) {
      const [row] = await db
        .insert(orders)
        .values({
          creatorId: args.creatorId,
          reference: args.reference,
          buyerName: args.buyerName,
          buyerEmail: args.buyerEmail,
          buyerPhone: args.buyerPhone,
          subtotalIdr: args.totalIdr,
          totalIdr: args.totalIdr,
          status: "pending",
        })
        .returning();
      return row;
    },

    async addItem(args) {
      const [row] = await db
        .insert(orderItems)
        .values({
          orderId: args.orderId,
          productId: args.productId,
          productSlug: args.productSlug,
          title: args.title,
          quantity: 1,
          unitPriceIdr: args.unitPriceIdr,
          totalPriceIdr: args.unitPriceIdr,
        })
        .returning();
      return row;
    },

    async findByReference(reference) {
      const [row] = await db.select().from(orders).where(eq(orders.reference, reference)).limit(1);
      return row;
    },

    async findById(id) {
      const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      return row;
    },

    listItems(orderId) {
      return db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt));
    },

    listByCreator(creatorId) {
      return db.select().from(orders).where(eq(orders.creatorId, creatorId)).orderBy(desc(orders.createdAt));
    },

    async paidTotalsSince(creatorId, since) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int`, revenueIdr: sql<number>`coalesce(sum(${orders.totalIdr}), 0)::int` })
        .from(orders)
        .where(and(eq(orders.creatorId, creatorId), eq(orders.status, "paid"), gte(orders.createdAt, since)));
      return { count: row?.count ?? 0, revenueIdr: row?.revenueIdr ?? 0 };
    },

    async recordWebhookEvent(args) {
      // The unique (provider, event_id) index makes this the idempotency gate: a
      // replayed delivery inserts nothing and we report it as already handled.
      const inserted = await db
        .insert(paymentWebhookEvents)
        .values(args)
        .onConflictDoNothing()
        .returning({ id: paymentWebhookEvents.id });
      return inserted.length > 0;
    },

    async upsertPaymentTransaction(args) {
      await db
        .insert(paymentTransactions)
        .values(args)
        .onConflictDoUpdate({
          target: [paymentTransactions.provider, paymentTransactions.providerReference],
          set: {
            status: args.status,
            amountIdr: args.amountIdr,
            currency: args.currency,
            redirectUrl: args.redirectUrl,
            rawPayload: args.rawPayload,
            updatedAt: new Date(),
          },
        });
    },

    async applyStatus(args) {
      return db.transaction(async (tx) => {
        const [order] = await tx
          .update(orders)
          .set({ status: args.toStatus, paidAt: args.paidAt })
          .where(and(eq(orders.id, args.orderId), eq(orders.status, args.fromStatus)))
          .returning();
        if (!order) return undefined;

        if (args.toStatus === "paid") {
          const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, args.orderId));
          const entitlements = items
            .filter((item) => item.productId !== null)
            .map((item) => ({
              creatorId: order.creatorId,
              productId: item.productId as string,
              orderId: order.id,
              buyerEmail: order.buyerEmail,
            }));
          if (entitlements.length > 0) {
            await tx.insert(productEntitlements).values(entitlements).onConflictDoNothing();
          }
        }
        return order;
      });
    },

    listEntitlements(orderId) {
      return db.select().from(productEntitlements).where(eq(productEntitlements.orderId, orderId));
    },

    listEntitlementsByEmail(email) {
      return db
        .select()
        .from(productEntitlements)
        .where(eq(productEntitlements.buyerEmail, email))
        .orderBy(desc(productEntitlements.grantedAt));
    },

    async findEntitlementById(entitlementId) {
      const [row] = await db.select().from(productEntitlements).where(eq(productEntitlements.id, entitlementId)).limit(1);
      return row;
    },
  };
}

// Random, URL-safe order reference. 20 base-36 characters is ~103 bits, so it
// works as an unguessable bearer token for the buyer's confirmation page.
function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export interface CheckoutResult {
  order: Order;
  redirectUrl: string | null;
}

export interface WebhookResult {
  outcome: "processed" | "duplicate" | "ignored";
  order?: Order;
}

export interface OrderService {
  checkout(input: { creatorSlug: string; productSlug: string; buyerName: string; buyerEmail: string; buyerPhone?: string | null }): Promise<Result<CheckoutResult, OrderError>>;
  getByReference(reference: string): Promise<OrderWithItems | undefined>;
  listByCreator(creatorId: string): Promise<OrderWithItems[]>;
  // Paid totals since a date, read by the analytics domain through an injected
  // function so analytics never imports orders.
  paidTotalsSince(creatorId: string, since: Date): Promise<{ count: number; revenueIdr: number }>;
  listEntitlementsByEmail(email: string): Promise<ProductEntitlement[]>;
  // Verifies and applies a provider webhook. The provider is trusted to have
  // validated its own signature; everything else (amount, currency, order state)
  // is checked here.
  handleWebhook(payload: Record<string, unknown>): Promise<Result<WebhookResult, OrderError>>;
}

export function createOrderService(repository: OrderRepository, deps: OrderDeps, provider: PaymentProvider): OrderService {
  return {
    async checkout(input) {
      const parsed = createOrderSchema.safeParse({
        productSlug: input.productSlug,
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
        buyerPhone: input.buyerPhone,
      });
      if (!parsed.success) return fail("invalid_input");

      const product = await deps.findSellableProduct(input.creatorSlug, parsed.data.productSlug);
      if (!product) return fail("not_found");

      const reference = newReference();
      const order = await repository.create({
        creatorId: product.creatorId,
        reference,
        buyerName: parsed.data.buyerName,
        buyerEmail: parsed.data.buyerEmail,
        buyerPhone: parsed.data.buyerPhone ?? null,
        totalIdr: product.priceIdr,
      });
      await repository.addItem({
        orderId: order.id,
        productId: product.productId,
        productSlug: product.slug,
        title: product.title,
        unitPriceIdr: product.priceIdr,
      });

      // Free products skip the gateway entirely: the buyer is entitled right
      // away. Kept explicit so the paid path stays the only one that talks to a
      // provider.
      if (product.priceIdr === 0) {
        const paid = await repository.applyStatus({
          orderId: order.id,
          fromStatus: "pending",
          toStatus: "paid",
          paidAt: new Date(),
        });
        return ok({ order: paid ?? order, redirectUrl: null });
      }

      try {
        const intent = await provider.createPayment({
          orderReference: order.reference,
          amountIdr: product.priceIdr,
          buyer: { name: parsed.data.buyerName, email: parsed.data.buyerEmail, phone: parsed.data.buyerPhone ?? null },
          items: [{ title: product.title, quantity: 1, unitPriceIdr: product.priceIdr }],
        });
        await repository.upsertPaymentTransaction({
          orderId: order.id,
          provider: intent.provider,
          providerReference: intent.providerReference,
          status: "pending",
          amountIdr: product.priceIdr,
          currency: "IDR",
          redirectUrl: intent.redirectUrl,
          rawPayload: intent.raw,
        });
        return ok({ order, redirectUrl: intent.redirectUrl });
      } catch {
        // Leave the order pending: the provider may still have created a
        // transaction, and a later webhook can settle it. Orphans expire later.
        return fail("payment_unavailable");
      }
    },

    async getByReference(reference) {
      const order = await repository.findByReference(reference);
      if (!order) return undefined;
      return { order, items: await repository.listItems(order.id) };
    },

    async listByCreator(creatorId) {
      const rows = await repository.listByCreator(creatorId);
      return Promise.all(rows.map(async (order) => ({ order, items: await repository.listItems(order.id) })));
    },

    listEntitlementsByEmail(email) {
      return repository.listEntitlementsByEmail(email);
    },

    paidTotalsSince(creatorId, since) {
      return repository.paidTotalsSince(creatorId, since);
    },

    async handleWebhook(payload) {
      const notification = provider.parseNotification(payload);
      // A payload that fails signature verification is rejected outright; it is
      // never recorded, so a forged delivery cannot burn an event id.
      if (!notification) return fail("invalid_signature");

      const order = await repository.findByReference(notification.orderReference);
      if (!order) return ok({ outcome: "ignored" });

      // The amount and currency are checked against the stored order, never the
      // client, and before the event is recorded. Recording first would let a
      // signed-but-wrong delivery burn the idempotency key and block the
      // legitimate settlement that follows.
      if (notification.currency !== order.currency || notification.amountIdr !== order.totalIdr) {
        return fail("amount_mismatch");
      }

      const next = mapStatus(notification.status);
      if (!next) return ok({ outcome: "ignored" });

      // The unique (provider, event_id) index is the idempotency gate: a replay
      // inserts nothing and is reported as already handled.
      const fresh = await repository.recordWebhookEvent({
        provider: notification.provider,
        eventId: `${notification.provider}:${notification.providerReference}:${notification.status}`,
        eventType: notification.status,
        payload,
      });
      if (!fresh) return ok({ outcome: "duplicate" });

      await repository.upsertPaymentTransaction({
        orderId: order.id,
        provider: notification.provider,
        providerReference: notification.providerReference,
        status: notification.status,
        amountIdr: notification.amountIdr,
        currency: notification.currency,
        redirectUrl: null,
        rawPayload: notification.raw,
      });

      if (!canTransitionOrder(order.status, next)) {
        // Already in a terminal state, or an edge we do not allow. Nothing to do.
        return ok({ outcome: "ignored" });
      }

      const updated = await repository.applyStatus({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: next,
        paidAt: next === "paid" ? new Date() : order.paidAt,
      });
      // A concurrent webhook applied the same change first; treat as duplicate.
      if (!updated) return ok({ outcome: "duplicate" });

      return ok({ outcome: "processed", order: updated });
    },
  };
}

// Provider payment states map onto the coarser order states.
function mapStatus(status: PaymentStatus): OrderStatus | null {
  if (isPaymentPaid(status)) return "paid";
  if (isPaymentFailed(status)) return "failed";
  if (status === "refund") return "refunded";
  if (status === "pending") return null;
  return null;
}
