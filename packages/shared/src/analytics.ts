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

export interface AnalyticsProductBreakdown {
  productId: string;
  title: string;
  views: number;
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
  links: AnalyticsLinkBreakdown[];
  products: AnalyticsProductBreakdown[];
}

// Click-through rate as a percentage. Defined in one place so the service and
// any future report agree on the rounding and the empty case.
export function clickThroughRate(linkClicks: number, pageViews: number): number {
  if (pageViews <= 0) return 0;
  return Math.round((linkClicks / pageViews) * 1000) / 10;
}
