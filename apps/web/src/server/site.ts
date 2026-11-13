import { readEnv } from "@biova/shared";

// Public origin used for absolute URLs (canonical tags, sitemap, robots). It has
// to be the real site origin, not the request host, so a page served from a
// preview or tunnel does not publish that host as canonical. APP_URL is the
// single source of truth; the local default keeps development working.
export function getSiteUrl(): string {
  return readEnv("APP_URL") ?? "http://localhost:3000";
}
