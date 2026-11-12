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
```

The `dev`, `db:migrate` and `db:seed` scripts load `.env` themselves
(`--env-file=.env`). Run them from the repository root.

With the demo data seeded, the public page is at http://localhost:3000/demo.

## Creator dashboard

`/dashboard` is the creator-facing UI: sign in or sign up (Better Auth, email
and password), claim a username, then edit the profile, the page title, the theme
and the links, and publish or unpublish the page. The route renders the sign-in
panel when there is no session, so it is safe to open directly.

Mutations are TanStack Start server functions that resolve the session from the
request cookies and call the same domain services as the API; the browser never
reaches the database. See `docs/adr/0006-creator-dashboard.md`.

## Workspace boundaries

- `apps/web`: TanStack Start presentation, SSR, creator dashboard and public page routes.
- `apps/api`: Elysia HTTP adapter only. `src/app.ts` builds the injectable app;
  `src/index.ts` wires real dependencies. Keep business rules in packages, not route handlers.
- `packages/core`: composition root that builds the domain services and exposes the public read model.
- `packages/creator`, `packages/page`, `packages/links`: domain packages (repository + service).
- `packages/plugin-sdk`: stable contracts available to first-party and third-party plugins.
- `packages/plugin-registry`: build-time plugin catalog plus runtime activation resolver.
- `packages/database`: Drizzle schema, connection and migrations.
- `packages/auth`: Better Auth instance shared by the web app and the API.
- `packages/shared`: framework-agnostic shared primitives (validation, `Result`, session policy, rate limiter).
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
| GET | `/v1/public/:slug` | no | Published page read model |

Errors are stable codes (`unauthorized`, `invalid_input`, `not_found`,
`slug_taken`, `invalid_transition`, `not_publishable`, `rate_limited`,
`internal_error`). Authenticated requests are rate limited per user; set
`CORS_ORIGINS` to the comma-separated list of allowed browser origins.

## Public page

`GET /:username` renders the published page server-side. The loader calls the
`getPublicPage` server function in `apps/web/src/server/public-page.ts`, which
loads the database driver on the server only. Draft or unknown usernames render
the not-found view and never reveal that a page exists. Link destinations are
restricted to `http`/`https` and render with `rel="noopener noreferrer nofollow"`.

## Plugin model

1. Build-time registration: import approved plugin packages in `apps/web/src/plugins.ts`.
2. Runtime activation: read the creator's installation state from the database and expose only enabled capabilities.
3. External plugins: do not load arbitrary npm packages or execute uploaded JavaScript inside the Bun process. Future external plugins must use a signed artifact pipeline plus isolated workers/sandbox and capability-scoped APIs.

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

Test coverage today: creator, page and links services (18 tests), the API routes
and isolation rules (14 tests), and the public read model (3 tests).

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
