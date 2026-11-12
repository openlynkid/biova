import { trackPublicEvent } from "./server/public-page";

const VISITOR_KEY = "biova.visitor";

// Anonymous, browser-local visitor id. Random and opaque: it lets repeat views
// from one browser count as one visitor without storing anything that points at
// a person. Regenerated only when storage is unavailable or was cleared.
export function getVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID().replace(/-/g, "");
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID().replace(/-/g, "");
  }
}

// Fire-and-forget. Tracking must never break the page, so every failure is
// swallowed and the caller is not awaited.
export function trackEvent(input: {
  slug: string;
  type: "page_view" | "link_click" | "product_view";
  path?: string;
  linkId?: string;
  productId?: string;
}): void {
  void trackPublicEvent({ data: { ...input, visitorId: getVisitorId() } }).catch(() => {});
}
