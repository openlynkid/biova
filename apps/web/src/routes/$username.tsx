import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getPublicPage } from "../server/public-page";

export const Route = createFileRoute("/$username")({
  loader: async ({ params }) => {
    const page = await getPublicPage({ data: { slug: params.username } });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.creator.displayName} · Biova` },
          {
            name: "description",
            content: loaderData.creator.bio ?? `${loaderData.creator.displayName} on Biova`,
          },
          { property: "og:title", content: loaderData.creator.displayName },
          { property: "og:type", content: "profile" },
        ]
      : [{ title: "Not found · Biova" }],
  }),
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
  const { creator, page, links } = Route.useLoaderData();
  const theme = page.theme ?? {};
  // Theme values are validated hex colours, so they are safe to inline.
  const themed = Boolean(theme.accent || theme.background || theme.textColor);
  const buttonClass = theme.buttonStyle ? `buttons-${theme.buttonStyle}` : "";
  return (
    <main className={`shell${themed ? " themed" : ""}`} style={themeStyle(theme)}>
      <nav className="nav">
        <Link className="brand" to="/">biova<span>·</span></Link>
        <span className="nav-label">@{creator.slug}</span>
      </nav>
      <header className="profile">
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
          >
            <span className="link-icon" aria-hidden="true">{link.icon ?? "↗"}</span>
            <span>
              <strong>{link.title}</strong>
              {link.description ? <small>{link.description}</small> : null}
            </span>
          </a>
        ))}
      </section>
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
