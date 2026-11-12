import { z } from "zod";

// Upload limits. The cap is enforced at the route (before the body is buffered)
// and again in the storage service, so neither a wrong route nor a direct call
// can store an oversized file.
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const assetFileNameSchema = z.string().trim().min(1).max(255);
export const assetContentTypeSchema = z.string().trim().min(1).max(128);
export const assetSizeSchema = z.number().int().positive().max(MAX_ASSET_BYTES);

export const createAssetSchema = z.object({
  fileName: assetFileNameSchema,
  contentType: assetContentTypeSchema,
  sizeBytes: assetSizeSchema,
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;

// A stored asset as the creator sees it. The storage key (where the bytes live)
// is deliberately absent: it never leaves the server.
export interface AssetView {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sortOrder: number;
}

// Signed, time-boxed download token. The token is an HMAC over the entitlement
// and asset ids plus an expiry, so a link cannot be forged or edited to point at
// another buyer's asset, and it stops working on its own after the TTL.
export const DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 15;

export interface DownloadTokenClaims {
  entitlementId: string;
  assetId: string;
  expiresAt: number;
}

export const downloadTokenClaimsSchema = z.object({
  entitlementId: z.uuid(),
  assetId: z.uuid(),
  expiresAt: z.number().int().positive(),
});

// Human-readable file size for the dashboard and receipt.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
