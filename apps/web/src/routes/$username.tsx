import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { formatPriceIdr } from "@biova/shared/product";
import { absoluteUrl, creatorPageJsonLd } from "@biova/shared/seo";
import { getPublicPage } from "../server/public-page";
import { PluginBlocks } from "../plugin-blocks";
import { trackEvent } from "../tracking";

export const Route = createFileRoute("/$username")({
  loader: async ({ params }) => {
    const page = await getPublicPage({ data: { slug: params.username } });
    if (!page) throw notFound();
    return page;
  },
  // Absolute canonical and Open Graph URLs are built from the configured site
  // origin (not the request host), so a page served from a preview or tunnel
  // does not advertise that host as canonical. The `script:ld+json` slot is
  // serialized and escaped by the router's head renderer.
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Not found · Biova" }, { name: "robots", content: "noindex" }] };
    const { creator, siteUrl, products, branding } = loaderData;
    const url = absoluteUrl(siteUrl, `/${creator.slug}`);
    const description = creator.bio ?? `${creator.displayName} on Biova`;
    return {
      meta: [
        { title: `${creator.displayName} · Biova` },
        { name: "description", content: description },
        { property: "og:title", content: creator.displayName },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: url },
        { property: "og:site_name", content: "Biova" },
        ...(branding?.cover || branding?.avatar
          ? [{ property: "og:image", content: absoluteUrl(siteUrl, (branding.cover ?? branding.avatar) as string) }]
          : []),
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: creator.displayName },
        { name: "twitter:description", content: description },
        {
          "script:ld+json": creatorPageJsonLd({
            name: creator.displayName,
            url,
            description: creator.bio,
            products: products.map((product) => ({
              name: product.title,
              url: absoluteUrl(siteUrl, `/checkout/${creator.slug}/${product.slug}`),
              priceIdr: product.priceIdr,
              description: product.description,
            })),
          }),
        },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: PublicPage,
  notFoundComponent: NotFound,
});

function themeStyle(theme: { accent?: string; background?: string; textColor?: string }) {
  const style: Record<string, string> = {};
  if (theme.accent) style["--page-accent"] = theme.accent;
  if (theme.background) style["--page-bg"] = theme.background;
  if (theme.textColor) style["--page-text"] = theme.textColor;
  return style as React.CSSProperties;
}

function PublicPage() {
  const { creator, page, links, products, blocks, branding } = Route.useLoaderData();
  const theme = page.theme ?? {};
  const avatar = branding?.avatar;
  const cover = branding?.cover;

  // One page_view per mount, reported once for the visitor's browser. The hook
  // depends only on the slug, so client-side navigation between creators counts
  // each page but a re-render does not double count.
  useEffect(() => {
    trackEvent({ slug: creator.slug, type: "page_view", path: window.location.pathname });
  }, [creator.slug]);
  // Theme values are validated hex colours, so they are safe to inline.
  const themed = Boolean(theme.accent || theme.background || theme.textColor);
  const buttonClass = theme.buttonStyle ? `buttons-${theme.buttonStyle}` : "";
  return (
    <main className={`shell${themed ? " themed" : ""}`} style={themeStyle(theme)}>
      <nav className="nav">
        <Link className="brand" to="/">biova<span>·</span></Link>
        <span className="nav-label">@{creator.slug}</span>
      </nav>
      <header className={`profile${cover ? " has-cover" : ""}`}>
        {cover ? <img className="profile-cover" src={cover} alt="" /> : null}
        {avatar ? <img className="profile-avatar" src={avatar} alt={`${creator.displayName} avatar`} /> : null}
        <h1>{creator.displayName}</h1>
        {creator.bio ? <p className="intro">{creator.bio}</p> : null}
      </header>
      <section className={`link-list ${buttonClass}`.trim()} aria-label={`${page.title} links`}>
        {links.map((link) => (
          <a
            key={link.id}
            className="link-row"
            href={link.url}
            target="_blank"
            // Untrusted destination: never pass referrer or window.opener.
            rel="noopener noreferrer nofollow"
            onClick={() => trackEvent({ slug: creator.slug, type: "link_click", linkId: link.id })}
          >
            <span className="link-icon" aria-hidden="true">{link.icon ?? "↗"}</span>
            <span>
              <strong>{link.title}</strong>
              {link.description ? <small>{link.description}</small> : null}
            </span>
          </a>
        ))}
      </section>
      {products.length > 0 ? (
        <section className="product-list" aria-label={`${page.title} products`}>
          <div className="section-heading"><div className="eyebrow">PRODUCTS</div><span className="count">{products.length} ITEM</span></div>
          {products.map((product) => (
            <Link
              key={product.slug}
              className="product-card"
              to="/checkout/$username/$productSlug"
              params={{ username: creator.slug, productSlug: product.slug }}
              onClick={() => trackEvent({ slug: creator.slug, type: "product_view", productId: product.id })}
            >
              {product.thumbnailUrl ? (
                <img className="product-thumb" src={product.thumbnailUrl} alt="" loading="lazy" />
              ) : null}
              <div className="product-body">
                <strong>{product.title}</strong>
                {product.description ? <small>{product.description}</small> : null}
              </div>
              <span className="product-cta">
                <span className="product-price">{formatPriceIdr(product.priceIdr)}</span>
                <span className="product-buy">Buy now</span>
              </span>
            </Link>
          ))}
        </section>
      ) : null}
      <PluginBlocks blocks={blocks} />
      <footer>
        <span>BIOVA</span>
        <Link to="/">Claim your username ↗</Link>
      </footer>
    </main>
  );
}

function NotFound() {
  return (
    <main className="shell">
      <nav className="nav"><Link className="brand" to="/">biova<span>·</span></Link></nav>
      <section className="hero">
        <div className="eyebrow"><span className="pulse" /> NOT FOUND</div>
        <h1>No page<br /><em>here yet.</em></h1>
        <p className="intro">This username is free. Create your page and claim it.</p>
        <div className="actions"><Link className="button primary" to="/">Get started <span>↗</span></Link></div>
      </section>
    </main>
  );
}
