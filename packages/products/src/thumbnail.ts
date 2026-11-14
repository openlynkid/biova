import { and, eq, isNotNull } from "drizzle-orm";
import { products } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import {
  MAX_MEDIA_BYTES,
  imageUploadSchema,
  productThumbnailUrl,
  type Result,
  ok,
  fail,
} from "@biova/shared";
import type { BlobStorage } from "@biova/storage";

export type ThumbnailError = "not_found" | "invalid_input" | "unsupported_type" | "too_large" | "storage_unavailable";

export interface ThumbnailAsset {
  contentType: string;
  data: Uint8Array;
}

export interface ThumbnailRepository {
  // The current thumbnail columns, or undefined when the product is not owned
  // by the creator. Ownership is part of the lookup, so a creator can never
  // read or write another creator's product image.
  getOwned(creatorId: string, productId: string): Promise<{ key: string | null; contentType: string | null } | undefined>;
  setThumbnail(args: {
    creatorId: string;
    productId: string;
    storageKey: string;
    contentType: string;
  }): Promise<{ replacedKey: string | null } | undefined>;
  clearThumbnail(creatorId: string, productId: string): Promise<{ removedKey: string | null } | undefined>;
  // Every thumbnail key any product still references, for the orphan sweep.
  listStorageKeys(): Promise<string[]>;
}

export function createThumbnailRepository(db: Database): ThumbnailRepository {
  return {
    async getOwned(creatorId, productId) {
      const [row] = await db
        .select({ key: products.thumbnailKey, contentType: products.thumbnailContentType })
        .from(products)
        .where(and(eq(products.creatorId, creatorId), eq(products.id, productId)))
        .limit(1);
      return row;
    },

    async setThumbnail(args) {
      // Read the current key first: after the update the row points at the new
      // blob, so the replaced key can no longer be recovered from it.
      const previous = await this.getOwned(args.creatorId, args.productId);
      if (!previous) return undefined;
      const [row] = await db
        .update(products)
        .set({ thumbnailKey: args.storageKey, thumbnailContentType: args.contentType })
        .where(and(eq(products.creatorId, args.creatorId), eq(products.id, args.productId)))
        .returning({ id: products.id });
      if (!row) return undefined;
      return { replacedKey: previous.key };
    },

    async clearThumbnail(creatorId, productId) {
      const previous = await this.getOwned(creatorId, productId);
      if (!previous) return undefined;
      await db
        .update(products)
        .set({ thumbnailKey: null, thumbnailContentType: null })
        .where(and(eq(products.creatorId, creatorId), eq(products.id, productId)));
      return { removedKey: previous.key };
    },

    async listStorageKeys() {
      const rows = await db
        .select({ key: products.thumbnailKey })
        .from(products)
        .where(isNotNull(products.thumbnailKey));
      return rows.flatMap((row) => (row.key ? [row.key] : []));
    },
  };
}

export interface ThumbnailService {
  // Uploads or replaces the thumbnail. Validated as an image and capped, and
  // the replaced blob is removed once the row points at the new one.
  upload(args: {
    creatorId: string;
    productId: string;
    contentType: string;
    data: Uint8Array;
  }): Promise<Result<{ productId: string }, ThumbnailError>>;
  remove(creatorId: string, productId: string): Promise<Result<{ productId: string }, ThumbnailError>>;
  // The bytes behind a product thumbnail, for the public serving route. The
  // route resolves the product through a published page first, so this is scoped
  // by creator to keep the ownership check in one place.
  open(creatorId: string, productId: string): Promise<ThumbnailAsset | undefined>;
  // Public thumbnail URL for a product, keyed by creator slug and version.
  publicUrl(slug: string, productId: string, updatedAt: Date): string;
  listStorageKeys(): Promise<string[]>;
}

export function createThumbnailService(
  repository: ThumbnailRepository,
  storage: BlobStorage,
  maxBytes: number = MAX_MEDIA_BYTES,
): ThumbnailService {
  return {
    async upload(args) {
      const parsed = imageUploadSchema.safeParse({ contentType: args.contentType, sizeBytes: args.data.byteLength });
      if (!parsed.success) {
        // A wrong type is distinct from an oversized file so the route can answer
        // 415 instead of a generic 400.
        const typeOk = imageUploadSchema.shape.contentType.safeParse(args.contentType).success;
        return fail(args.data.byteLength > maxBytes ? "too_large" : typeOk ? "invalid_input" : "unsupported_type");
      }

      const owned = await repository.getOwned(args.creatorId, args.productId);
      if (!owned) return fail("not_found");

      const stored = await storage.put({
        data: args.data,
        contentType: parsed.data.contentType,
        fileName: "thumbnail.img",
      });

      try {
        const updated = await repository.setThumbnail({
          creatorId: args.creatorId,
          productId: args.productId,
          storageKey: stored.key,
          contentType: parsed.data.contentType,
        });
        if (!updated) {
          await storage.remove(stored.key);
          return fail("not_found");
        }
        // The row is the source of truth. Once it points at the new blob, the
        // replaced blob is unreachable and can be removed.
        if (updated.replacedKey) await storage.remove(updated.replacedKey);
        return ok({ productId: args.productId });
      } catch (error) {
        await storage.remove(stored.key);
        void error;
        return fail("storage_unavailable");
      }
    },

    async remove(creatorId, productId) {
      const cleared = await repository.clearThumbnail(creatorId, productId);
      if (!cleared || !cleared.removedKey) return fail("not_found");
      await storage.remove(cleared.removedKey);
      return ok({ productId });
    },

    async open(creatorId, productId) {
      const row = await repository.getOwned(creatorId, productId);
      return readThumbnail(storage, row);
    },

    publicUrl(slug, productId, updatedAt) {
      return productThumbnailUrl(slug, productId, Math.floor(updatedAt.getTime() / 1000));
    },

    listStorageKeys() {
      return repository.listStorageKeys();
    },
  };
}

async function readThumbnail(
  storage: BlobStorage,
  row: { key: string | null; contentType: string | null } | undefined,
): Promise<ThumbnailAsset | undefined> {
  if (!row || !row.key || !row.contentType) return undefined;
  const data = await storage.get(row.key);
  if (!data) return undefined;
  return { contentType: row.contentType, data };
}
