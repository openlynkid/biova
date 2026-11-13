import { and, count, countDistinct, eq, gte, sql, type AnyColumn } from "drizzle-orm";
import { linkClickEvents, pageViewEvents, productViewEvents } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import {
  averageOrderValue,
  buildDailySeries,
  clickThroughRate,
  conversionRate,
  seriesWindow,
  trackEventSchema,
  type AnalyticsRange,
  type AnalyticsSummary,
  type AnalyticsTimeseries,
  type DailyCount,
  type DailyRevenue,
  type ProductRevenue,
  type Result,
  ok,
  fail,
} from "@biova/shared";

// Every event table is bucketed by the same expression, so the three daily
// series line up on the same calendar days.
const utcDay = (column: AnyColumn) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;

export type PageViewEvent = typeof pageViewEvents.$inferSelect;
export type LinkClickEvent = typeof linkClickEvents.$inferSelect;
export type ProductViewEvent = typeof productViewEvents.$inferSelect;

export type AnalyticsError = "invalid_input" | "not_found";

export interface LinkClicks {
  linkId: string;
  clicks: number;
}

export interface ProductViews {
  productId: string;
  views: number;
}

// The read/write surface over the raw event tables. Every method is a plain
// query; the service is where the rules live.
export interface AnalyticsRepository {
  recordPageView(args: { creatorId: string; visitorId: string; path: string }): Promise<void>;
  recordLinkClick(args: { creatorId: string; linkId: string; visitorId: string }): Promise<void>;
  recordProductView(args: { creatorId: string; productId: string; visitorId: string }): Promise<void>;
  countPageViews(creatorId: string, since: Date): Promise<number>;
  countUniqueVisitors(creatorId: string, since: Date): Promise<number>;
  countLinkClicks(creatorId: string, since: Date): Promise<number>;
  countProductViews(creatorId: string, since: Date): Promise<number>;
  pageViewsByDay(creatorId: string, since: Date): Promise<DailyCount[]>;
  linkClicksByDay(creatorId: string, since: Date): Promise<DailyCount[]>;
  productViewsByDay(creatorId: string, since: Date): Promise<DailyCount[]>;
  linkClicksByLink(creatorId: string, since: Date): Promise<LinkClicks[]>;
  productViewsByProduct(creatorId: string, since: Date): Promise<ProductViews[]>;
}

export function createAnalyticsRepository(db: Database): AnalyticsRepository {
  return {
    async recordPageView(args) {
      await db.insert(pageViewEvents).values(args);
    },
    async recordLinkClick(args) {
      await db.insert(linkClickEvents).values(args);
    },
    async recordProductView(args) {
      await db.insert(productViewEvents).values(args);
    },

    async countPageViews(creatorId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(pageViewEvents)
        .where(and(eq(pageViewEvents.creatorId, creatorId), gte(pageViewEvents.createdAt, since)));
      return row?.value ?? 0;
    },
    async countUniqueVisitors(creatorId, since) {
      const [row] = await db
        .select({ value: countDistinct(pageViewEvents.visitorId) })
        .from(pageViewEvents)
        .where(and(eq(pageViewEvents.creatorId, creatorId), gte(pageViewEvents.createdAt, since)));
      return row?.value ?? 0;
    },
    async countLinkClicks(creatorId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(linkClickEvents)
        .where(and(eq(linkClickEvents.creatorId, creatorId), gte(linkClickEvents.createdAt, since)));
      return row?.value ?? 0;
    },
    async countProductViews(creatorId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(productViewEvents)
        .where(and(eq(productViewEvents.creatorId, creatorId), gte(productViewEvents.createdAt, since)));
      return row?.value ?? 0;
    },

    pageViewsByDay(creatorId, since) {
      return db
        .select({ date: utcDay(pageViewEvents.createdAt), count: count() })
        .from(pageViewEvents)
        .where(and(eq(pageViewEvents.creatorId, creatorId), gte(pageViewEvents.createdAt, since)))
        .groupBy(sql`1`);
    },
    linkClicksByDay(creatorId, since) {
      return db
        .select({ date: utcDay(linkClickEvents.createdAt), count: count() })
        .from(linkClickEvents)
        .where(and(eq(linkClickEvents.creatorId, creatorId), gte(linkClickEvents.createdAt, since)))
        .groupBy(sql`1`);
    },
    productViewsByDay(creatorId, since) {
      return db
        .select({ date: utcDay(productViewEvents.createdAt), count: count() })
        .from(productViewEvents)
        .where(and(eq(productViewEvents.creatorId, creatorId), gte(productViewEvents.createdAt, since)))
        .groupBy(sql`1`);
    },

    linkClicksByLink(creatorId, since) {
      return db
        .select({ linkId: linkClickEvents.linkId, clicks: count() })
        .from(linkClickEvents)
        .where(and(eq(linkClickEvents.creatorId, creatorId), gte(linkClickEvents.createdAt, since)))
        .groupBy(linkClickEvents.linkId);
    },
    productViewsByProduct(creatorId, since) {
      return db
        .select({ productId: productViewEvents.productId, views: count() })
        .from(productViewEvents)
        .where(and(eq(productViewEvents.creatorId, creatorId), gte(productViewEvents.createdAt, since)))
        .groupBy(productViewEvents.productId);
    },
  };
}

// Titles and the paid-order totals come from other domains through injected
// functions, so analytics never imports links, products or orders.
export interface AnalyticsDeps {
  listLinks(creatorId: string): Promise<{ id: string; title: string }[]>;
  listProducts(creatorId: string): Promise<{ id: string; title: string }[]>;
  paidOrders(creatorId: string, since: Date): Promise<{ count: number; revenueIdr: number }>;
  paidRevenueByDay(creatorId: string, since: Date): Promise<DailyRevenue[]>;
  paidRevenueByProduct(creatorId: string, since: Date): Promise<ProductRevenue[]>;
}

export interface AnalyticsService {
  track(input: {
    creatorId: string;
    type: string;
    visitorId: string;
    path?: string;
    linkId?: string;
    productId?: string;
  }): Promise<Result<{ recorded: true }, AnalyticsError>>;
  summary(creatorId: string, range: AnalyticsRange): Promise<AnalyticsSummary>;
  timeseries(creatorId: string, range: AnalyticsRange): Promise<AnalyticsTimeseries>;
}

export function createAnalyticsService(
  repository: AnalyticsRepository,
  deps: AnalyticsDeps,
  options: { now?: () => number } = {},
): AnalyticsService {
  const now = options.now ?? Date.now;

  // The summary and the daily chart share one window definition: the last N
  // calendar days in UTC, ending today. Deriving both from `seriesWindow` means
  // the daily buckets always add up to the summary totals, instead of the chart
  // describing a slightly wider span than the numbers above it.
  function windowFor(range: AnalyticsRange): { since: Date; days: string[] } {
    return seriesWindow(range, new Date(now()));
  }

  return {
    async track(input) {
      const parsed = trackEventSchema.safeParse(input);
      if (!parsed.success) return fail("invalid_input");
      const event = parsed.data;

      if (event.type === "page_view") {
        await repository.recordPageView({
          creatorId: input.creatorId,
          visitorId: event.visitorId,
          path: event.path ?? "/",
        });
        return ok({ recorded: true as const });
      }

      if (event.type === "link_click") {
        // The link must belong to the creator whose page served the click, so a
        // forged id cannot attach clicks to another creator's link.
        const links = await deps.listLinks(input.creatorId);
        if (!links.some((link) => link.id === event.linkId)) return fail("not_found");
        await repository.recordLinkClick({
          creatorId: input.creatorId,
          linkId: event.linkId as string,
          visitorId: event.visitorId,
        });
        return ok({ recorded: true as const });
      }

      const products = await deps.listProducts(input.creatorId);
      if (!products.some((product) => product.id === event.productId)) return fail("not_found");
      await repository.recordProductView({
        creatorId: input.creatorId,
        productId: event.productId as string,
        visitorId: event.visitorId,
      });
      return ok({ recorded: true as const });
    },

    async summary(creatorId, range) {
      const { since: from } = windowFor(range);
      const [pageViews, uniqueVisitors, linkClicks, productViews, clicksByLink, viewsByProduct, orders, revenueByProduct, links, products] =
        await Promise.all([
          repository.countPageViews(creatorId, from),
          repository.countUniqueVisitors(creatorId, from),
          repository.countLinkClicks(creatorId, from),
          repository.countProductViews(creatorId, from),
          repository.linkClicksByLink(creatorId, from),
          repository.productViewsByProduct(creatorId, from),
          deps.paidOrders(creatorId, from),
          deps.paidRevenueByProduct(creatorId, from),
          deps.listLinks(creatorId),
          deps.listProducts(creatorId),
        ]);

      const clicks = new Map(clicksByLink.map((row) => [row.linkId, row.clicks]));
      const views = new Map(viewsByProduct.map((row) => [row.productId, row.views]));
      const sales = new Map(revenueByProduct.map((row) => [row.productId, row]));

      return {
        range,
        pageViews,
        uniqueVisitors,
        linkClicks,
        clickThroughRate: clickThroughRate(linkClicks, pageViews),
        productViews,
        orders: orders.count,
        revenueIdr: orders.revenueIdr,
        averageOrderValueIdr: averageOrderValue(orders.revenueIdr, orders.count),
        conversionRate: conversionRate(orders.count, productViews),
        links: links.map((link) => ({ linkId: link.id, title: link.title, clicks: clicks.get(link.id) ?? 0 })),
        products: products.map((product) => {
          const sold = sales.get(product.id);
          const productViewCount = views.get(product.id) ?? 0;
          return {
            productId: product.id,
            title: product.title,
            views: productViewCount,
            orders: sold?.count ?? 0,
            revenueIdr: sold?.revenueIdr ?? 0,
            conversionRate: conversionRate(sold?.count ?? 0, productViewCount),
          };
        }),
      };
    },

    async timeseries(creatorId, range) {
      const { since: from, days } = windowFor(range);
      const [pageViews, linkClicks, productViews, orders] = await Promise.all([
        repository.pageViewsByDay(creatorId, from),
        repository.linkClicksByDay(creatorId, from),
        repository.productViewsByDay(creatorId, from),
        deps.paidRevenueByDay(creatorId, from),
      ]);
      return buildDailySeries({ range, days, pageViews, linkClicks, productViews, orders });
    },
  };
}
