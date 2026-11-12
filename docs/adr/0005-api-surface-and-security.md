# ADR-0005: API surface, isolation and abuse controls

- Status: Accepted
- Date: 2026-11-12

## Context

The API moved from a single `/v1/session` route to creator, page and link
endpoints. That raises questions about authentication, tenant isolation, error
shaping, CORS and rate limiting.

## Decision

- Every private route resolves the session from the request headers and then
  loads the creator for that user id. The creator id is never taken from the
  request body or query. Ownership filters (`creator_id = ...`) are part of the
  SQL in every repository write, so one creator cannot read or change another's
  rows even if a route is wrong.
- Error codes are stable strings. `apps/api/src/app.ts` maps them to HTTP
  statuses once. Unexpected errors are logged and returned as
  `{ error: "internal_error" }` with status 500; internal messages never reach
  the client.
- CORS uses an explicit origin allowlist from `CORS_ORIGINS` (comma-separated),
  with credentials enabled. There is no wildcard.
- Authenticated requests are rate limited per user with a fixed-window limiter
  (`createRateLimiter` in `packages/shared`). It is in-process memory today; a
  multi-instance deployment must back the same interface with Redis.
- The public read model (`GET /v1/public/:slug`) returns only published pages and
  only enabled links. Draft pages return 404 so their existence is not disclosed.
- Link destinations must be `http`/`https` (`linkUrlSchema`). This blocks
  `javascript:` and `data:` URLs, which would be an XSS vector on the public
  page. The page renders external links with `rel="noopener noreferrer nofollow"`.

## Consequences

- Route handlers stay thin: authenticate, call a service, map the result.
- Isolation is enforced twice: in the route (which creator) and in SQL (which
  rows). A missing route check is still contained by the repository filter.
- Rate limiting needs a shared store before horizontal scaling.
