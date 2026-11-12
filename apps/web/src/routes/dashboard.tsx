import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { authClient } from "../auth-client";
import {
  createCreator,
  createLink,
  createProduct,
  deleteLink,
  deleteProduct,
  getDashboard,
  getSession,
  reorderLinks,
  reorderProducts,
  setPageStatus,
  setProductStatus,
  updateLink,
  updatePage,
  updateProduct,
  updateProfile,
} from "../server/dashboard";
import { formatPriceIdr } from "@biova/shared/product";

export const Route = createFileRoute("/dashboard")({
  loader: async () => ({
    session: await getSession(),
    dashboard: await getDashboard(),
  }),
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
  const { creator, page, links, products } = data;
  const published = page?.status === "published";
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? "Something went wrong");
    await router.invalidate();
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
      <PageForm page={page} onSave={(payload) => run(async () => updatePage({ data: payload }))} />
      <LinksEditor links={links} onError={setError} />
      <ProductsEditor products={products} onError={setError} />
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
          />
        ))}
      </ul>
      {products.length === 0 ? <p className="intro">No products yet. Add your first digital product above.</p> : null}
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
}: {
  product: ProductRow;
  index: number;
  first: boolean;
  last: boolean;
  onMove: (index: number, direction: -1 | 1) => Promise<void>;
  run: (action: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(product.title);
  const [price, setPrice] = useState(String(product.priceIdr));
  const published = product.status === "published";

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
        <button type="button" className="chip" onClick={() => void run(async () => setProductStatus({ data: { productId: product.id, status: published ? "draft" : "published" } }))}>
          {published ? "Unpublish" : "Publish"}
        </button>
        <button type="button" className="chip danger" onClick={() => void run(async () => deleteProduct({ data: { productId: product.id } }))}>Delete</button>
      </div>
    </li>
  );
}
