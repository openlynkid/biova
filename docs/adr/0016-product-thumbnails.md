# ADR-0016: Product thumbnails

- Status: Accepted
- Date: 2026-11-12

## Context

PRD 4.3 lists "Product thumbnail" among the digital product features, but the
product catalog rendered as text only: a title, a description and a price. Every
other 4.x feature was already built, so the thumbnail was the last gap.

A product already has files, but those are the opposite of a thumbnail. Product
assets are private deliverables behind a signed, time-boxed link (ADR-0009),
while a thumbnail is meant to be seen by any visitor and cached hard. The
branding work (ADR-0015) had already established the pattern for a public image:
a versioned URL, image-only and size-capped, gated by publication. The thumbnail
follows that pattern rather than inventing a second one.

## Decision

### Columns on `products`, not a new table

- The image is one optional image per product, so it lives on the row:
  `thumbnail_key` and `thumbnail_content_type` (migration 0008). Both are null
  together; a product either has an image or it does not.
- A separate table would only add a join and a lifecycle for no gain. If a
  product ever needs multiple images, that becomes a new table then.
- `thumbnail_key` is server-generated and never exposed through the API, matching
  `product_assets.storage_key` and `creator_media.storage_key`.

### A third repository + service inside `@biova/products`

- `packages/products/src/thumbnail.ts` adds `ThumbnailRepository` (SQL) and
  `createThumbnailService` (rules, returning `Result`), the same split as
  `assets.ts`. The thumbnail belongs to the product domain, so it stays there
  rather than becoming its own package.
- The service reuses the shared `BlobStorage` port and the shared image rules:
  `imageUploadSchema` in `@biova/shared` accepts `image/png`, `image/jpeg`,
  `image/webp`, `image/avif` and `image/gif` up to `MAX_MEDIA_BYTES` (5 MB). A
  wrong type fails with `unsupported_type` (415); an oversized file fails with
  `too_large` (413).
- Ownership is part of every lookup: `getOwned`, `setThumbnail` and
  `clearThumbnail` all filter by `(creator_id, product_id)`, so a creator can
  never read or write another creator's product image.
- Replacement is safe against the row being the source of truth: the repository
  reads the previous key before the update, and the service removes the replaced
  blob only after the row points at the new one. If the row write fails, the
  just-written blob is removed and nothing dangles.

### A slug-scoped public route

- The read model is a versioned URL, never a storage key: `productThumbnailUrl`
  returns `/media/:slug/product/:id?v=<updatedAt seconds>`.
- The static `product` segment matters. Branding owns `/media/:slug/:kind`; a
  bare `/media/:slug/:id` would collide with it whenever a creator's slug is
  literally a product id, or vice versa. `/media/:slug/product/:id` cannot.
- `GET /media/:slug/product/:id` resolves the slug to a creator through
  `resolvePublishedCreatorId` and then checks the product is published and owned
  by that creator. So a thumbnail is served only while both the page and the
  product are published; a draft product's image never leaks. The response
  carries the stored content type and a long-lived `immutable` cache header,
  keyed by the version in the URL.

### Dashboard and read models

- `PUT /v1/products/:id/thumbnail` and `DELETE /v1/products/:id/thumbnail` are
  session-scoped multipart endpoints; the creator id comes from the session.
- The dashboard product row gains an `Image` panel: preview, upload/replace and
  remove. The public product card and the checkout header render the thumbnail
  when present and fall back to the text-only layout when not.
- The orphan sweep unions one more key source: `scripts/storage-sweep.ts` now
  collects product-asset, thumbnail and media keys, so a blob is removed only
  when nothing at all references it.

## Consequences

- Product thumbnails reuse the storage, serving and caching infrastructure built
  for branding, so a future S3 driver serves them with no domain change.
- A replaced thumbnail leaves no orphan behind, and deleting a product leaves at
  most one blob for the sweep to reconcile.
- The public page and the checkout page share one URL shape and one publication
  rule, so an image is never visible in one place but hidden in another.
- The size cap and the image-only rule are enforced server-side from the real
  bytes and content type; the dashboard's `accept` attribute is only a hint.
