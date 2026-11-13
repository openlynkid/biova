# ADR-0015: Creator media (avatar and cover)

- Status: Accepted
- Date: 2026-11-12

## Context

PRD 4.1 requires a creator profile with an avatar and a cover, and PRD 8 names
media as its own boundary: "Media: upload, storage, and secure delivery". Phase 3
already built the pieces media needs — the `BlobStorage` port and its local
driver (ADR-0009) — but branding had no domain of its own. A creator could
upload paid product files, yet had no way to set a profile image, and the public
page rendered a text-only header.

Branding differs from product assets in one decisive way: it is public. Product
files must never be reachable by URL (ADR-0009), while an avatar is meant to be
served to any visitor. That difference shapes every decision below.

## Decision

### A dedicated `@biova/media` domain

- `packages/media` owns `creator_media`, one row per `(creator_id, kind)` where
  `kind` is `avatar` or `cover` (unique index). Replacing an image updates the
  same row and swaps `storage_key`; it never grows the table.
- The domain exposes a repository (SQL) and a service (rules, returning
  `Result`), matching every other domain. `packages/core` constructs it from the
  same `Database` handle and the same `BlobStorage` instance the products domain
  uses, so there is one storage port for the whole workspace.
- `kind` is validated against `mediaKindSchema` in `@biova/shared`, and the
  upload is validated against `mediaUploadSchema` at the service boundary, so an
  unknown slot or a wrong size is rejected before any byte is written.

### Images only, size-capped, one blob per slot

- The accepted content types are `image/png`, `image/jpeg`, `image/webp`,
  `image/avif` and `image/gif`; anything else fails with `unsupported_type`
  (HTTP 415). This stops the branding slot from becoming a general file host,
  which the PRD explicitly rules out.
- `MAX_MEDIA_BYTES` is 5 MB, enforced from the actual byte length; a larger file
  fails with `too_large` (HTTP 413).
- The bytes are written under a server-generated key (`<shard>/<random><ext>`)
  through the `BlobStorage` port; the client never chooses a path.
- Replacement is safe against the row being the source of truth: the repository
  reads the previous key before the upsert, and the service removes the replaced
  blob only after the row points at the new one. If the row write fails, the
  just-written blob is removed and nothing dangles.

### Public serving, gated by publication

- The read model is a versioned URL, never a storage key: `mediaUrl` returns
  `/media/:slug/:kind?v=<updatedAt seconds>`. The version rides in the URL so a
  replacement changes the URL, which both busts a browser cache and lets the
  route answer with a long-lived `immutable` cache header.
- `GET /media/:slug/:kind` serves the bytes with the stored content type. It
  resolves the slug to a creator through `resolvePublishedCreatorId`, so it
  serves branding only while the page is published. A draft page's images are
  not reachable, matching the rule that a draft page never reveals itself.
- A slot the creator has not filled is omitted from the read model rather than
  returned empty, so the page renders a placeholder instead of a broken image.

### Ownership and the sweep

- `PUT /v1/media/:kind` and `DELETE /v1/media/:kind` are session-scoped; the
  creator id comes from the session, never the request, so a creator can only
  touch their own slots.
- `creator_media.storage_key` is unique and server-generated and never appears in
  a response.
- The orphan sweep now unions every domain's keys: `scripts/storage-sweep.ts`
  collects product-asset keys and media keys, so a blob is removed only when
  nothing at all references it. The shared `sweepOrphans` helper in
  `@biova/storage` is the one implementation; the products-specific
  `sweepOrphanedAssets` delegates to it.

## Consequences

- Branding reuses the storage and delivery infrastructure instead of inventing a
  second upload path, so a future S3 driver serves media with no domain change.
- A replaced avatar leaves no orphan behind, and deleting a creator (or the
  workspace) leaves at most one blob per slot for the sweep to reconcile.
- Public images are cached hard and keyed by version, so a replacement is visible
  immediately without a cache purge.
- The size cap and the image-only rule are enforced server-side from the real
  bytes and content type; the dashboard's `accept` attribute is only a hint.
- Branding is served from the application rather than a CDN. If media volume
  grows, the versioned URL is the natural cache key for one, and the storage port
  is where a remote driver would slot in.
