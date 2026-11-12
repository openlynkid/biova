# ADR-0003: Authentication and session policy

- Status: Accepted
- Date: 2026-11-12

## Context

The platform needs creator accounts before any creator-facing feature (pages, plugin installations) can be built. `creators.userId` already references an auth user, and ADR-0002 requires domain logic to live in packages rather than app route handlers.

## Decision

Use Better Auth 1.7.20 with the Drizzle adapter (`provider: "pg"`) on the existing PostgreSQL connection.

- One auth instance lives in `packages/auth` and is imported by both `apps/web` and `apps/api`, so the session contract cannot drift between processes.
- Better Auth tables (`user`, `session`, `account`, `verification`) are Drizzle tables in `packages/database/src/auth-schema.ts`. Property keys equal Better Auth field names because the Drizzle adapter resolves fields by key; database columns are snake_case.
- Migrations are owned by Drizzle Kit, not by Better Auth. `bun run db:generate` emits SQL and `bun run db:migrate` applies it and asserts the four auth tables exist. Better Auth's own migrator only supports Kysely, so it is not used.
- The web app mounts the Better Auth handler at `/api/auth/*`.
- The API verifies sessions through `auth.api.getSession` and returns `401` when absent; it never reads the session cookie directly.

Session policy (in `packages/shared`):

- 7-day expiry, 1-day sliding update age, 5-minute cookie cache.
- Email and password is the only enabled method. Social providers, email verification and organization support are deferred.

## Consequences

- Adding a new auth field means editing the Drizzle schema, regenerating a migration and re-running it. The schema is the single source of truth; `getAuthTables` output is the reference for what Better Auth expects.
- `@biova/database` throws at import when `DATABASE_URL` is missing. The API imports `@biova/auth` lazily so health and metadata endpoints boot without a database; tests set `DATABASE_URL` before importing the app.
- Auth secrets (`BETTER_AUTH_SECRET`, 32+ characters) are environment-only and never committed.
