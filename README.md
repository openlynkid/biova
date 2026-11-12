# Biova Foundation

Bun-native monorepo foundation for Biova: a modular creator link-in-bio platform with a hybrid plugin system.

## Stack baseline

- Bun 1.4.4 (runtime and package manager)
- TanStack Start 1.169.5 (React SSR application)
- Elysia 1.4.30 (standalone HTTP API app; can be merged into the web process later)
- React 19.3.0
- TypeScript 5.9.3 (conservative compatibility baseline)
- Turborepo 2.11.11
- PostgreSQL + Drizzle ORM 0.45.4 + postgres.js 3.4.7
- Zod 4.6.7

Versions are pinned intentionally. Re-check peer dependencies and run the validation commands before production. `bun.lock` is committed; CI and the Dockerfile install with `bun install --frozen-lockfile`. `@tanstack/react-router` is pinned to 1.170.46 because that is the version `@tanstack/react-start` 1.169.5 depends on (a matching `1.169.5` was never published). Better Auth is intentionally deferred until the auth schema and adapter are wired and tested.

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
```

## Workspace boundaries

- `apps/web`: TanStack Start presentation, SSR, creator dashboard and public page routes.
- `apps/api`: Elysia HTTP adapter only. Keep business rules in packages, not route handlers.
- `packages/plugin-sdk`: stable contracts available to first-party and third-party plugins.
- `packages/plugin-registry`: build-time plugin catalog plus runtime activation resolver.
- `packages/database`: Drizzle schema, connection and migrations.
- `packages/shared`: framework-agnostic shared primitives.
- `plugins/*`: independently versioned plugin packages. They are compiled into the host application; runtime activation controls availability per creator.

## Plugin model

1. Build-time registration: import approved plugin packages in `apps/web/src/plugins.ts`.
2. Runtime activation: read the creator's installation state from the database and expose only enabled capabilities.
3. External plugins: do not load arbitrary npm packages or execute uploaded JavaScript inside the Bun process. Future external plugins must use a signed artifact pipeline plus isolated workers/sandbox and capability-scoped APIs.

## Validation

The foundation passes `bun run typecheck`, `bun run test` and `bun run build`. Fixes applied while validating:

- `@biova/plugin-social-links` exported `./src/index.ts` while the file is `src/index.tsx`; the export path was corrected.
- `PageBlockDefinition` is generic, so a concrete block was not assignable to `BiovaPlugin.pageBlocks`. The SDK now exposes `ErasedPageBlockDefinition` for the registry boundary.
- `@biova/api` had no tests, so `bun test` failed the workspace; the Elysia app is exported and covered by smoke tests. `@biova/web` uses `bun test --pass-with-no-tests` until web tests exist.

## Important implementation notes

- This is a foundation scaffold, not a production-ready SaaS release.
- Authentication, authorization, tenant isolation, billing, payment webhook idempotency, rate limiting, audit logging, backups and observability must be implemented and tested before launch.
- TanStack Start owns the web SSR boundary. Elysia is a separate API process in this scaffold to keep deployment boundaries explicit; consolidate later if operational simplicity is more important than process isolation.
- Do not expose `DATABASE_URL` or server-only secrets to browser bundles.
