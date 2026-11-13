import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { escapeHtml } from "@biova/shared";
import {
  createFailingProvider,
  createNotificationRepository,
  createNotificationService,
  createRecordingProvider,
  renderNotification,
  type NotificationService,
} from "./index";

const SITE = "https://biova.test";

let context: TestDatabase;
let service: NotificationService;
let provider: ReturnType<typeof createRecordingProvider>;
let creatorId: string;
let creatorEmail: string;

beforeAll(async () => {
  context = await createTestDatabase();
  const user = await createTestUser(context.db);
  creatorEmail = user.email;
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "seller", displayName: "Seller" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;

  provider = createRecordingProvider();
  service = createNotificationService(createNotificationRepository(context.db), provider, {
    async findCreatorContact(id) {
      if (id !== creatorId) return undefined;
      const contact = await creators.getContactById(id);
      return contact ? { email: contact.email, displayName: contact.displayName, slug: contact.slug } : undefined;
    },
    siteUrl: SITE,
  });
});

afterAll(async () => {
  await context.close();
});

function paidOrder(overrides: Record<string, unknown> = {}) {
  return {
    creatorId,
    orderReference: "REF-1",
    buyerName: "Budi",
    buyerEmail: "budi@example.com",
    totalIdr: 49000,
    currency: "IDR",
    items: ["Preset Lightroom Moody"],
    ...overrides,
  };
}

describe("notification templates", () => {
  test("renders a buyer receipt and a creator sale alert from one context", () => {
    const context = {
      orderReference: "REF-1",
      creatorSlug: "seller",
      creatorName: "Seller",
      buyerName: "Budi",
      totalIdr: 49000,
      currency: "IDR",
      items: ["Preset Lightroom Moody"],
      actionUrl: `${SITE}/order/REF-1`,
    };

    const receipt = renderNotification("order_paid", context);
    expect(receipt.subject).toContain("Seller");
    expect(receipt.text).toContain("Preset Lightroom Moody");
    expect(receipt.text).toContain("Rp49.000");
    expect(receipt.html).toContain(`${SITE}/order/REF-1`);

    const sale = renderNotification("sale", context);
    expect(sale.subject).toContain("Rp49.000");
    expect(sale.html).toContain("Preset Lightroom Moody");
  });

  test("escapes a hostile buyer name so it cannot inject markup", () => {
    const rendered = renderNotification("order_paid", {
      orderReference: "REF-1",
      creatorSlug: "seller",
      creatorName: "Seller",
      buyerName: '<img src=x onerror="alert(1)">',
      totalIdr: 0,
      currency: "IDR",
      items: ["<script>bad()</script>"],
      actionUrl: `${SITE}/order/REF-1`,
    });
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;img");
  });
});

describe("escapeHtml", () => {
  test("escapes the five XML-significant characters", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("notification service", () => {
  test("sends a receipt to the buyer and an alert to the creator", async () => {
    await service.notifyOrderPaid(paidOrder());
    expect(provider.messages).toHaveLength(2);
    const recipients = provider.messages.map((message) => message.to).sort();
    expect(recipients).toEqual([creatorEmail, "budi@example.com"].sort());

    const rows = await service.listByCreator(creatorId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "sent")).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
  });

  test("does not send the same order twice", async () => {
    const before = provider.messages.length;
    await service.notifyOrderPaid(paidOrder());
    expect(provider.messages).toHaveLength(before);
    const rows = await service.listByCreator(creatorId);
    expect(rows).toHaveLength(2);
  });

  test("records a provider failure on the row and never throws", async () => {
    const failing = createNotificationService(createNotificationRepository(context.db), createFailingProvider("boom"), {
      async findCreatorContact() {
        return { email: "seller@example.com", displayName: "Seller", slug: "seller" };
      },
      siteUrl: SITE,
    });

    await failing.notifyOrderPaid(paidOrder({ orderReference: "REF-2" }));
    const rows = await failing.listByCreator(creatorId);
    const failed = rows.filter((row) => row.dedupeKey.includes("REF-2"));
    expect(failed).toHaveLength(2);
    expect(failed.every((row) => row.status === "failed")).toBe(true);
    expect(failed.every((row) => row.lastError === "boom")).toBe(true);
  });

  test("does nothing when the creator contact cannot be resolved", async () => {
    const orphan = createNotificationService(createNotificationRepository(context.db), provider, {
      async findCreatorContact() {
        return undefined;
      },
      siteUrl: SITE,
    });
    const before = provider.messages.length;
    await orphan.notifyOrderPaid(paidOrder({ orderReference: "REF-3" }));
    expect(provider.messages).toHaveLength(before);
  });
});
