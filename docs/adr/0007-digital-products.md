# ADR-0007: Digital products domain

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 2 (link-in-bio) is done, so the next roadmap step is Phase 3 (creator
commerce). Checkout, Midtrans and asset storage all need an external payment
account or object storage, so they cannot be the first step. Products are the
part of commerce that is self-contained: a creator describes what they sell
before there is any way to buy it.

## Decision

- A new domain package, `packages/products`, follows the established pattern
  (ADR-0004): a repository owns the SQL, a service owns the rules and returns
  `Result`, and only `@biova/core` knows how the domains are wired together.
- Products live in the `products` table (`digital_product` in the PRD data
  model). The slug is unique per creator, not globally, so two creators may both
  sell a `preset-pack`. A partial index would be needed to allow duplicate slugs
  across creators if the constraint were global; per-creator is simpler and
  matches the URL shape.
- Prices are whole rupiah stored as `integer`. Rupiah has no minor unit, so an
  integer is exact and no floating point can drift. The schema caps a price at
  100,000,000 IDR to catch a typo before it reaches a checkout.
- Products publish through the same transition table as pages
  (`draft`/`published`/`archived`, archived only returns to draft). Keeping the
  two state machines identical means one mental model for creators and one place
  to change if commerce needs a different lifecycle later.
- `getPublicPage` now returns a `products` array of published products only, so
  drafts and archived items never reach a visitor. The public product shape is
  `{ slug, title, description, priceIdr }`; the internal id is not exposed.
- The API exposes `/v1/products` (list, create, update, delete, status,
  reorder). The creator id always comes from the session, never from the body,
  and every repository write is scoped by `creatorId`.
- The dashboard gains a products editor (create, inline edit, publish toggle,
  reorder, delete) and the public page renders a product catalog with formatted
  prices.

## Consequences

- Products are discoverable but not yet purchasable. The next increments are
  `product_asset` (secure storage + signed download), `commerce_order` and
  `payment_transaction` with Midtrans, then entitlements and delivery. Those add
  tables and a webhook, not changes to this domain's interface.
- The public page read model is the single boundary between a creator's data and
  a visitor, so checkout will read product data through it rather than querying
  products directly.
- Client components must not import the `@biova/shared` barrel, because it
  re-exports `readEnv`, which touches `process`/`Bun`. `formatPriceIdr` is
  imported from `@biova/shared/product` so the client bundle stays free of
  server-only code. This only removes the env shim from the bundle; it never
  contained a secret value, which is read at runtime.
