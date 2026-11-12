# ADR-0009: Asset storage and secure digital delivery

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 3 needs the last piece of the money path: after a payment settles, the
buyer must actually receive the files. PRD 4.3 (digital product management)
requires uploading digital assets, and PRD 4.5 (digital delivery) requires that
"file distribution links must not be exposed through the public page" and that
download access be signed or tokenized, with validity managed per product policy.

The entitlement row already exists (ADR-0008) and is created only after a
verified payment, so this increment builds on it: attach files to a product,
then let a buyer with an entitlement download them through a link that cannot be
guessed or shared indefinitely.

## Decision

### Two new packages, each with one job

- `packages/storage` defines the `BlobStorage` port (`put`, `get`, `remove`) and
  ships a local filesystem driver. The key is opaque: callers receive it from
  `put` and hand it back to `get`/`remove`, so a future S3 driver keys on the
  object name instead of a path and nothing above the port changes.
- `packages/delivery` owns download tokens and the buyer-facing delivery read
  model. It depends on `@biova/storage` and `@biova/shared` only; it reaches the
  orders and products domains through injected functions, so no domain imports
  another.

### Storage keys are server-generated, never client-supplied

- The local driver writes each object to `<shard>/<random><ext>` under
  `STORAGE_DIR`. The original file name is stored on the row for display only and
  is never used as a path; only a short extension is kept so the downloaded file
  opens with the right application.
- `get`/`remove` validate the key against a strict shape and then confirm the
  resolved path is still inside the storage root, so `..`, absolute paths and
  symlink-shaped input cannot escape.
- A relative `STORAGE_DIR` is anchored at the workspace root (the directory that
  holds `turbo.json`). In this monorepo the API and the web server run with
  different working directories, so a bare `.storage` would otherwise mean two
  different folders and a file uploaded through one app would be invisible to the
  other.

### Entitlement plus a signed, time-boxed token

- A download URL carries `v1.<base64url claims>.<HMAC-SHA256>` where the claims
  name the entitlement and the asset and an expiry. The signature is verified
  with a constant-time comparison, and the token is rejected when expired.
- On download the service re-checks three things, so a valid signature is never
  the only gate: the entitlement exists and is not revoked, the asset exists, and
  the asset belongs to the product the entitlement grants. A token whose payload
  was edited to point at another asset fails even if it were somehow signed.
- The storage key never appears in a URL or in any response. The buyer sees
  `fileName`, `contentType`, `sizeBytes` and a signed `downloadPath` only.
- `GET /v1/orders/:reference/downloads` returns items only when the order is paid
  and has at least one active entitlement; an unpaid or unknown reference
  discloses nothing (404).
- Revocation is honoured at download time: setting `revoked_at` on an entitlement
  immediately stops new downloads without touching stored files.

### Ownership and limits at the boundary

- Asset upload is `POST /v1/products/:id/assets` (multipart) behind a session.
  The service checks that the product belongs to the signed-in creator before
  writing anything, so a creator cannot attach a file to another creator's
  product. Listing, deleting and reordering are scoped the same way.
- The size cap (`MAX_ASSET_BYTES`, 50 MB by default) is enforced in the service
  from the actual byte length, and the route maps `too_large` to `413`.
- Removing a row also removes its bytes; if the storage delete fails, the request
  still succeeds because the row (the source of truth) is already gone.

## Consequences

- Delivery is decoupled from where bytes live: swapping in object storage is a new
  `BlobStorage` driver, not a domain change.
- A leaked download link expires on its own and cannot be retargeted at another
  buyer's file; an unpaid order exposes no link at all.
- `STORAGE_DIR` must be a durable, shared location in a multi-instance
  deployment (or replaced by a remote driver), because a local directory is not
  shared between instances.
- Download tokens are stateless, so there is no server-side list of issued links
  to revoke individually; revocation works through the entitlement, which is the
  row that grants access in the first place.
- Deleting an asset through the API removes its bytes as well, but deleting a
  whole product or creator cascades the `product_assets` rows in the database and
  leaves the bytes behind. `bun run storage:sweep` reconciles the two: it reports
  blobs no row references and removes them with `--delete`. It is a manual
  maintenance command rather than an automatic background job, because the rows
  are the source of truth and an orphaned blob is never reachable without one.
