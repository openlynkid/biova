import { createFileRoute } from "@tanstack/react-router";
import { listPublishedPages } from "@biova/core";
import { buildSitemapXml } from "@biova/shared/seo";
import { getServices } from "../server/services";
import { getSiteUrl } from "../server/site";

// Served at /sitemap.xml (the [.] escapes the dot so the filename is not read as
// a flat-file route). Lists the home page plus every published creator page;
// drafts and archived pages are excluded by the query.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const pages = await listPublishedPages(await getServices());
        const xml = buildSitemapXml({
          siteUrl: getSiteUrl(),
          entries: [{ path: "/" }, ...pages.map((page) => ({ path: `/${page.slug}`, lastModified: page.lastModified }))],
        });
        return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
      },
    },
  },
});
