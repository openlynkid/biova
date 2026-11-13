# Biova Foundation

Bun-native monorepo foundation for Biova: a modular creator link-in-bio platform with a hybrid plugin system.

Product direction lives in [`docs/PRD.md`](docs/PRD.md) (PRD v1.0). Architecture decisions live in [`docs/adr/`](docs/adr). [`AGENTS.md`](AGENTS.md) is the repository memory for build commands and conventions.

## Stack baseline

- Bun 1.4.4 (runtime and package manager)
- TanStack Start 1.169.5 (React SSR application)
- Elysia 1.4.30 (standalone HTTP API app; can be merged into the web process later)
- React 19.3.0
- TypeScript 5.9.3 (conservative compatibility baseline)
- Turborepo 2.11.11
- PostgreSQL + Drizzle ORM 0.45.4 + postgres.js 3.4.7
- Zod 4.6.7

Versions are pinned intentionally. Re-check peer dependencies and run the validation commands before production. `bun.lock` is committed; CI and the Dockerfile install with `bun install --frozen-lockfile`. `@tanstack/react-router` is pinned to 1.170.46 because that is the version `@tanstack/react-start` 1.169.5 depends on (a matching `1.169.5` was never published).

## Quick start

```bash
bun --version # expected 1.4.4 or newer in the 1.4 line
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

- Web: http://localhost:3000
- API health: http://localhost:3001/health

Run PostgreSQL locally, then:

```bash
bun run db:generate
bun run db:migrate
bun run db:seed                # optional: demo creator "demo" with a published page
bun run storage:sweep          # report uploaded files no product row references
bun run storage:sweep --delete # remove those files
```

The `dev`, `db:migrate`, `db:seed` and `storage:sweep` scripts load `.env`
themselves (`--env-file=.env`). Run them from the repository root.

With the demo data seeded, the public page is at http://localhost:3000/demo.

## Creator dashboard

`/dashboard` is the creator-facing UI: sign in or sign up (Better Auth, email
and password), claim a username, then edit the profile, the page title, the theme,
the links and the digital products, and publish or unpublish each item. The route
renders the sign-in panel when there is no session, so it is safe to open
directly.

Mutations are TanStack Start server functions that resolve the session from the
request cookies and call the same domain services as the API; the browser never
reaches the database. See `docs/adr/0006-creator-dashboard.md`.

## Workspace boundaries

- `apps/web`: TanStack Start presentation, SSR, creator dashboard and public page routes.
- `apps/api`: Elysia HTTP adapter only. `src/app.ts` builds the injectable app;
  `src/index.ts` wires real dependencies. Keep business rules in packages, not route handlers.
- `packages/core`: composition root that builds the domain services and exposes the public read model.
- `packages/creator`, `packages/page`, `packages/links`, `packages/products`, `packages/orders`: domain packages (repository + service). Product assets (upload, list, remove, reorder) live in `packages/products` as a second repository and service.
- `packages/media`: creator branding (avatar and cover). It stores one row per slot and serves public, cache-busting image URLs, reusing the `BlobStorage` port.
- `packages/payments`: payment provider abstraction with a Midtrans adapter and a fake provider for tests and local development.
- `packages/storage`: `BlobStorage` port plus a local filesystem driver. Keys are server-generated, so no caller chooses a path.
- `packages/delivery`: signed, time-boxed download tokens and the buyer-facing delivery read model. It reaches orders and products through injected functions.
- `packages/plugin-sdk`: stable contracts available to first-party and third-party plugins.
- `packages/plugin-registry`: build-time plugin catalog plus runtime activation resolver.
- `packages/database`: Drizzle schema, connection and migrations.
- `packages/auth`: Better Auth instance shared by the web app and the API.
- `packages/shared`: framework-agnostic shared primitives (validation, `Result`, session policy, rate limiter). Browser code imports pure modules through a subpath (for example `@biova/shared/product`) so the server-only `readEnv` helper never enters the client bundle.
- `plugins/*`: independently versioned plugin packages. They are compiled into the host application; runtime activation controls availability per creator.

## API

`apps/api` serves JSON under `/v1`. Private routes require a session cookie and
operate on the creator that belongs to the signed-in user; the creator id is
never read from the request.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | no | Liveness and runtime info |
| GET | `/v1` | no | Service metadata |
| GET | `/v1/session` | yes | Current user |
| POST | `/v1/creator` | yes | Create the creator and its draft page |
| GET | `/v1/creator` | yes | Read the creator and page |
| PATCH | `/v1/creator` | yes | Update display name and bio |
| PATCH | `/v1/page` | yes | Update page title and theme |
| PUT | `/v1/page/status` | yes | Move the page between draft, published, archived |
| GET | `/v1/links` | yes | List the creator's links |
| POST | `/v1/links` | yes | Add a link |
| PATCH | `/v1/links/:id` | yes | Update a link |
| DELETE | `/v1/links/:id` | yes | Remove a link |
| PUT | `/v1/links/reorder` | yes | Set the link order |
| GET | `/v1/products` | yes | List the creator's digital products |
| POST | `/v1/products` | yes | Add a product (title, slug, price in IDR) |
| PATCH | `/v1/products/:id` | yes | Update a product |
| PUT | `/v1/products/:id/status` | yes | Publish, unpublish or archive a product |
| DELETE | `/v1/products/:id` | yes | Remove a product |
| PUT | `/v1/products/reorder` | yes | Set the product order |
| POST | `/v1/products/:id/assets` | yes | Upload a product file (multipart `file`) |
| GET | `/v1/products/:id/assets` | yes | List a product's files |
| DELETE | `/v1/products/assets/:assetId` | yes | Remove a file and its bytes |
| PUT | `/v1/products/:id/assets/reorder` | yes | Set the file order |
| PUT | `/v1/media/:kind` | yes | Upload the avatar or cover (multipart `file`) |
| DELETE | `/v1/media/:kind` | yes | Remove the avatar or cover and its bytes |
| GET | `/v1/orders` | yes | List the creator's orders |
| POST | `/v1/checkout` | no | Start a checkout for a published product |
| GET | `/v1/orders/:reference` | no | Buyer order status (reference is the bearer token) |
| GET | `/v1/orders/:reference/downloads` | no | Files a paid order grants, each behind a signed link |
| GET | `/v1/downloads/:token` | no | Download a file (signed token is the only credential) |
| POST | `/v1/webhooks/:provider` | no | Payment gateway callback (signature verified) |
| GET | `/v1/public/:slug` | no | Published page read model |

Errors are stable codes (`unauthorized`, `invalid_input`, `not_found`,
`slug_taken`, `invalid_transition`, `not_publishable`, `too_large`,
`unsupported_type`, `invalid_token`, `unavailable`, `rate_limited`,
`internal_error`). Authenticated requests are rate limited per user; set
`CORS_ORIGINS` to the comma-separated list of allowed browser origins.

## Public page

`GET /:username` renders the published page server-side. The loader calls the
`getPublicPage` server function in `apps/web/src/server/public-page.ts`, which
loads the database driver on the server only. Draft or unknown usernames render
the not-found view and never reveal that a page exists. Link destinations are
restricted to `http`/`https` and render with `rel="noopener noreferrer nofollow"`.
Published digital products render as a catalog below the links, with prices
formatted as whole rupiah (`formatPriceIdr`). Only published products are in the
read model, so drafts and archived items stay private. Each product links to
`/checkout/:username/:productSlug`, where a visitor can buy it without signing in.

### SEO

The page head carries a canonical link, `og:url`, `og:site_name` and the Twitter
card set, all built from `APP_URL` rather than the request host, so a preview or
tunnel never becomes the canonical origin. It also emits schema.org structured
data (a `Person` for the creator, plus an `ItemList` of published products) via
the router's `script:ld+json` slot.

`/sitemap.xml` lists the home page and every published creator page with a
`<lastmod>`, and `/robots.txt` allows crawling, disallows only non-HTML endpoints
(`/api/`, `/download/`) and advertises the sitemap. Private HTML pages
(`/dashboard`, `/checkout/...`, `/order/...`) are not disallowed; they carry
`robots: noindex, nofollow` in their own head instead, because a crawler blocked
by robots.txt never reads that directive. The pure builders live in
`@biova/shared/seo` (`buildSitemapXml`, `buildRobotsTxt`, `creatorPageJsonLd`,
`absoluteUrl`, `escapeXml`). See `docs/adr/0011-seo.md`.

## Checkout and orders

A visitor buys a product from the checkout page: name, email and optional phone.
The price is resolved server-side from the published row, so the request never
carries an amount. Paid products redirect to the gateway's hosted page; free
products are fulfilled immediately. `/order/:reference` shows the buyer the
order status and their items; the random reference is the bearer credential.

The creator sees orders and revenue in the dashboard (`REVENUE` panel), with
average order value, conversion and a per-product breakdown.

Payments use Midtrans. Set `MIDTRANS_SERVER_KEY` to enable it; without it, a fake
provider is used for local development and tests (it still requires
`PAYMENT_FAKE_SECRET`, defaulting to a local value). The gateway callback is
`POST /v1/webhooks/:provider`; the signature is verified before anything is
recorded, and the amount is checked against the stored order. See
`docs/adr/0008-checkout-and-payments.md`.

## Notifications

When an order becomes paid the buyer gets a receipt and the creator gets a sale
alert. The orders domain calls an injected `onOrderPaid` hook only after the
order is durably `paid`, and the notification service catches every provider
failure, so a mail outage can never fail a settled payment.

Messages go through `notification_outbox` (one row per message, `dedupe_key`
unique). A replayed webhook finds the row already present and sends nothing, so
a buyer is mailed exactly once per order — the same idempotency gate the webhook
event table uses. Each row records its `status`, an `attempts` count and the last
error.

Templates are code in `@biova/notifications` (`order_paid`, `sale`); every
interpolated value is escaped, because a buyer name or product title must not
become markup in a mail client. Transport is a port: no email driver is wired
yet, so the default records messages in memory instead of sending them. See
`docs/adr/0013-notifications-and-revenue.md`.

## Digital delivery

A creator attaches files to a product from the dashboard (`Files` on a product
row). Uploads are multipart and the bytes are written under `STORAGE_DIR` with a
server-generated key; the original name is kept for display only. Files are never
listed on the public page.

Once an order is paid, `/order/:reference` lists the files the buyer may
download, each behind a signed link that expires after `DOWNLOAD_TOKEN_TTL_SECONDS`
(15 minutes by default). The link is an HMAC over the entitlement and asset ids,
so it cannot be forged or edited to point at another buyer's file, and it stops
working on its own. Downloads re-check that the entitlement is active and that
the asset belongs to the granted product; revoking an entitlement stops new
downloads immediately. The storage key never appears in a URL or a response. See
`docs/adr/0009-asset-storage-and-delivery.md`.

Deleting a product, a creator or a branding image cascades the rows that
reference a blob but leaves the uploaded bytes in the store. `bun run
storage:sweep` reconciles the store against every row and lists what nothing
references; add `--delete` to remove those files.

## Branding

A creator sets an avatar and a cover from the dashboard (`BRANDING` panel).
Uploads are multipart and the bytes are written under `STORAGE_DIR` with a
server-generated key; only images (`image/png`, `image/jpeg`, `image/webp`,
`image/avif`, `image/gif`) up to 5 MB are accepted, so the slot cannot host an
arbitrary file. There is one row per slot: replacing an image swaps the key and
removes the previous blob.

The images are public and appear on the published page at `/media/:username/:kind`
(rendered as the profile avatar and cover). The route serves them only while the
page is published, so a draft page's branding never leaks, and the URL carries a
version so a replacement busts the cache. See `docs/adr/0015-creator-media.md`.

## Analytics

The public page reports three events from the browser: a `page_view` on load, a
`link_click` when a link is tapped and a `product_view` when a product is opened.
The visitor id is a random token kept in local storage; no IP or account id is
stored, so nothing points at a person. Reports are fire-and-forget and never
block or break the page.

Events are written through `POST /v1/public/:slug/events`, which resolves the
creator from the published slug rather than trusting a client-supplied id, and
rejects a click or product view whose target belongs to someone else. The
dashboard reads `GET /v1/analytics/summary?range=30d` (session-scoped) for page
views, unique visitors, clicks, click-through rate, product views, and the paid
order count and revenue for the range.

`GET /v1/analytics/timeseries?range=` breaks the same metrics into UTC calendar
days for the dashboard trend chart. Both endpoints accept `7d`, `30d` or `90d`
and share one window definition (`seriesWindow` in `@biova/shared`), so the daily
buckets always add up to the summary totals. A day with no events is a real zero,
not a missing bucket. The dashboard's range control re-reads both together.

Every number is derived from the raw event rows at read time; nothing is a stored
counter, so a summary always agrees with the rows it comes from.

The summary also breaks revenue down by product (`paidRevenueByProduct` in the
orders domain, read through an injected function) and derives two conversion
numbers: `averageOrderValueIdr` (revenue over orders) and `conversionRate`
(orders over product views), plus a per-product `conversionRate`. The per-product
revenue and the totals come from one read in one window, so they cannot disagree.
A product with no activity is reported at zero rather than omitted. The dashboard
shows these in the `REVENUE` panel, and the public product card carries an
explicit `Buy now` affordance. See `docs/adr/0010-page-analytics.md`,
`docs/adr/0012-analytics-breakdown.md` and
`docs/adr/0013-notifications-and-revenue.md`.

## Plugin model

The plugin system has a build-time half and a runtime half, joined by one
contract. `PluginManifest`, `PluginPermission` and `PluginExtensions` are zod
schemas in `@biova/shared/plugin`; the SDK re-exports them and adds only the
React pieces, and the registry validates every manifest against the same schema.
There is one definition of a plugin and the host, the API and every plugin read
it from the same place.

Build-time, the allowlist lives in `apps/web/src/plugins.ts`, which registers the
approved `BiovaPlugin` packages (`@biova/plugin-social-links`,
`@biova/plugin-testimonials`) into a registry and passes it to `createServices`
as a `PluginCatalog`. Adding a plugin is a new import and a new deployment, never
a runtime download. The plugin domain reads that catalog through the port, so it
never imports a plugin package or a UI framework and stays buildable in the API
process.

Runtime, a creator installs a plugin from the allowlist, then explicitly enables
it and grants permissions. An install creates the row with `enabled = false` and
no granted permissions, so installing a plugin never changes a live page, and a
grant can narrow the manifest's request but never widen it. State lives in
`plugin_installations` and `plugin_settings`, keyed per creator.

A page block is a row (`plugin_id`, `block_type`, `config`, `sort_order`), never a
component: the host maps the pair to code through the registry, so a stored
config cannot choose which code runs, and an unknown block renders nothing. The
public read model is filtered in SQL to blocks whose plugin the creator has
installed *and* enabled, so disabling a plugin takes its blocks off the page
without deleting them.

Isolation is enforced, not just documented. A `PluginContext` carries only the
plugin id, the creator id and the granted permission set — no database handle, no
secret, no HTTP client. Block components render for anonymous visitors and get no
creator identity. Every block operation is scoped by the session creator id.
External marketplace plugins are not loaded into the Bun process at all:
`ExternalPluginHost` in `@biova/plugin-sdk` records the intended sandbox /
isolated-service shape as an interface with no in-process implementation. See
`docs/adr/0014-plugin-system.md`.

`bun run db:seed` installs and enables the `social-links` plugin for the demo
creator and adds one block, so the demo page exercises the real flow.

## Authentication

Better Auth 1.7.20 with the Drizzle adapter (`pg`). The auth instance lives in `packages/auth` so the web app and the API share one configuration.

- Tables: `user`, `session`, `account`, `verification`, defined in `packages/database/src/auth-schema.ts`. Property keys match Better Auth field names; database columns are snake_case.
- Routes: the web app mounts the Better Auth handler at `/api/auth/*` (`apps/web/src/routes/api/auth/$.ts`).
- Session policy: `sessionPolicy` in `packages/shared` sets a 7-day expiry, a 1-day update age, and a 5-minute cookie cache. Better Auth reads `expiresIn`/`updateAge` in seconds.
- Email and password sign-in is enabled. Social providers and email verification are not configured yet.
- The API exposes `GET /v1/session`, which returns the current user and session or `401`.

Required environment variables: `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL`. See `.env.example`.

Schema changes flow through Drizzle Kit: `bun run db:generate` writes SQL to `packages/database/drizzle`, then `bun run db:migrate` applies it and verifies the four auth tables exist.

## Validation

`bun run lint`, `bun run typecheck`, `bun run test` and `bun run build` pass with
no environment variables set, and CI runs exactly these four. Domain and API
tests run against PGlite (`@biova/database/testing`) with the real Drizzle
migrations applied, so they exercise actual SQL without a database server.

Test coverage today: 205 tests across the workspace — the domain services
(creator, page, links, products, orders, media, delivery, analytics, plugins,
notifications), the API routes and isolation rules, the public read model, the
shared schemas and the payment providers. Tests run against an in-process
Postgres (PGlite) with the real migrations applied.

Notes from earlier validation passes:

- `@biova/plugin-social-links` exported `./src/index.ts` while the file is `src/index.tsx`; the export path was corrected.
- `PageBlockDefinition` is generic, so a concrete block was not assignable to `BiovaPlugin.pageBlocks`. The SDK now exposes `ErasedPageBlockDefinition` for the registry boundary.

## Important implementation notes

- This is a foundation scaffold, not a production-ready SaaS release.
- Rate limiting is implemented in-process for authenticated API requests. Before
  horizontal scaling, back `createRateLimiter` with a shared store (Redis).
- Billing, payment webhook idempotency, audit logging, backups and observability
  must be implemented and tested before launch.
- TanStack Start owns the web SSR boundary. Elysia is a separate API process in this scaffold to keep deployment boundaries explicit; consolidate later if operational simplicity is more important than process isolation.
- Do not expose `DATABASE_URL` or server-only secrets to browser bundles.
