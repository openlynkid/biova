import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { authClient } from "../auth-client";
import {
  addBlock,
  createCreator,
  createLink,
  createProduct,
  deleteLink,
  deleteProduct,
  deleteProductAsset,
  getAnalytics,
  getDashboard,
  getSession,
  installPlugin,
  listProductAssets,
  removeBlock,
  reorderBlocks,
  reorderLinks,
  reorderProducts,
  setPageStatus,
  setPluginEnabled,
  setPluginPermission,
  setProductStatus,
  uninstallPlugin,
  updateBlock,
  updateLink,
  updatePage,
  updatePluginSettings,
  updateProduct,
  updateProfile,
  uploadProductAsset,
  type AnalyticsDetail,
  type BlockView,
  type PluginPanelView,
} from "../server/dashboard";
import { pluginRegistry } from "../plugins";
import { formatPriceIdr } from "@biova/shared/product";
import { formatBytes, type AssetView } from "@biova/shared/asset";
import type { AnalyticsRange } from "@biova/shared";

export const Route = createFileRoute("/dashboard")({
  loader: async () => ({
    session: await getSession(),
    dashboard: await getDashboard(),
  }),
  // Private page: noindex rather than a robots.txt block, so a crawler that
  // reaches it from an inbound link still reads the directive.
  head: () => ({ meta: [{ title: "Dashboard · Biova" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { session, dashboard } = Route.useLoaderData();
  const { data: liveSession } = authClient.useSession();

  if (!session) return <AuthPanel />;
  if (!dashboard) return <Onboarding />;
  return <Dashboard data={dashboard} email={liveSession?.user.email ?? ""} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" to="/">biova<span>·</span></Link>
        <span className="nav-label">DASHBOARD</span>
      </nav>
      {children}
    </main>
  );
}

function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
      return;
    }
    await router.invalidate();
  }

  return (
    <Shell>
      <section className="panel">
        <div className="eyebrow"><span className="pulse" /> {mode === "signin" ? "WELCOME BACK" : "CREATE YOUR ACCOUNT"}</div>
        <h1>{mode === "signin" ? "Sign in." : "Get started."}</h1>
        <form className="form" onSubmit={submit}>
          {mode === "signup" ? (
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>
          ) : null}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} /></label>
          {error ? <p className="error">{error}</p> : null}
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>
        <button className="text-link as-button" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
          {mode === "signin" ? "Need an account? Sign up ↗" : "Already have an account? Sign in ↗"}
        </button>
      </section>
    </Shell>
  );
}

function Onboarding() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await createCreator({ data: { slug, displayName, bio: bio || null } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error === "slug_taken" ? "That username is taken." : result.error === "invalid_input" ? "Check the username format." : result.error);
      return;
    }
    await router.invalidate();
  }

  return (
    <Shell>
      <section className="panel">
        <div className="eyebrow"><span className="pulse" /> CLAIM YOUR SPACE</div>
        <h1>Pick a username.</h1>
        <form className="form" onSubmit={submit}>
          <label>Username<input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required placeholder="yourname" /></label>
          <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></label>
          <label>Bio<textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} /></label>
          {error ? <p className="error">{error}</p> : null}
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create my page"}</button>
        </form>
      </section>
    </Shell>
  );
}

function Dashboard({ data, email }: { data: NonNullable<Awaited<ReturnType<typeof getDashboard>>>; email: string }) {
  const router = useRouter();
  const { creator, page, links, products, orders, analytics, analyticsDays, plugins, blocks } = data;
  const published = page?.status === "published";
  const [error, setError] = useState<string | null>(null);
  // The range control re-reads summary and daily chart together. The loader
  // payload seeds the initial 30d view, so there is no extra fetch on load.
  const [detail, setDetail] = useState<AnalyticsDetail>({ summary: analytics, days: analyticsDays });
  const [range, setRange] = useState<AnalyticsRange>(analytics.range);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? "Something went wrong");
    await router.invalidate();
  }

  async function selectRange(next: AnalyticsRange) {
    setRange(next);
    const result = await getAnalytics({ data: next });
    if (result) setDetail({ summary: result.summary, days: result.days });
  }

  return (
    <Shell>
      <section className="panel">
        <div className="eyebrow"><span className="pulse" /> {published ? "LIVE" : "DRAFT"}</div>
        <h1>@{creator.slug}</h1>
        <p className="intro">{email}</p>
        <div className="actions">
          <Link className="button primary" to="/$username" params={{ username: creator.slug }}>View public page <span>↗</span></Link>
          <button
            className="button"
            type="button"
            onClick={() => run(async () => setPageStatus({ data: { status: published ? "draft" : "published" } }))}
          >
            {published ? "Unpublish" : "Publish"}
          </button>
          <button className="text-link as-button" type="button" onClick={async () => { await authClient.signOut(); await router.invalidate(); }}>Sign out</button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <ProfileForm creator={creator} onSave={(payload) => run(async () => updateProfile({ data: payload }))} />
      <AnalyticsPanel analytics={detail.summary} days={detail.days} range={range} onRangeChange={selectRange} />
      <RevenuePanel analytics={detail.summary} days={detail.days} orders={orders} range={range} />
      <PageForm page={page} onSave={(payload) => run(async () => updatePage({ data: payload }))} />
      <LinksEditor links={links} onError={setError} />
      <ProductsEditor products={products} onError={setError} />
      <PluginsPanel plugins={plugins} blocks={blocks} onError={setError} />
    </Shell>
  );
}

function ProfileForm({ creator, onSave }: { creator: { displayName: string; bio: string | null }; onSave: (payload: { displayName: string; bio: string | null }) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(creator.displayName);
  const [bio, setBio] = useState(creator.bio ?? "");
  return (
    <section className="panel">
      <div className="eyebrow">PROFILE</div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void onSave({ displayName, bio: bio || null }); }}>
        <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></label>
        <label>Bio<textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} /></label>
        <button className="button primary" type="submit">Save profile</button>
      </form>
    </section>
  );
}

const THEME_PRESETS = [
  { label: "Midnight", accent: "#8298ff", background: "#0c0d10", textColor: "#f4f4f5" },
  { label: "Sunset", accent: "#ff8a5b", background: "#1a1013", textColor: "#ffe9dd" },
  { label: "Mint", accent: "#5be2a8", background: "#0a1410", textColor: "#e6fff5" },
] as const;

function PageForm({ page, onSave }: { page: { title: string; theme: Record<string, unknown> } | null; onSave: (payload: { title?: string; theme?: Record<string, string> }) => Promise<void> }) {
  const theme = (page?.theme ?? {}) as { accent?: string; background?: string; textColor?: string; buttonStyle?: string };
  const [title, setTitle] = useState(page?.title ?? "My page");
  const [accent, setAccent] = useState(theme.accent ?? "");
  const [background, setBackground] = useState(theme.background ?? "");
  const [textColor, setTextColor] = useState(theme.textColor ?? "");
  const [buttonStyle, setButtonStyle] = useState(theme.buttonStyle ?? "");

  function payload() {
    const next: Record<string, string> = {};
    if (accent) next.accent = accent;
    if (background) next.background = background;
    if (textColor) next.textColor = textColor;
    if (buttonStyle) next.buttonStyle = buttonStyle;
    return { title, theme: next };
  }

  return (
    <section className="panel">
      <div className="eyebrow">PAGE & THEME</div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void onSave(payload()); }}>
        <label>Page title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <div className="grid-3">
          <label>Accent<input type="color" value={accent || "#8298ff"} onChange={(e) => setAccent(e.target.value)} /></label>
          <label>Background<input type="color" value={background || "#0c0d10"} onChange={(e) => setBackground(e.target.value)} /></label>
          <label>Text<input type="color" value={textColor || "#f4f4f5"} onChange={(e) => setTextColor(e.target.value)} /></label>
        </div>
        <label>Button style
          <select value={buttonStyle} onChange={(e) => setButtonStyle(e.target.value)}>
            <option value="">Default</option>
            <option value="solid">Solid</option>
            <option value="outline">Outline</option>
            <option value="soft">Soft</option>
          </select>
        </label>
        <div className="actions">
          <button className="button primary" type="submit">Save page</button>
          {THEME_PRESETS.map((preset) => (
            <button key={preset.label} className="text-link as-button" type="button" onClick={() => { setAccent(preset.accent); setBackground(preset.background); setTextColor(preset.textColor); }}>{preset.label}</button>
          ))}
        </div>
      </form>
    </section>
  );
}

type LinkRow = { id: string; title: string; url: string; description: string | null; icon: string | null; enabled: boolean };

function LinksEditor({ links, onError }: { links: LinkRow[]; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    const result = await action();
    if (!result.ok) onError(result.error ?? "Something went wrong");
    await router.invalidate();
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...links];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await run(async () => reorderLinks({ data: { ids: next.map((link) => link.id) } }));
  }

  return (
    <section className="panel">
      <div className="eyebrow">LINKS ({links.length})</div>
      <form className="form inline" onSubmit={(e) => { e.preventDefault(); void run(async () => createLink({ data: { title, url } })).then(() => { setTitle(""); setUrl(""); }); }}>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>URL<input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://" /></label>
        <button className="button primary" type="submit">Add link</button>
      </form>
      <ul className="rows">
        {links.map((link, index) => (
          <li key={link.id} className={link.enabled ? "row" : "row disabled"}>
            <span className="row-icon">{link.icon ?? "↗"}</span>
            <div className="row-body">
              <strong>{link.title}</strong>
              <small>{link.url}</small>
            </div>
            <div className="row-actions">
              <button type="button" className="chip" onClick={() => void move(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
              <button type="button" className="chip" onClick={() => void move(index, 1)} disabled={index === links.length - 1} aria-label="Move down">↓</button>
              <button type="button" className="chip" onClick={() => void run(async () => updateLink({ data: { linkId: link.id, enabled: !link.enabled } }))}>{link.enabled ? "Hide" : "Show"}</button>
              <button type="button" className="chip danger" onClick={() => void run(async () => deleteLink({ data: { linkId: link.id } }))}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {links.length === 0 ? <p className="intro">No links yet. Add your first one above.</p> : null}
    </section>
  );
}

type ProductRow = { id: string; slug: string; title: string; description: string | null; priceIdr: number; status: string };

function ProductsEditor({ products, onError }: { products: ProductRow[]; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    const result = await action();
    if (!result.ok) onError(result.error ?? "Something went wrong");
    await router.invalidate();
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => createProduct({ data: { title, slug, priceIdr: Number(price), description: description || null } }));
    setTitle("");
    setSlug("");
    setPrice("");
    setDescription("");
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...products];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await run(async () => reorderProducts({ data: { ids: next.map((product) => product.id) } }));
  }

  return (
    <section className="panel">
      <div className="eyebrow">PRODUCTS ({products.length})</div>
      <form className="form inline" onSubmit={add}>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>Slug<input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required placeholder="preset-pack" /></label>
        <label>Price (IDR)<input type="number" min={0} max={100000000} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} required /></label>
        <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
        <button className="button primary" type="submit">Add product</button>
      </form>
      <ul className="rows">
        {products.map((product, index) => (
          <ProductRowItem
            key={product.id}
            product={product}
            first={index === 0}
            last={index === products.length - 1}
            onMove={move}
            index={index}
            run={run}
            onError={onError}
          />
        ))}
      </ul>
      {products.length === 0 ? <p className="intro">No products yet. Add your first digital product above.</p> : null}
    </section>
  );
}

type OrderRow = { reference: string; status: string; totalIdr: number; buyerName: string; buyerEmail: string; createdAt: string; items: { title: string; unitPriceIdr: number }[] };

// The money view: what the window earned, what an order is worth on average, how
// many product views turned into an order, the daily revenue trend, and which
// products actually sell. The totals come from the same analytics summary as the
// traffic panel, so the two never disagree, and the per-product rows come from
// the orders breakdown rather than being recomputed here.
function RevenuePanel({
  analytics,
  days,
  orders,
  range,
}: {
  analytics: AnalyticsRow;
  days: AnalyticsDay[];
  orders: OrderRow[];
  range: AnalyticsRange;
}) {
  const rangeLabel = RANGE_LABELS[range] ?? range;
  const selling = [...analytics.products].filter((product) => product.orders > 0).sort((a, b) => b.revenueIdr - a.revenueIdr);
  // Only days with revenue, so an empty window does not render a flat chart.
  const peakRevenue = Math.max(1, ...days.map((day) => day.revenueIdr));
  const hasRevenue = days.some((day) => day.revenueIdr > 0);

  return (
    <section className="panel">
      <div className="section-heading">
        <div className="eyebrow">REVENUE ({rangeLabel.toUpperCase()})</div>
        <span className="count">{orders.length} ORDER{orders.length === 1 ? "" : "S"}</span>
      </div>

      <div className="stat-row">
        <div className="stat"><span className="stat-label">REVENUE</span><strong>{formatPriceIdr(analytics.revenueIdr)}</strong></div>
        <div className="stat"><span className="stat-label">PAID ORDERS</span><strong>{analytics.orders}</strong></div>
        <div className="stat"><span className="stat-label">AVG ORDER</span><strong>{formatPriceIdr(analytics.averageOrderValueIdr)}</strong></div>
        <div className="stat"><span className="stat-label">CONVERSION</span><strong>{analytics.conversionRate}%</strong></div>
      </div>

      {hasRevenue ? (
        <>
          <div className="trend-legend">
            <span><i style={{ background: "#5fd3a6" }} />Revenue per day</span>
          </div>
          <div className="trend" role="img" aria-label={`Daily revenue over the last ${rangeLabel}`}>
            {days.map((day) => (
              <div
                className="trend-col"
                key={day.date}
                title={`${shortDay(day.date)} · ${formatPriceIdr(day.revenueIdr)} · ${day.orders} orders`}
              >
                <span className="trend-bar revenue" style={{ height: `${(day.revenueIdr / peakRevenue) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="trend-axis">
            <span>{shortDay(days[0].date)}</span>
            <span>{shortDay(days[days.length - 1].date)}</span>
          </div>
        </>
      ) : null}

      {selling.length > 0 ? (
        <>
          <div className="section-heading"><div className="eyebrow">REVENUE BY PRODUCT</div><span className="count">{selling.length} ITEM</span></div>
          <ul className="rows">
            {selling.map((product) => (
              <li className="row" key={product.productId}>
                <span className="row-icon">₨</span>
                <div className="row-body">
                  <strong>{product.title}</strong>
                  <small>{product.orders} sold · {product.views} views · {product.conversionRate}% convert</small>
                </div>
                <span className="product-price">{formatPriceIdr(product.revenueIdr)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="section-heading"><div className="eyebrow">ORDERS ({orders.length})</div></div>
      <ul className="rows">
        {orders.map((order) => (
          <li className={order.status === "paid" ? "row" : "row disabled"} key={order.reference}>
            <span className="row-icon">₨</span>
            <div className="row-body">
              <strong>{order.items.map((item) => item.title).join(", ") || "Order"}</strong>
              <small>{order.buyerName} · {order.buyerEmail} · {order.status} · {new Date(order.createdAt).toLocaleDateString("id-ID")}</small>
            </div>
            <span className="product-price">{formatPriceIdr(order.totalIdr)}</span>
          </li>
        ))}
      </ul>
      {orders.length === 0 ? <p className="intro">No orders yet. Share your page to make your first sale.</p> : null}
    </section>
  );
}

type AnalyticsRow = {
  range: string;
  pageViews: number;
  uniqueVisitors: number;
  linkClicks: number;
  clickThroughRate: number;
  productViews: number;
  orders: number;
  revenueIdr: number;
  averageOrderValueIdr: number;
  conversionRate: number;
  links: { linkId: string; title: string; clicks: number }[];
  products: { productId: string; title: string; views: number; orders: number; revenueIdr: number; conversionRate: number }[];
};

type AnalyticsDay = {
  date: string;
  pageViews: number;
  linkClicks: number;
  productViews: number;
  orders: number;
  revenueIdr: number;
};

const RANGE_LABELS: Record<string, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };
const RANGE_OPTIONS: AnalyticsRange[] = ["7d", "30d", "90d"];

// "2026-11-13" -> "13 Nov", for the axis ends only, so the bars stay readable at
// 90 days where a label per bar would not fit.
function shortDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const label = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return label;
}

function AnalyticsPanel({
  analytics,
  days,
  range,
  onRangeChange,
}: {
  analytics: AnalyticsRow;
  days: AnalyticsDay[];
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
}) {
  const rangeLabel = RANGE_LABELS[range] ?? range;
  // Only rows with activity are shown, busiest first.
  const topLinks = [...analytics.links].filter((link) => link.clicks > 0).sort((a, b) => b.clicks - a.clicks);
  const topProducts = [...analytics.products].filter((product) => product.views > 0).sort((a, b) => b.views - a.views);
  // Both series share one scale, so a click bar can never overtop a view bar of
  // the same height.
  const peak = Math.max(1, ...days.map((day) => Math.max(day.pageViews, day.linkClicks)));

  return (
    <section className="panel">
      <div className="section-heading">
        <div className="eyebrow">ANALYTICS ({rangeLabel.toUpperCase()})</div>
        <div className="range-control" role="group" aria-label="Analytics range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === range ? "active" : undefined}
              aria-pressed={option === range}
              onClick={() => onRangeChange(option)}
            >
              {RANGE_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><span className="stat-label">PAGE VIEWS</span><strong>{analytics.pageViews}</strong></div>
        <div className="stat"><span className="stat-label">VISITORS</span><strong>{analytics.uniqueVisitors}</strong></div>
        <div className="stat"><span className="stat-label">LINK CLICKS</span><strong>{analytics.linkClicks}</strong></div>
        <div className="stat"><span className="stat-label">CTR</span><strong>{analytics.clickThroughRate}%</strong></div>
        <div className="stat"><span className="stat-label">PRODUCT VIEWS</span><strong>{analytics.productViews}</strong></div>
      </div>

      {days.length > 0 ? (
        <>
          <div className="trend-legend">
            <span><i style={{ background: "#8298ff" }} />Page views</span>
            <span><i style={{ background: "#3a4463" }} />Link clicks</span>
          </div>
          <div className="trend" role="img" aria-label={`Daily page views and link clicks over the last ${rangeLabel}`}>
            {days.map((day) => (
              <div
                className="trend-col"
                key={day.date}
                title={`${shortDay(day.date)} · ${day.pageViews} views · ${day.linkClicks} clicks`}
              >
                <span className="trend-bar primary" style={{ height: `${(day.pageViews / peak) * 100}%` }} />
                <span className="trend-bar" style={{ height: `${(day.linkClicks / peak) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="trend-axis">
            <span>{shortDay(days[0].date)}</span>
            <span>{shortDay(days[days.length - 1].date)}</span>
          </div>
        </>
      ) : null}

      {topLinks.length > 0 ? (
        <>
          <div className="section-heading"><div className="eyebrow">TOP LINKS</div><span className="count">{topLinks.length} LINK</span></div>
          <ul className="rows">
            {topLinks.map((link) => (
              <li className="row" key={link.linkId}>
                <span className="row-icon">↗</span>
                <div className="row-body"><strong>{link.title}</strong></div>
                <span className="product-price">{link.clicks}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {topProducts.length > 0 ? (
        <>
          <div className="section-heading"><div className="eyebrow">TOP PRODUCTS</div><span className="count">{topProducts.length} ITEM</span></div>
          <ul className="rows">
            {topProducts.map((product) => (
              <li className="row" key={product.productId}>
                <span className="row-icon">◍</span>
                <div className="row-body">
                  <strong>{product.title}</strong>
                  <small>{product.views} views · {product.orders} sold · {product.conversionRate}% convert</small>
                </div>
                <span className="product-price">{product.views}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analytics.pageViews === 0 ? (
        <p className="intro">No traffic in the last {rangeLabel}. Share your page to start collecting stats.</p>
      ) : null}
    </section>
  );
}

function ProductRowItem({
  product,
  index,
  first,
  last,
  onMove,
  run,
  onError,
}: {
  product: ProductRow;
  index: number;
  first: boolean;
  last: boolean;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  run: (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(product.title);
  const [price, setPrice] = useState(String(product.priceIdr));
  const [assets, setAssets] = useState<AssetView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const published = product.status === "published";

  async function loadAssets() {
    const result = await listProductAssets({ data: { productId: product.id } });
    setAssets(result.ok ? result.data : []);
  }

  async function toggleAssets() {
    if (assets) {
      setAssets(null);
      return;
    }
    await loadAssets();
  }

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("productId", product.id);
      form.set("file", file);
      const result = await uploadProductAsset({ data: form });
      if (!result.ok) onError(result.error);
      await loadAssets();
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(assetId: string) {
    const result = await deleteProductAsset({ data: { assetId } });
    if (!result.ok) onError(result.error);
    await loadAssets();
  }

  return (
    <li className={published ? "row" : "row disabled"}>
      <span className="row-icon">◫</span>
      <div className="row-body">
        {editing ? (
          <form
            className="form inline"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => updateProduct({ data: { productId: product.id, title, priceIdr: Number(price) } })).then(() => setEditing(false));
            }}
          >
            <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
            <label>Price (IDR)<input type="number" min={0} max={100000000} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} required /></label>
            <button className="button primary" type="submit">Save</button>
            <button className="text-link as-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <strong>{product.title}</strong>
            <small>{formatPriceIdr(product.priceIdr)} · /{product.slug} · {product.status}</small>
          </>
        )}
      </div>
      <div className="row-actions">
        <button type="button" className="chip" onClick={() => void onMove(index, -1)} disabled={first} aria-label="Move up">↑</button>
        <button type="button" className="chip" onClick={() => void onMove(index, 1)} disabled={last} aria-label="Move down">↓</button>
        <button type="button" className="chip" onClick={() => setEditing(!editing)}>{editing ? "Close" : "Edit"}</button>
        <button type="button" className="chip" onClick={() => void toggleAssets()}>{assets ? "Close files" : "Files"}</button>
        <button type="button" className="chip" onClick={() => void run(async () => setProductStatus({ data: { productId: product.id, status: published ? "draft" : "published" } }))}>
          {published ? "Unpublish" : "Publish"}
        </button>
        <button type="button" className="chip danger" onClick={() => void run(async () => deleteProduct({ data: { productId: product.id } }))}>Delete</button>
      </div>
      {assets ? (
        <div className="asset-panel">
          <p className="intro">Files delivered to buyers after payment. They are never exposed on the public page.</p>
          <label className="button primary as-label">
            {busy ? "Uploading…" : "Add file"}
            <input
              type="file"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          {assets.length > 0 ? (
            <ul className="rows">
              {assets.map((asset) => (
                <li className="row" key={asset.id}>
                  <span className="row-icon">⤓</span>
                  <div className="row-body">
                    <strong>{asset.fileName}</strong>
                    <small>{formatBytes(asset.sizeBytes)} · {asset.contentType}</small>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="chip danger" onClick={() => void removeAsset(asset.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="intro">No files yet.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

function PluginsPanel({ plugins, blocks, onError }: { plugins: PluginPanelView[]; blocks: BlockView[]; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(pluginId: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    setBusyId(pluginId);
    const result = await action();
    setBusyId(null);
    if (!result.ok) onError(result.error ?? "Something went wrong");
    await router.invalidate();
  }

  return (
    <section className="panel">
      <div className="eyebrow">PLUGINS ({plugins.filter((plugin) => plugin.enabled).length} ACTIVE)</div>
      <p className="intro">Plugins are off until you enable them, and each capability is granted separately.</p>
      <ul className="rows">
        {plugins.map((plugin) => (
          <li key={plugin.manifest.id} className={plugin.enabled ? "row" : "row disabled"}>
            <span className="row-icon">{plugin.manifest.icon ?? "◇"}</span>
            <div className="row-body">
              <strong>{plugin.manifest.name} <small>v{plugin.manifest.version}</small></strong>
              <small>{plugin.manifest.description}</small>
              {plugin.installed ? (
                <>
                  <div className="permission-list">
                    {plugin.manifest.permissions.map((permission) => {
                      const granted = plugin.grantedPermissions.includes(permission);
                      return (
                        <button
                          key={permission}
                          type="button"
                          className={granted ? "chip on" : "chip"}
                          disabled={busyId === plugin.manifest.id}
                          onClick={() => void run(plugin.manifest.id, () => setPluginPermission({ data: { pluginId: plugin.manifest.id, permission, granted: !granted } }))}
                        >
                          {granted ? "✓ " : ""}{permission}
                        </button>
                      );
                    })}
                  </div>
                  <PluginSettingsEditor plugin={plugin} onSave={(settings) => run(plugin.manifest.id, () => updatePluginSettings({ data: { pluginId: plugin.manifest.id, settings } }))} />
                </>
              ) : null}
            </div>
            <div className="row-actions">
              {!plugin.installed ? (
                <button type="button" className="chip" disabled={busyId === plugin.manifest.id} onClick={() => void run(plugin.manifest.id, () => installPlugin({ data: { pluginId: plugin.manifest.id } }))}>Install</button>
              ) : (
                <>
                  <button type="button" className="chip" disabled={busyId === plugin.manifest.id} onClick={() => void run(plugin.manifest.id, () => setPluginEnabled({ data: { pluginId: plugin.manifest.id, enabled: !plugin.enabled } }))}>{plugin.enabled ? "Disable" : "Enable"}</button>
                  <button type="button" className="chip danger" disabled={busyId === plugin.manifest.id} onClick={() => void run(plugin.manifest.id, () => uninstallPlugin({ data: { pluginId: plugin.manifest.id } }))}>Uninstall</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {plugins.length === 0 ? <p className="intro">No plugins are available in this build.</p> : null}

      <BlocksEditor plugins={plugins} blocks={blocks} onError={onError} />
    </section>
  );
}

// Plugin-level settings are opaque JSON owned by the plugin, so the editor is a
// plain JSON field rather than a schema-driven form.
function PluginSettingsEditor({ plugin, onSave }: { plugin: PluginPanelView; onSave: (settings: Record<string, unknown>) => Promise<void> }) {
  const [value, setValue] = useState(() => JSON.stringify(plugin.settings ?? {}));
  return (
    <form
      className="settings-editor"
      onSubmit={(e) => { e.preventDefault(); void onSave(parseConfig(value)); }}
    >
      <label>Settings (JSON)<textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} /></label>
      <button type="button" className="chip" onClick={() => void onSave(parseConfig(value))}>Save settings</button>
    </form>
  );
}

function BlocksEditor({ plugins, blocks, onError }: { plugins: PluginPanelView[]; blocks: BlockView[]; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("{}");

  // Only an enabled plugin that offers page blocks can add one, and each block
  // type it declares becomes an option here.
  const installable = plugins.filter((plugin) => plugin.installed && plugin.enabled && plugin.manifest.extensions.pageBlocks);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    const result = await action();
    if (!result.ok) onError(result.error ?? "Something went wrong");
    await router.invalidate();
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...blocks];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await run(() => reorderBlocks({ data: { ids: next.map((block) => block.id) } }));
  }

  return (
    <div className="block-editor">
      <div className="eyebrow">PAGE BLOCKS ({blocks.length})</div>
      {installable.length > 0 ? (
        <form
          className="form inline"
          onSubmit={(e) => {
            e.preventDefault();
            const [pluginId, blockType] = selected.split(":");
            if (!pluginId || !blockType) return;
            void run(() => addBlock({ data: { pluginId, blockType, config: parseConfig(draft) } }));
          }}
        >
          <label>Block
            <select value={selected} onChange={(e) => setSelected(e.target.value)} required>
              <option value="">Choose a block…</option>
              {installable.flatMap((plugin) => pluginBlockTypes(plugin).map((type) => (
                <option key={`${plugin.manifest.id}:${type}`} value={`${plugin.manifest.id}:${type}`}>{plugin.manifest.name} · {type}</option>
              )))}
            </select>
          </label>
          <label>Config (JSON)<textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} /></label>
          <button className="button primary" type="submit">Add block</button>
        </form>
      ) : <p className="intro">Install and enable a plugin that provides blocks to add one.</p>}
      <ul className="rows">
        {blocks.map((block, index) => (
          <li key={block.id} className={block.enabled ? "row" : "row disabled"}>
            <div className="row-body">
              <strong>{block.pluginId} · {block.blockType}</strong>
              <small>{JSON.stringify(block.config)}</small>
            </div>
            <div className="row-actions">
              <button type="button" className="chip" onClick={() => void move(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
              <button type="button" className="chip" onClick={() => void move(index, 1)} disabled={index === blocks.length - 1} aria-label="Move down">↓</button>
              <button type="button" className="chip" onClick={() => void run(() => updateBlock({ data: { blockId: block.id, enabled: !block.enabled } }))}>{block.enabled ? "Hide" : "Show"}</button>
              <button type="button" className="chip danger" onClick={() => void run(() => removeBlock({ data: { blockId: block.id } }))}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The host maps a plugin id to the block types it declares, so the dashboard
// offers exactly what the plugin provides and nothing more.
function pluginBlockTypes(plugin: PluginPanelView): string[] {
  const registered = pluginRegistry.pageBlocks(plugin.manifest.id);
  return registered.map((definition) => definition.type);
}

function parseConfig(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
