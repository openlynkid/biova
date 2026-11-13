import { createFileRoute, Link } from "@tanstack/react-router";
import { pluginRegistry } from "../plugins";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  // The marketing page lists the allowlisted catalog, not a creator's installs:
  // there is no session here, so the manifests are the honest thing to show.
  const plugins = pluginRegistry.list();
  return (
    <main className="shell">
      <nav className="nav"><a className="brand" href="/">biova<span>·</span></a><span className="nav-label">CREATOR PLATFORM</span></nav>
      <section className="hero">
        <div className="eyebrow"><span className="pulse" /> MODULAR CREATOR PLATFORM</div>
        <h1>Your space.<br /><em>Your rules.</em></h1>
        <p className="intro">One home for your identity, content and commerce. Add the tools you need, leave out the ones you don't.</p>
        <div className="actions"><Link className="button primary" to="/dashboard">Create your page <span>↗</span></Link><a className="text-link" href="#plugins">Explore the foundation</a></div>
      </section>
      <section id="plugins" className="plugin-section">
        <div className="section-heading"><div><div className="eyebrow">EXTEND YOUR SPACE</div><h2>One platform. Modular by design.</h2></div><span className="count">{plugins.length} PLUGIN LOADED</span></div>
        <div className="plugin-grid">{plugins.map((plugin) => <article className="plugin-card" key={plugin.id}><div className="plugin-icon">{plugin.icon ?? "◇"}</div><div><h3>{plugin.name}</h3><p>{plugin.description}</p></div><span className="status">READY</span></article>)}</div>
      </section>
      <footer><span>BIOVA FOUNDATION</span><span>BUN · TANSTACK START · ELYSIA</span></footer>
    </main>
  );
}
