import { describe, expect, test } from "bun:test";
import {
  absoluteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  creatorPageJsonLd,
  escapeXml,
  personJsonLd,
  productJsonLd,
} from "./seo";

describe("absoluteUrl", () => {
  test("joins without doubling or dropping slashes", () => {
    expect(absoluteUrl("https://biova.id", "/alice")).toBe("https://biova.id/alice");
    expect(absoluteUrl("https://biova.id/", "alice")).toBe("https://biova.id/alice");
    expect(absoluteUrl("https://biova.id", "/")).toBe("https://biova.id");
  });
});

describe("escapeXml", () => {
  test("escapes the five XML entities", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });
});

describe("sitemap", () => {
  test("lists every entry and only emits lastmod when known", () => {
    const xml = buildSitemapXml({
      siteUrl: "https://biova.id",
      entries: [
        { path: "/" },
        { path: "/alice", lastModified: new Date("2026-01-02T03:04:05.000Z") },
      ],
    });
    expect(xml).toContain('<url><loc>https://biova.id</loc></url>');
    expect(xml).toContain('<url><loc>https://biova.id/alice</loc><lastmod>2026-01-02T03:04:05.000Z</lastmod></url>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  test("escapes a slug so it cannot close a tag early", () => {
    const xml = buildSitemapXml({ siteUrl: "https://biova.id", entries: [{ path: "/a&b<c" }] });
    expect(xml).toContain("https://biova.id/a&amp;b&lt;c");
    expect(xml).not.toContain("<c</loc>");
  });
});

describe("robots", () => {
  test("allows everything, blocks non-HTML endpoints and points at the sitemap", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://biova.id/" });
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Disallow: /api/");
    expect(txt).toContain("Disallow: /download/");
    expect(txt).toContain("Sitemap: https://biova.id/sitemap.xml");
  });

  test("does not disallow a private HTML page, so its noindex tag is readable", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://biova.id" });
    expect(txt).not.toContain("Disallow: /dashboard");
    expect(txt).not.toContain("Disallow: /checkout/");
  });

  test("honours a custom disallow list", () => {
    const txt = buildRobotsTxt({ siteUrl: "https://biova.id", disallow: ["/secret"] });
    expect(txt).toContain("Disallow: /secret");
    expect(txt).not.toContain("/dashboard");
  });
});

describe("structured data", () => {
  test("person node omits an absent description", () => {
    expect(personJsonLd({ name: "Alice", url: "https://biova.id/alice" })).toEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Alice",
      url: "https://biova.id/alice",
    });
  });

  test("product offer is IDR and in stock", () => {
    const node = productJsonLd({ name: "Pack", url: "https://biova.id/checkout/alice/pack", priceIdr: 25_000 });
    expect(node.offers).toEqual({
      "@type": "Offer",
      price: "25000.00",
      priceCurrency: "IDR",
      availability: "https://schema.org/InStock",
    });
  });

  test("creator page with no products is a bare person graph", () => {
    const graph = creatorPageJsonLd({ name: "Alice", url: "https://biova.id/alice", products: [] });
    expect(graph["@type"]).toBe("Person");
    expect(graph["@graph"]).toBeUndefined();
  });

  test("creator page with products nests an ItemList", () => {
    const graph = creatorPageJsonLd({
      name: "Alice",
      url: "https://biova.id/alice",
      products: [{ name: "Pack", url: "https://biova.id/checkout/alice/pack", priceIdr: 1000 }],
    });
    const list = (graph["@graph"] as unknown[])[1] as Record<string, unknown>;
    expect(list["@type"]).toBe("ItemList");
    expect(list.numberOfItems).toBe(1);
  });
});
