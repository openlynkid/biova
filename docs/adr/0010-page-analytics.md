# ADR-0010: Privacy-first page analytics

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 4 (Growth and Analytics) opens with the numbers a creator needs to run
their page: how many people visit it, which links they tap, which products they
open, and what that traffic turns into. PRD 4.7 lists this as page analytics, and
the data model names `page_view_event` and `link_click_event`.

The tempting design is a stored counter: a `views` column bumped on every hit.
It is fast to read and cheap to write, but it is also a second source of truth
that drifts the moment a write is lost, a page is deleted, or a range filter
needs anything other than "all time". We chose the opposite: keep the raw events
and derive every number at read time.

## Decision

### Raw events, aggregates computed on read

- Three append-only tables, one per event kind: `page_view_events`,
  `link_click_events` and `product_view_events`. Each row carries `creator_id`,
  `visitor_id` and `created_at`; a click also carries `link_id` and a product
  view carries `product_id`. All three cascade from `creators`, and the link and
  product columns cascade from their own tables.
- Nothing is precomputed. Page views, unique visitors, clicks, the click-through
  rate and the per-link and per-product breakdowns are all `count`/`countDistinct`
  queries bounded by `creator_id` and a `created_at` lower bound, so a summary for
  any range is one round of queries over the same rows.
- The paid-order count and revenue in the summary come from the orders domain
  through an injected function (`paidTotalsSince`), not from a copied total, so
  the number the creator sees matches the orders list exactly.

### No personal data, and no client-chosen identity

- `visitor_id` is a random token the browser mints and keeps in local storage. It
  exists only to count a returning browser once. No IP address, user agent or
  account id is stored, so a row cannot be traced back to a person, and there is
  nothing to anonymise or expire.
- The ingest route takes a **page slug**, never a creator id. The server resolves
  the slug to a creator and refuses unless that creator's page is published, so a
  caller cannot write events against an arbitrary creator.
- The service re-checks that a click's link, or a product view's product, belongs
  to that creator. A forged id is rejected with `not_found` instead of being
  written, so one creator can never attach traffic to another creator's rows.
- The event type is a closed set (`page_view`, `link_click`, `product_view`) and
  the link/product requirement is enforced by the shared schema, so a page view
  cannot smuggle a link id and an unknown type is refused before any write.

### The public write path is rate limited and never breaks the page

- Ingest is unauthenticated by design, so it gets its own per-address rate
  limiter (`analyticsRateLimiter`), separate from the per-user limiter and the
  webhook limiter. Over the budget the route answers `429` with `retry-after`.
- The browser reports events fire-and-forget through `trackEvent`, which swallows
  every failure. A blocked or failed write never delays or breaks the visitor's
  page.

### One domain, wired through injected functions

- `packages/analytics` owns the repository (the raw queries) and the service (the
  rules and the summary shape). It depends on `@biova/database` and
  `@biova/shared` only.
- Titles for the link and product breakdowns, and the paid-order totals, are
  passed in by `createServices` in `@biova/core` through `AnalyticsDeps`. The
  analytics domain therefore never imports the links, products or orders
  domains, keeping the one-way dependency rule intact.
- The public page read model now includes a product `id` so the client can report
  a `product_view` against the right row. It is a random uuid and reveals nothing
  about the product.

## Consequences

- Every summary is consistent with the rows it is drawn from; there is no counter
  to repair after a bad deploy, and a new range or breakdown is a new query rather
  than a migration and a backfill.
- The cost moves to read time. The `(creator_id, created_at)` index on each table
  keeps the range scans bounded, but at very high volume a scheduled rollup into
  daily aggregate rows is the natural next step; the raw tables stay the source
  of truth, so a rollup can be added without changing the read model.
- Raw events grow without bound and have no retention policy yet. Because they
  hold no personal data, pruning old rows is a storage decision, not a compliance
  one.
- A visitor who clears storage or uses a private window is counted as new, so
  "unique visitors" means unique browsers, not unique people. This is a deliberate
  trade for not storing anything identifying.
- The dashboard reads a fixed `30d` window today. The range is a validated enum
  (`7d`, `30d`, `90d`) shared by the API and the service, so exposing a range
  control is a UI change, not a schema one.
