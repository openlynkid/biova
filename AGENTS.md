# AGENTS.md

Repository memory for the Biova monorepo. Keep this file current when build
commands, conventions or architecture change.

## What this repository is

Biova is a modular creator link-in-bio platform with a hybrid plugin system. It
is a Bun-native monorepo (Turborepo) that originated from the Openlynk
foundation and was renamed to Biova. GitHub: `openlynkid/biova`, default branch
`main`.

## Product guidance

`docs/PRD.md` is the product source of truth (PRD v1.0, 2026-11-12). Read it
before starting product work and follow it over assumptions. Highlights that
shape day-to-day decisions:

- Vision: one link, one storefront, one checkout, one dashboard. Biova is not a
  marketplace, social network, general-purpose website builder or file host.
- MVP is one creator, one public page. All segments from launch.
  Indonesia-first (IDR, Bahasa Indonesia and English), global-ready.
- Roadmap phases: 1 Foundation, 2 Core link-in-bio, 3 Creator commerce,
  4 Growth and analytics, 5 Plugin ecosystem. Current state: Phase 1 complete
  (auth foundation, database schema). Phase 2 complete: creator, page and links
  domains, the public page route and the creator dashboard are implemented.
  Phase 3 complete: products, checkout, Midtrans, asset storage and delivery are
  implemented. Phase 4 complete: page analytics (events, summary, daily
  timeseries, revenue and conversion breakdown, dashboard traffic and revenue
  panels with a 7d/30d/90d range control), public-page SEO (canonical/OG
  metadata, JSON-LD structured data, sitemap.xml, robots.txt), paid-order
  notifications (buyer receipt and creator sale alert through a deduped outbox)
  and conversion improvements (per-product conversion, an explicit buy action on
  the product card) are implemented.
- Domain boundaries to build next: growth and media. Each domain owns its tables,
  repositories and service APIs, and exposes a public interface (ADR-0002,
  ADR-0004). Creator, page, links, products, orders, payments, delivery,
  analytics and notifications are done.
- Payments use Midtrans. Payment status may only change from a verified server
  webhook, and webhooks must be idempotent.
- Paid files must never be reachable by public URL or by client-asserted
  payment status; delivery requires a server-verified entitlement and a signed
  or tokenized download.
- Every creator-owned row must support isolation by creator ID, enforced
  server-side.
- Plugin UI must not touch the database or secrets, and external plugins must
  not execute arbitrary code in the main Bun process.

Acceptance criteria for the MVP are listed in section 15 of the PRD; treat them
as the definition of done for product work.

## PRD entity mapping

PRD section 10 lists target entities; the schema today uses plural table names.
Map before adding tables so the same concept is not created twice:

| PRD entity | Current table |
|---|---|
| user, session | `user`, `session` (+ `account`, `verification`) |
| creator | `creators` |
| creator_page | `pages` |
| link | `links` |
| page_block | `page_blocks` |
| plugin, plugin_installation, plugin_setting | `plugins`, `plugin_installations`, `plugin_settings` |
| digital_product | `products` |
| commerce_order | `orders` |
| commerce_order_item | `order_items` |
| payment_transaction | `payment_transactions` |
| payment_webhook_event | `payment_webhook_events` |
| product_entitlement | `product_entitlements` |
| product_asset | `product_assets` |
| (notifications, outbox pattern) | `notification_outbox` |
| creator_profile, page_theme, link_click_event, page_view_event | not built yet |

Note that `creators.bio` already covers part of `creator_profile`, and `pages.theme`
covers part of `page_theme`. Extend those tables rather than creating parallel ones
unless the PRD model genuinely needs a separate lifecycle.

Schema constraints worth knowing:

- `creators.user_id` is unique (one creator per auth user).
- `pages.creator_id` is unique (MVP is one page per creator). Relax to a
  `(creator_id, slug)` unique index when multi-page accounts arrive.
- `pages.status` is the `page_status` enum; the values mirror `pageStatusSchema`
  in `@biova/shared`.
- `links.url` is validated to be `http`/`https` at the service boundary.
- `product_assets.storage_key` is unique and server-generated; it is never
  exposed through the API. `product_assets` cascades from both `creators` and
  `products`.
- `product_entitlements` has a unique `(order_id, product_id)` index, so a
  replayed webhook cannot grant a buyer the same product twice.
- Deleting a product or a creator cascades `product_assets` rows but not the
  stored bytes. Those become unreachable orphans; `bun run storage:sweep`
  reports them and `--delete` removes them. This is a manual command, not an
  automatic job.

## Environment

- Runtime and package manager: Bun 1.4.4 (`packageManager: bun@1.4.4`). Bun is
  not always on `PATH` in this container; check `/tmp/bunx/bun-linux-x64/bun`
  first, and if it is absent install it without root with
  `npm install bun --prefix /tmp/buninstall` and use
  `/tmp/buninstall/node_modules/.bin/bun`. CI installs it via
  `oven-sh/setup-bun@v2`.
- PostgreSQL 17 runs locally with a `biova` database. Connection string:
  `postgres://postgres:postgres@localhost:5432/biova`.
- `.env` is git-ignored; `.env.example` is committed. Required variables:
  `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ chars), `BETTER_AUTH_URL`.
  `CORS_ORIGINS` doubles as Better Auth's `trustedOrigins`, and
  `BETTER_AUTH_ALLOWED_HOSTS` overrides the auth host allowlist (see below).
- Digital delivery reads `STORAGE_DIR` (uploaded product files; default
  `.storage`, resolved relative to the workspace root), `DOWNLOAD_TOKEN_SECRET`
  (signs download links; a local default is used when unset) and
  `DOWNLOAD_TOKEN_TTL_SECONDS` (default 900). `.storage` is git-ignored.
- `@biova/database` throws at import when `DATABASE_URL` is missing. Keep this
  in mind for tests and for any module that imports it eagerly.

## Commands

```bash
bun install --frozen-lockfile   # install; bun.lock is committed
bun run lint                    # eslint .
bun run typecheck               # turbo typecheck
bun run test                    # turbo test
bun run build                   # turbo build (web is the only builder)
bun run db:generate             # drizzle-kit generate -> packages/database/drizzle
bun run db:migrate              # apply migrations + assert auth tables exist
bun run db:seed                 # dev demo data (creator "demo", published page)
bun run storage:sweep           # report uploaded files no product row references
bun run storage:sweep --delete  # remove those files
```

`bun run dev`, `bun run db:migrate`, `bun run db:seed` and
`bun run storage:sweep` read `DATABASE_URL`.
The root scripts pass `--env-file=.env` because the web dev server runs under
Node, where Bun does not load `.env` automatically. Run them from the repo root;
`--env-file` is relative to the process cwd, so a missing `.env` is only fatal if
the value is actually required.

`bun run lint`, `bun run typecheck`, `bun run test` and `bun run build` all pass
without any environment variables set; CI runs exactly these four with no env.
Domain tests use PGlite, so no database server is needed in CI. Do not introduce
a build step that requires `DATABASE_URL`.

## Layout

- `apps/web`: TanStack Start (React 19 SSR). Build-time plugin allowlist lives in
  `src/plugins.ts`. Output is `dist/server/server.js` (`bun dist/server/server.js`).
- `apps/api`: Elysia HTTP adapter. `src/app.ts` builds the injectable app
  (routes, CORS, error mapping, rate limiting); `src/index.ts` wires the real
  dependencies. Business rules belong in packages.
- `packages/core`: composition root. Builds the domain services from a
  `Database` handle and exposes the public read model `getPublicPage`.
- `packages/creator`, `packages/page`, `packages/links`, `packages/products`,
  `packages/orders`: domain packages. Each exports a repository (SQL) and a
  service (rules, returning `Result`). Products own `products` (slug unique per
  creator, price in whole rupiah) and publish through the same transition table
  as pages; `packages/products/src/assets.ts` adds a second repository + service
  for `product_assets` (upload, list, remove, reorder). Orders own `orders`,
  `order_items`, `payment_transactions`, `payment_webhook_events` and
  `product_entitlements`.
- `packages/storage`: `BlobStorage` port (`put`/`get`/`remove`/`list`) plus a
  local filesystem driver. Keys are server-generated (`<shard>/<random><ext>`);
  the driver validates every key and confirms the resolved path stays inside the
  root, so a caller can never choose a path. `findOrphanKeys` is the pure
  comparison the sweep runs.
- `packages/delivery`: signed, time-boxed download tokens (`token.ts`) and the
  buyer delivery read model. Reaches orders and products through injected
  functions, so it imports neither domain. Download checks: token signature and
  expiry, entitlement active, asset belongs to the granted product.
- `packages/analytics`: page analytics. Owns `page_view_events`,
  `link_click_events` and `product_view_events` (raw, append-only). Every number
  in the dashboard summary is computed on read from those rows; links, product
  titles and paid-order totals arrive through injected functions, so it imports
  no other domain. `summary` and `timeseries` share one window definition
  (`seriesWindow` in `@biova/shared`: the last N UTC calendar days ending today),
  so the daily buckets always sum to the summary totals. Days are bucketed in SQL
  (`to_char(created_at at time zone 'UTC', ...)`) and gaps are filled by the pure
  `buildDailySeries`. `summary` also reports revenue by product
  (`paidRevenueByProduct`, injected from orders) plus `averageOrderValueIdr` and
  `conversionRate` (orders over product views), each product carrying its own
  conversion; the per-product revenue and the totals come from one read in one
  window, so they cannot disagree.
- `packages/notifications`: paid-order notifications. Owns `notification_outbox`
  (one row per message, `dedupe_key` unique, so a replayed webhook sends nothing).
  `order_paid` (buyer receipt) and `sale` (creator alert) templates live in
  `templates.ts`; every interpolated value is escaped, and each message carries a
  plain-text fallback. `NotificationProvider` is a transport port; the default
  records messages in memory (no email driver is wired yet). The orders domain
  calls it through an injected `onOrderPaid` hook after the order is durably
  `paid`, and the service swallows provider failures, so mail can never fail a
  settled payment. Reaches the creator contact through an injected function, so
  it imports neither the creator nor the orders domain.
- `packages/payments`: `PaymentProvider` abstraction with a Midtrans adapter
  (sha512 signature verification) and a fake provider for tests and local
  development. `core` picks the provider from the environment.
- `packages/plugins`: the plugin domain. Owns `plugins` (catalog),
  `plugin_installations`, `plugin_settings` and `page_blocks`; exports a
  repository and `createPluginService` returning `Result`. Reads the build-time
  allowlist through a `PluginCatalog` port (`get`/`list`), so it imports no
  plugin package and no UI framework. Install/enable/grant are separate calls and
  the public read model is filtered in SQL to blocks whose plugin is installed
  and enabled. `PluginContext` carries no DB or secret.
- `packages/plugin-sdk`: the public plugin contract. Re-exports the manifest and
  permission types from `@biova/shared/plugin` and adds only the React pieces
  (`BiovaPlugin`, `PageBlockDefinition`, `PluginContext`) plus the reserved
  `ExternalPluginHost` interface (no in-process implementation).
- `packages/plugin-registry`: validates every manifest against the shared schema,
  holds the executable plugins and resolves the enabled set. The allowlist is
  built in `apps/web/src/plugins.ts` and passed to `createServices`.
- `packages/database`: Drizzle schema, connection (`db`), migrations. Subpath
  exports: `./schema`, `./types` (side-effect free `Database` type),
  `./testing` (PGlite helper).
- `packages/auth`: the single Better Auth instance shared by web and API.
- `packages/shared`: framework-agnostic primitives: validation schemas, `Result`,
  `sessionPolicy`, `createRateLimiter`. The barrel also re-exports `./env`
  (`readEnv`), which touches `process`/`Bun`, so browser components import pure
  modules through a subpath (e.g. `@biova/shared/product`) instead of the barrel
  to keep server-only code out of the client bundle.
- `packages/shared/src/seo.ts` (`@biova/shared/seo`): pure SEO builders — 
  `absoluteUrl`, `escapeXml`, `buildSitemapXml`, `buildRobotsTxt`, `personJsonLd`,
  `productJsonLd`, `creatorPageJsonLd`. No DB or framework imports, so both the
  sitemap route and a route `head()` can use them and unit tests cover them.
- `plugins/*`: independently versioned plugin packages compiled into the host.

## Conventions and gotchas

- Dependencies are pinned in `package.json` files and mirrored in
  `docs/dependency-baseline.md`. Update both when bumping.
- Package names use the `@biova/*` scope. Never reintroduce `openlynk` names.
- Drizzle Kit runs under Node, where `Bun.env` is undefined. Config and scripts
  that drizzle-kit loads must read `process.env`, not `Bun.env`.
- Turbo runs each app with its own cwd (`apps/api`, `apps/web`), so a relative
  `STORAGE_DIR` would resolve to two different folders and a file uploaded
  through one app would be invisible to the other. `resolveStorageRoot` in
  `packages/core` anchors a relative path at the workspace root (the directory
  holding `turbo.json`); an absolute path is used as given.
- Server functions that accept a file take `FormData` as their validator input
  (`createServerFn({ method: "POST" }).validator((data: FormData) => data)`).
  TanStack Start passes it through without JSON serialization, so the browser can
  upload a real `File`.
- The Drizzle adapter for Better Auth resolves fields by the Drizzle property
  key, so property keys must equal Better Auth field names; database columns are
  snake_case.
- `packages/database/src/schema.ts` must re-export every table (`export *`) or
  drizzle-kit will silently skip it.
- Better Auth's own migrator supports Kysely only; schema changes go through
  Drizzle Kit. `packages/database/src/migrate.ts` applies migrations and then
  asserts the four auth tables exist.
- Never read `Bun.env` directly in code that can run under Node. Vite's dev SSR
  worker and drizzle-kit run on Node, where the `Bun` global is undefined and the
  app crashes with `ReferenceError: Bun is not defined`. Use `readEnv(key)` from
  `@biova/shared`, which checks the Bun global and falls back to `process.env`.
- `apps/web/vite.config.ts` sets `server.allowedHosts` for the dev tunnels. Vite
  answers `403` for an unknown `Host` header; add the tunnel domain there when
  exposing the dev server, and keep the production build strict.
- Import `@biova/auth` lazily in the API so health/metadata endpoints boot
  without a database. Import `@biova/database/types` (not `@biova/database`) when
  only the `Database` type is needed, so no `DATABASE_URL` check runs.
- Domain repositories accept `Database` (the shared `PgQueryResultHKT` supertype)
  so the same code runs against postgres.js and PGlite.
- Services return `Result<T, E>` and never throw for expected failures. Route
  handlers map error codes to statuses in `apps/api/src/app.ts`.
- Test database helper: `createTestDatabase()` from `@biova/database/testing`
  applies the real migrations in-process. Use `createTestUser(db)` for rows that
  reference an auth user.
- TanStack Router's `routeTree.gen.ts` is committed and regenerated by
  `vite build`. Adding a route requires a build before typecheck passes.
- A route whose path contains a dot must escape it in the filename
  (`robots[.]txt.ts` -> `/robots.txt`), or the router reads the dot as a
  flat-file separator and the generated path is wrong.
- Private HTML pages carry `robots: noindex` in their own `head()` and are not
  listed in `robots.txt`. A crawler blocked by robots.txt never reads a `noindex`
  directive, so disallowing an HTML page can leave it indexable from inbound
  links. Only non-HTML endpoints (`/api/`, `/download/`) belong in the disallow
  list.
- Elysia and API handlers are tested through `app.handle(new Request(...))`; the
  app is built by `createApp(deps)` so tests inject PGlite and a fake session.
- `apps/web/src/server/public-page.ts` and `apps/web/src/server/dashboard.ts` are
  TanStack Start server functions. They load `@biova/database` dynamically so the
  client bundle never includes the driver. Check `dist/client` for leaks after
  touching them.
- All web server functions share one lazy service graph from
  `apps/web/src/server/services.ts`; do not build a second one in a route.
- A URL segment that is a lookup key (order reference, download token, username)
  must not be shape-validated by a server-function validator: a value that fails
  the pattern throws and renders a 500 error view instead of the not-found view.
  Validate a loose length only and let the lookup return nothing.
- The dashboard (`apps/web/src/routes/dashboard.tsx`) is the only creator-facing
  write UI. It authenticates through `auth.api.getSession({ headers:
  getRequestHeaders() })` and then calls the domain services; never trust a
  creator id from the browser. `getDashboard` returns `null` for anonymous
  visitors so the route can render the sign-in panel instead of throwing.
- Server function payloads must be serializable. Map domain rows (which carry
  `Date` columns) to plain objects before returning them from a handler. Plugin
  settings and block configs use the `JsonValue` union from `@biova/shared/plugin`
  (not `Record<string, unknown>`) for the same reason: a value the transport
  cannot carry must fail validation, not at render.
- The plugin allowlist is `apps/web/src/plugins.ts`; it is the only place that
  imports a `BiovaPlugin` package into the host. The plugin domain reads manifests
  through the `PluginCatalog` port, so never import a plugin package or a UI
  framework from `packages/plugins` or `apps/api`.
- A page block stores a plugin id and block type, never a component. Map it to
  code only in the host (`apps/web/src/plugin-blocks.tsx` / the dashboard), and
  render nothing for an unknown plugin or type, so a stored config can never
  choose which code runs.
- Install, enable and grant are separate creator actions. Do not make enabling a
  plugin grant its permissions, and do not let a grant exceed the manifest's
  declared permissions — `grantPermission` rejects an undeclared one.
- The public block read model (`listPublicBlocks`) is filtered in SQL by the
  creator's installation. Never render blocks from `listBlocks` on the public
  page; that set is the creator-facing view.
- External plugins are not run in-process. `ExternalPluginHost` in
  `@biova/plugin-sdk` is the reserved interface; keep the default a refusal rather
  than an in-process fallback. See `docs/adr/0014-plugin-system.md`.
- Better Auth uses a dynamic `baseURL` (`allowedHosts` + `protocol: "auto"`).
  `BETTER_AUTH_ALLOWED_HOSTS` overrides the allowlist; the development default is
  `localhost`, `127.0.0.1` and `*.all-hands.dev`. Production has no default, so
  set the variable (or `BETTER_AUTH_URL`) there. Cookies follow the derived
  protocol, which keeps the `__Secure-` prefix correct behind the dev tunnel.
- Page theme colours are validated as `#rgb`/`#rrggbb` (`themeColorSchema`) and
  rendered as inline CSS variables. Do not loosen that schema: the values reach a
  `style` attribute.

## Payments and webhooks

- The order price is always resolved server-side from the published product; the
  checkout request never carries an amount. Do not add a client-supplied price.
- `POST /v1/webhooks/:provider` is the only unauthenticated write. `handleWebhook`
  verifies the signature, then checks the amount against the stored order, and
  only then records the event for idempotency. Keep that order: recording first
  lets a signed-but-wrong delivery burn the idempotency key.
- `applyStatus` moves the order and grants entitlements in one transaction, and
  only from the expected `from_status`, so the order and entitlements cannot
  drift and concurrent webhooks cannot both win.
- The order reference is the buyer's bearer token for `/order/:reference`; it is
  random and not derivable from the creator or product slug.
- Notifications are best-effort and must stay that way: `onOrderPaid` is called
  only after the order is durably `paid`, the orders service swallows its errors,
  and the notification service records a provider failure on the outbox row
  instead of throwing. Never make a settled payment depend on a send.
- Local development and tests use the fake provider unless `MIDTRANS_SERVER_KEY`
  is set. The fake provider still requires `PAYMENT_FAKE_SECRET`.

## Verification expectations

Before committing, run typecheck, test and build. For auth or database changes,
also apply migrations against the local PostgreSQL instance and exercise the
affected flow over HTTP. See `README.md` and `docs/adr/0003-authentication.md`.

## Git

Commit messages describe the change and its verification. Push to `main` uses
the `GITHUB_PAT` credential. CI (`.github/workflows/ci.yml`) runs on push to
`main` and on pull requests.
