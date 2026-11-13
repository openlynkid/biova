// Pure, framework-agnostic SEO builders. Kept free of `readEnv` and any Node or
// Bun global so the browser bundle can import this module through the
// `@biova/shared/seo` subpath (the barrel pulls in `./env`, which touches
// `process`).

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

// Sitemap and structured-data values are creator-supplied (display name, bio,
// slug), so every interpolation into XML is escaped. Without this a bio
// containing `</url>` could close a tag early.
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

// Joins a site origin with a path, tolerating either side's slashes so callers
// do not have to agree on trailing-slash conventions.
export function absoluteUrl(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return suffix ? `${base}/${suffix}` : base;
}

export interface SitemapEntry {
  path: string;
  // Omitted when unknown, in which case no <lastmod> is emitted rather than a
  // misleading "now".
  lastModified?: Date | null;
}

export interface SitemapOptions {
  siteUrl: string;
  entries: SitemapEntry[];
}

// Minimal sitemap: only <loc> and <lastmod>, which is all a crawler needs and
// all we can state truthfully. Values are XML-escaped and the date is emitted as
// a W3C date-time, the format the sitemap spec expects.
export function buildSitemapXml({ siteUrl, entries }: SitemapOptions): string {
  const urls = entries.map((entry) => {
    const loc = escapeXml(absoluteUrl(siteUrl, entry.path));
    const lastmod = entry.lastModified
      ? `<lastmod>${escapeXml(entry.lastModified.toISOString())}</lastmod>`
      : "";
    return `  <url><loc>${loc}</loc>${lastmod}</url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export interface RobotsOptions {
  siteUrl: string;
  sitemapPath?: string;
  // Only non-HTML endpoints are disallowed here. Private HTML pages (dashboard,
  // checkout, order) are allowed to be crawled but carry a `noindex` meta tag
  // instead: a crawler that is blocked by robots.txt never reads the directive,
  // so a disallowed URL can still be indexed from inbound links.
  disallow?: string[];
}

export const DEFAULT_DISALLOW = ["/api/", "/download/"];

export function buildRobotsTxt({ siteUrl, sitemapPath = "/sitemap.xml", disallow = DEFAULT_DISALLOW }: RobotsOptions): string {
  const lines = ["User-agent: *", "Allow: /", ...disallow.map((path) => `Disallow: ${path}`), "", `Sitemap: ${absoluteUrl(siteUrl, sitemapPath)}`, ""];
  return lines.join("\n");
}

export interface PersonJsonLdInput {
  name: string;
  url: string;
  description?: string | null;
}

// schema.org Person for a creator page. Returned as a plain object so the
// caller can hand it to TanStack Router's `script:ld+json` meta slot, which
// serializes and escapes it.
export function personJsonLd({ name, url, description }: PersonJsonLdInput): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
    url,
    ...(description ? { description } : {}),
  };
}

export interface ProductJsonLdInput {
  name: string;
  url: string;
  priceIdr: number;
  description?: string | null;
}

// A product offer. `priceCurrency` is IDR because prices are stored as whole
// rupiah (ADR-0007), and the price is emitted with two decimals as schema.org
// expects for a monetary amount.
export function productJsonLd({ name, url, priceIdr, description }: ProductJsonLdInput): Record<string, unknown> {
  return {
    "@type": "Product",
    name,
    url,
    ...(description ? { description } : {}),
    offers: {
      "@type": "Offer",
      price: priceIdr.toFixed(2),
      priceCurrency: "IDR",
      availability: "https://schema.org/InStock",
    },
  };
}

export interface CreatorPageJsonLdInput {
  name: string;
  url: string;
  description?: string | null;
  products: ProductJsonLdInput[];
}

// One graph per creator page: the person plus, when present, an ItemList of
// their published products. Emitting the products as an ItemList (rather than
// bare Product nodes) keeps the person as the page's main entity.
export function creatorPageJsonLd({ name, url, description, products }: CreatorPageJsonLdInput): Record<string, unknown> {
  const person = personJsonLd({ name, url, description });
  if (products.length === 0) return person;

  return {
    "@context": "https://schema.org",
    "@graph": [
      { ...person, "@context": undefined },
      {
        "@type": "ItemList",
        numberOfItems: products.length,
        itemListElement: products.map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: productJsonLd(product),
        })),
      },
    ],
  };
}
