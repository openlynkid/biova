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
  (auth foundation, database schema). Phase 2 in progress: creator, page and
  links domains plus the public page route are implemented.
- Domain boundaries to build next: products, orders, payments, analytics, media.
  Each domain owns its tables, repositories and service APIs, and exposes a
  public interface (ADR-0002, ADR-0004). Creator, page and links are done.
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
| creator_profile, page_theme, link_click_event, digital_product, product_asset, commerce_order, commerce_order_item, payment_transaction, payment_webhook_event, product_entitlement, page_view_event | not built yet |

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

## Environment

- Runtime and package manager: Bun 1.4.4 (`packageManager: bun@1.4.4`). Bun is
  not always on `PATH` in this container; it lives at
  `/tmp/bunx/bun-linux-x64/bun`. Prefix commands with
  `export PATH="/tmp/bunx/bun-linux-x64:$PATH"` when needed.
- PostgreSQL 17 runs locally with a `biova` database. Connection string:
  `postgres://postgres:postgres@localhost:5432/biova`.
- `.env` is git-ignored; `.env.example` is committed. Required variables:
  `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ chars), `BETTER_AUTH_URL`.
- `@biova/database` throws at import when `DATABASE_URL` is missing. Keep this
  in mind for tests and for any module that imports it eagerly.

## Commands

```bash
bun install --frozen-lockfile   # install; bun.lock is committed
bun run lint                    # eslint .
bun run typecheck               # turbo typecheck, 12 tasks
bun run test                    # turbo test
bun run build                   # turbo build (web is the only builder)
bun run db:generate             # drizzle-kit generate -> packages/database/drizzle
bun run db:migrate              # apply migrations + assert auth tables exist
```

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
- `packages/creator`, `packages/page`, `packages/links`: domain packages. Each
  exports a repository (SQL) and a service (rules, returning `Result`).
- `packages/plugin-sdk`: stable plugin contracts (`BiovaPlugin`,
  `ErasedPageBlockDefinition`).
- `packages/plugin-registry`: build-time catalog + runtime activation resolver.
- `packages/database`: Drizzle schema, connection (`db`), migrations. Subpath
  exports: `./schema`, `./types` (side-effect free `Database` type),
  `./testing` (PGlite helper).
- `packages/auth`: the single Better Auth instance shared by web and API.
- `packages/shared`: framework-agnostic primitives: validation schemas, `Result`,
  `sessionPolicy`, `createRateLimiter`.
- `plugins/*`: independently versioned plugin packages compiled into the host.

## Conventions and gotchas

- Dependencies are pinned in `package.json` files and mirrored in
  `docs/dependency-baseline.md`. Update both when bumping.
- Package names use the `@biova/*` scope. Never reintroduce `openlynk` names.
- Drizzle Kit runs under Node, where `Bun.env` is undefined. Config and scripts
  that drizzle-kit loads must read `process.env`, not `Bun.env`.
- The Drizzle adapter for Better Auth resolves fields by the Drizzle property
  key, so property keys must equal Better Auth field names; database columns are
  snake_case.
- `packages/database/src/schema.ts` must re-export every table (`export *`) or
  drizzle-kit will silently skip it.
- Better Auth's own migrator supports Kysely only; schema changes go through
  Drizzle Kit. `packages/database/src/migrate.ts` applies migrations and then
  asserts the four auth tables exist.
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
- Elysia and API handlers are tested through `app.handle(new Request(...))`; the
  app is built by `createApp(deps)` so tests inject PGlite and a fake session.
- `apps/web/src/server/public-page.ts` is a TanStack Start server function. It
  loads `@biova/database` dynamically so the client bundle never includes the
  driver. Check `dist/client` for leaks after touching it.

## Verification expectations

Before committing, run typecheck, test and build. For auth or database changes,
also apply migrations against the local PostgreSQL instance and exercise the
affected flow over HTTP. See `README.md` and `docs/adr/0003-authentication.md`.

## Git

Commit messages describe the change and its verification. Push to `main` uses
the `GITHUB_PAT` credential. CI (`.github/workflows/ci.yml`) runs on push to
`main` and on pull requests.
