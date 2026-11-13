import { createFileRoute } from "@tanstack/react-router";
import { buildRobotsTxt } from "@biova/shared/seo";
import { getSiteUrl } from "../server/site";

// Served at /robots.txt (the [.] escapes the dot so the filename is not read as
// a flat-file route). It advertises the sitemap and disallows non-HTML endpoints
// only; private HTML pages carry their own `noindex` head instead, because a
// crawler blocked here would never read that directive.
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildRobotsTxt({ siteUrl: getSiteUrl() }), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
