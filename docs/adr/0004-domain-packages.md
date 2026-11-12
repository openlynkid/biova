# ADR-0004: Domain service packages and the composition root

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 2 needs creator, page and link behaviour shared by the TanStack Start app
and the Elysia API. ADR-0002 requires domain modules to own their tables,
repositories and service APIs, and cross-domain calls to go through exported
interfaces. We also want the rules tested without a running PostgreSQL server.

## Decision

- Each domain is a package: `packages/creator`, `packages/page`, `packages/links`.
  A domain package exports a repository (SQL only) and a service (rules only).
  Services return a `Result<T, E>` instead of throwing, so HTTP adapters map
  error codes to statuses in one place.
- Services never import each other. Where one domain needs another's answer, the
  dependency is a function injected by the caller. Example: `page` takes an
  `isPublishable(creatorId)` checker instead of importing `links`.
- `packages/core` is the composition root. It builds the services from a
  `Database` handle, wires cross-domain dependencies, and exposes the public
  read model `getPublicPage`. Apps depend on `core`, not on the individual
  domains, except for types.
- Domain repositories type their argument as `Database` from
  `@biova/database/types`. Production uses postgres.js, tests use PGlite; both
  drivers share `PgQueryResultHKT`, so one type covers both without casts.
- Tests run against PGlite (`@biova/database/testing`) with the real Drizzle
  migrations applied. This exercises actual SQL in CI without a database server.

## Consequences

- Adding a domain means adding a package, then wiring it in `core`.
- The API and the web app share one set of rules, so a change cannot drift
  between them.
- Errors are values, not exceptions, at the domain boundary. Unexpected errors
  still throw and are handled by the API error handler.
