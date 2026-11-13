import { z } from "zod";

// Raw event kinds the public page reports. Kept as a small closed set so the
// ingest route cannot be used to write arbitrary rows.
export const analyticsEventTypeSchema = z.enum(["page_view", "link_click", "product_view"]);
export type AnalyticsEventType = z.infer<typeof analyticsEventTypeSchema>;

// A visitor id is minted by the browser and kept in local storage, so the same
// visitor is counted once without storing an IP or any other identifier that
// points at a person. It is constrained to a URL-safe token.
export const visitorIdSchema = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

// One event as sent by the public page. `linkId`/`productId` are required by the
// matching event type and rejected otherwise, so a page_view cannot smuggle a
// link id and a click cannot be recorded against a product.
export const trackEventSchema = z
  .object({
    type: analyticsEventTypeSchema,
    visitorId: visitorIdSchema,
    path: z.string().trim().min(1).max(255).optional(),
    linkId: z.uuid().optional(),
    productId: z.uuid().optional(),
  })
  .refine((event) => event.type !== "link_click" || event.linkId !== undefined, {
    message: "link_click requires linkId",
    path: ["linkId"],
  })
  .refine((event) => event.type !== "product_view" || event.productId !== undefined, {
    message: "product_view requires productId",
    path: ["productId"],
  });

export type TrackEventInput = z.infer<typeof trackEventSchema>;

// How far back the dashboard summary looks. A closed set keeps the query
// bounded; the UI offers these as a segmented control.
export const analyticsRangeSchema = z.enum(["7d", "30d", "90d"]);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

export const ANALYTICS_RANGE_DAYS: Record<AnalyticsRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

// The aggregate read the dashboard renders. Every field is derived from the raw
// event rows at query time (plus the paid-order totals passed in by the orders
// domain), so nothing here is a stored counter that a second writer could drift.
export interface AnalyticsLinkBreakdown {
  linkId: string;
  title: string;
  clicks: number;
}

// One product's share of the window: how often its card was viewed, how many
// paid orders it brought in, and the money those orders were worth. The
// conversion rate ties views to orders so the creator can see which product
// earns its traffic.
export interface AnalyticsProductBreakdown {
  productId: string;
  title: string;
  views: number;
  orders: number;
  revenueIdr: number;
  // Orders per view, as a percentage rounded to one decimal. Zero when there
  // are no views.
  conversionRate: number;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  pageViews: number;
  uniqueVisitors: number;
  linkClicks: number;
  // Clicks per page view, as a percentage rounded to one decimal. Zero when
  // there are no views, so the UI never divides by zero.
  clickThroughRate: number;
  productViews: number;
  orders: number;
  revenueIdr: number;
  // Revenue per paid order, in whole rupiah. Zero when there are no paid orders.
  averageOrderValueIdr: number;
  // Product views that became a paid order, as a percentage rounded to one
  // decimal. The page-level funnel: views, then orders.
  conversionRate: number;
  links: AnalyticsLinkBreakdown[];
  products: AnalyticsProductBreakdown[];
}

// Click-through rate as a percentage. Defined in one place so the service and
// any future report agree on the rounding and the empty case.
export function clickThroughRate(linkClicks: number, pageViews: number): number {
  if (pageViews <= 0) return 0;
  return Math.round((linkClicks / pageViews) * 1000) / 10;
}

// A ratio of two counts as a percentage, rounded to one decimal. Shared by the
// page-level funnel and the per-product conversion so both round the same way
// and both answer zero rather than dividing by zero.
export function conversionRate(conversions: number, opportunities: number): number {
  if (opportunities <= 0) return 0;
  return Math.round((conversions / opportunities) * 1000) / 10;
}

// Revenue per order in whole rupiah. Rupiah has no minor unit, so the mean is
// rounded to the nearest rupiah rather than kept as a fraction.
export function averageOrderValue(revenueIdr: number, orders: number): number {
  if (orders <= 0) return 0;
  return Math.round(revenueIdr / orders);
}

// A daily bucket. The date is a UTC calendar day (YYYY-MM-DD); events are
// bucketed by UTC day on both the write and the read side, so a bucket never
// straddles midnight for one reader and not another.
export interface AnalyticsDayPoint {
  date: string;
  pageViews: number;
  linkClicks: number;
  productViews: number;
  orders: number;
  revenueIdr: number;
}

// The per-day breakdown behind the dashboard trend chart. `days` is dense: a
// calendar day with no events is present with zeroes, so the chart has no gaps.
export interface AnalyticsTimeseries {
  range: AnalyticsRange;
  days: AnalyticsDayPoint[];
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface DailyRevenue {
  date: string;
  count: number;
  revenueIdr: number;
}

// Paid orders and revenue for one product over the window, for the per-product
// conversion breakdown. Products with no sales are absent, so the reader fills
// them in as zero.
export interface ProductRevenue {
  productId: string;
  count: number;
  revenueIdr: number;
}

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The calendar days a range covers, oldest first, ending on the current UTC day.
// A range of N days is N buckets including today, so "7d" is today plus the six
// days before it rather than a rolling 168-hour window: a chart of calendar days
// should align to midnight, not to the moment the page was loaded.
export function seriesWindow(range: AnalyticsRange, now: Date): { since: Date; days: string[] } {
  const span = ANALYTICS_RANGE_DAYS[range];
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days: string[] = [];
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    days.push(utcDayKey(new Date(todayUtc - offset * 86_400_000)));
  }
  return { since: new Date(`${days[0]}T00:00:00.000Z`), days };
}

// Merges the per-day rows from each event table into one dense series. Kept pure
// and clock-free so the gap-filling and the "unknown day is zero" rule are
// covered by a unit test rather than by a live database.
export function buildDailySeries(input: {
  range: AnalyticsRange;
  days: string[];
  pageViews: DailyCount[];
  linkClicks: DailyCount[];
  productViews: DailyCount[];
  orders: DailyRevenue[];
}): AnalyticsTimeseries {
  const pageViews = new Map(input.pageViews.map((row) => [row.date, row.count]));
  const linkClicks = new Map(input.linkClicks.map((row) => [row.date, row.count]));
  const productViews = new Map(input.productViews.map((row) => [row.date, row.count]));
  const orders = new Map(input.orders.map((row) => [row.date, row]));

  return {
    range: input.range,
    days: input.days.map((date) => {
      const paid = orders.get(date);
      return {
        date,
        pageViews: pageViews.get(date) ?? 0,
        linkClicks: linkClicks.get(date) ?? 0,
        productViews: productViews.get(date) ?? 0,
        orders: paid?.count ?? 0,
        revenueIdr: paid?.revenueIdr ?? 0,
      };
    }),
  };
}
