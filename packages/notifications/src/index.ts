import { desc, eq, sql } from "drizzle-orm";
import { notificationOutbox } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import type { NotificationContext, NotificationKind } from "@biova/shared";
import { renderNotification, type RenderedNotification } from "./templates";

export * from "./templates";

export type NotificationRow = typeof notificationOutbox.$inferSelect;

// A message handed to the provider. The provider owns transport only: it is
// given the finished subject and bodies and is expected to throw on a failure it
// cannot retry itself.
export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// The transport port. An SMTP or API-backed driver implements this; the
// recording driver below stores messages so tests and local development need no
// network.
export interface NotificationProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<void>;
}

export interface NotificationRepository {
  // Inserts the outbox row unless its dedupe key already exists. Returns the row
  // when this call created it, or undefined when it was already queued: that is
  // the idempotency gate, the same pattern the webhook event table uses.
  enqueue(args: {
    creatorId: string;
    kind: NotificationKind;
    dedupeKey: string;
    recipientEmail: string;
    recipientName: string | null;
  }): Promise<NotificationRow | undefined>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  listByCreator(creatorId: string): Promise<NotificationRow[]>;
}

export function createNotificationRepository(db: Database): NotificationRepository {
  return {
    async enqueue(args) {
      const inserted = await db
        .insert(notificationOutbox)
        .values({
          creatorId: args.creatorId,
          kind: args.kind,
          dedupeKey: args.dedupeKey,
          recipientEmail: args.recipientEmail,
          recipientName: args.recipientName,
        })
        .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
        .returning();
      return inserted[0];
    },

    async markSent(id) {
      await db
        .update(notificationOutbox)
        .set({ status: "sent", sentAt: new Date(), attempts: attemptsIncrement(), lastError: null })
        .where(eq(notificationOutbox.id, id));
    },

    async markFailed(id, error) {
      await db
        .update(notificationOutbox)
        .set({ status: "failed", attempts: attemptsIncrement(), lastError: error.slice(0, 300) })
        .where(eq(notificationOutbox.id, id));
    },

    listByCreator(creatorId) {
      return db
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.creatorId, creatorId))
        .orderBy(desc(notificationOutbox.createdAt));
    },
  };
}

// `attempts` is bumped in SQL rather than read-modify-written, so two concurrent
// sends cannot lose a count.
function attemptsIncrement() {
  return sql`${notificationOutbox.attempts} + 1`;
}

// Who to notify about a paid order, and where to send them next. The creator
// contact arrives through an injected function so this domain never imports the
// creator domain.
export interface CreatorContact {
  email: string;
  displayName: string;
  slug: string;
}

export interface NotificationDeps {
  findCreatorContact(creatorId: string): Promise<CreatorContact | undefined>;
  // Absolute site origin for the links in a message. Read from configuration by
  // the composition root, never from a request.
  siteUrl: string;
}

// What the orders domain hands over when an order becomes paid. It carries no
// database rows, only the values a template needs, so notifications never reads
// the orders tables.
export interface OrderPaidInput {
  creatorId: string;
  orderReference: string;
  buyerName: string;
  buyerEmail: string;
  totalIdr: number;
  currency: string;
  items: string[];
}

export interface NotificationService {
  // Sends the buyer receipt and the creator sale alert for a paid order. Never
  // throws: a notification failure must not fail the payment that triggered it.
  notifyOrderPaid(input: OrderPaidInput): Promise<void>;
  listByCreator(creatorId: string): Promise<NotificationRow[]>;
}

export function createNotificationService(
  repository: NotificationRepository,
  provider: NotificationProvider,
  deps: NotificationDeps,
): NotificationService {
  const siteUrl = deps.siteUrl.replace(/\/+$/, "");

  async function deliver(args: {
    creatorId: string;
    kind: NotificationKind;
    dedupeKey: string;
    recipientEmail: string;
    recipientName: string | null;
    message: RenderedNotification;
  }): Promise<void> {
    // The dedupe key makes a replayed webhook a no-op: the row is not created a
    // second time, so the recipient is not mailed twice.
    const row = await repository.enqueue({
      creatorId: args.creatorId,
      kind: args.kind,
      dedupeKey: args.dedupeKey,
      recipientEmail: args.recipientEmail,
      recipientName: args.recipientName,
    });
    if (!row) return;

    try {
      await provider.send({
        to: args.recipientEmail,
        subject: args.message.subject,
        text: args.message.text,
        html: args.message.html,
      });
      await repository.markSent(row.id);
    } catch (error) {
      // Recorded, not thrown: the order is already paid and must stay paid. The
      // row keeps the failure so a later sweep can see what did not go out.
      await repository.markFailed(row.id, error instanceof Error ? error.message : "send_failed");
    }
  }

  return {
    async notifyOrderPaid(input) {
      const creator = await deps.findCreatorContact(input.creatorId);
      // Without a creator contact there is nobody to alert and no name for the
      // buyer's receipt; the paid order still stands.
      if (!creator) return;

      const context: NotificationContext = {
        orderReference: input.orderReference,
        creatorSlug: creator.slug,
        creatorName: creator.displayName,
        buyerName: input.buyerName,
        totalIdr: input.totalIdr,
        currency: input.currency,
        items: input.items,
        actionUrl: `${siteUrl}/order/${input.orderReference}`,
      };

      await deliver({
        creatorId: input.creatorId,
        kind: "order_paid",
        // One receipt per order, keyed by the order so a replay cannot resend it.
        dedupeKey: `order_paid:${input.orderReference}`,
        recipientEmail: input.buyerEmail,
        recipientName: input.buyerName,
        message: renderNotification("order_paid", context),
      });

      await deliver({
        creatorId: input.creatorId,
        kind: "sale",
        dedupeKey: `sale:${input.orderReference}`,
        recipientEmail: creator.email,
        recipientName: creator.displayName,
        message: renderNotification("sale", { ...context, actionUrl: `${siteUrl}/dashboard` }),
      });
    },

    listByCreator(creatorId) {
      return repository.listByCreator(creatorId);
    },
  };
}

export interface SentMessage extends OutboundMessage {
  provider: string;
  sentAt: number;
}

// Records every message instead of sending it. Local development and tests use
// this so no mail leaves the process; the recorded list is inspectable.
export function createRecordingProvider(name = "recording"): NotificationProvider & { messages: SentMessage[] } {
  const messages: SentMessage[] = [];
  return {
    name,
    messages,
    async send(message) {
      messages.push({ ...message, provider: name, sentAt: Date.now() });
    },
  };
}

// Fails every send. Used by tests to prove a provider outage is recorded on the
// outbox row and never propagates to the caller.
export function createFailingProvider(message = "provider_unavailable"): NotificationProvider {
  return {
    name: "failing",
    async send() {
      throw new Error(message);
    },
  };
}
