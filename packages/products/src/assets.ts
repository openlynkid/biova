import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { productAssets } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import { createAssetSchema, MAX_ASSET_BYTES, type AssetView, type Result, ok, fail } from "@biova/shared";
import { sweepOrphans, type BlobStorage, type SweepResult } from "@biova/storage";

export type ProductAsset = typeof productAssets.$inferSelect;

export type AssetError = "not_found" | "invalid_input" | "too_large" | "storage_unavailable";

export interface AssetRepository {
  listByProduct(productId: string): Promise<ProductAsset[]>;
  listByProducts(productIds: string[]): Promise<ProductAsset[]>;
  findById(creatorId: string, assetId: string): Promise<ProductAsset | undefined>;
  // Unscoped lookup used by delivery after the signed token already proved the
  // buyer's entitlement; the product match is checked by the caller.
  findByIdUnscoped(assetId: string): Promise<ProductAsset | undefined>;
  create(args: {
    creatorId: string;
    productId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
    sortOrder: number;
  }): Promise<ProductAsset>;
  delete(creatorId: string, assetId: string): Promise<ProductAsset | undefined>;
  reorder(creatorId: string, productId: string, orderedIds: string[]): Promise<void>;
  // Every storage key any row still references. The orphan sweep compares the
  // store against this list, so a key missing here is a key nothing owns.
  listStorageKeys(): Promise<string[]>;
}

export function createAssetRepository(db: Database): AssetRepository {
  return {
    listByProduct(productId) {
      return db
        .select()
        .from(productAssets)
        .where(eq(productAssets.productId, productId))
        .orderBy(asc(productAssets.sortOrder), asc(productAssets.createdAt));
    },

    listByProducts(productIds) {
      if (productIds.length === 0) return Promise.resolve([]);
      return db
        .select()
        .from(productAssets)
        .where(inArray(productAssets.productId, productIds))
        .orderBy(asc(productAssets.sortOrder), asc(productAssets.createdAt));
    },

    async findById(creatorId, assetId) {
      const [row] = await db
        .select()
        .from(productAssets)
        .where(and(eq(productAssets.creatorId, creatorId), eq(productAssets.id, assetId)))
        .limit(1);
      return row;
    },

    async findByIdUnscoped(assetId) {
      const [row] = await db.select().from(productAssets).where(eq(productAssets.id, assetId)).limit(1);
      return row;
    },

    async create(args) {
      const [row] = await db.insert(productAssets).values(args).returning();
      return row;
    },

    async delete(creatorId, assetId) {
      const [row] = await db
        .delete(productAssets)
        .where(and(eq(productAssets.creatorId, creatorId), eq(productAssets.id, assetId)))
        .returning();
      return row;
    },

    async reorder(creatorId, productId, orderedIds) {
      if (orderedIds.length === 0) return;
      const positions = sql.join(
        orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
        sql`, `,
      );
      await db.execute(sql`
        update ${productAssets} as a
        set sort_order = v.position
        from (values ${positions}) as v(id, position)
        where a.id = v.id and a.creator_id = ${creatorId} and a.product_id = ${productId}
      `);
    },

    async listStorageKeys() {
      const rows = await db.select({ storageKey: productAssets.storageKey }).from(productAssets);
      return rows.map((row) => row.storageKey);
    },
  };
}

export type AssetSweepResult = SweepResult;

// Reconciles the store against the product-asset rows alone. The workspace-wide
// sweep (scripts/storage-sweep.ts) unions every domain's keys instead; this
// narrower form stays for callers that only own product assets.
export async function sweepOrphanedAssets(
  storage: BlobStorage,
  repository: AssetRepository,
  options?: { delete?: boolean },
): Promise<AssetSweepResult> {
  return sweepOrphans(storage, await repository.listStorageKeys(), options);
}

export interface AssetService {
  list(creatorId: string, productId: string): Promise<Result<AssetView[], AssetError>>;
  add(args: {
    creatorId: string;
    productId: string;
    fileName: string;
    contentType: string;
    data: Uint8Array;
  }): Promise<Result<AssetView, AssetError>>;
  remove(creatorId: string, assetId: string): Promise<Result<{ id: string }, AssetError>>;
  reorder(creatorId: string, productId: string, ids: string[]): Promise<Result<{ ids: string[] }, AssetError>>;
}

function toView(asset: ProductAsset): AssetView {
  return {
    id: asset.id,
    fileName: asset.fileName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    sortOrder: asset.sortOrder,
  };
}

export interface AssetServiceDeps {
  // Ownership is resolved by the caller (the product service) so this package
  // does not reach into another domain's repository.
  isOwnedProduct(creatorId: string, productId: string): Promise<boolean>;
}

export function createAssetService(
  repository: AssetRepository,
  storage: BlobStorage,
  deps: AssetServiceDeps,
  maxBytes: number = MAX_ASSET_BYTES,
): AssetService {
  return {
    async list(creatorId, productId) {
      if (!(await deps.isOwnedProduct(creatorId, productId))) return fail("not_found");
      const assets = await repository.listByProduct(productId);
      return ok(assets.map(toView));
    },

    async add(args) {
      const parsed = createAssetSchema.safeParse({
        fileName: args.fileName,
        contentType: args.contentType,
        sizeBytes: args.data.byteLength,
      });
      if (!parsed.success) {
        // Distinguish an oversized upload so the route can answer 413 instead of
        // a generic validation failure.
        return fail(args.data.byteLength > maxBytes ? "too_large" : "invalid_input");
      }
      if (!(await deps.isOwnedProduct(args.creatorId, args.productId))) return fail("not_found");

      const stored = await storage.put({ data: args.data, contentType: parsed.data.contentType, fileName: parsed.data.fileName });

      try {
        const existing = await repository.listByProduct(args.productId);
        const asset = await repository.create({
          creatorId: args.creatorId,
          productId: args.productId,
          fileName: parsed.data.fileName,
          contentType: parsed.data.contentType,
          sizeBytes: stored.sizeBytes,
          storageKey: stored.key,
          sortOrder: existing.length,
        });
        return ok(toView(asset));
      } catch (error) {
        // The row is the source of truth; if it cannot be written, do not leave
        // an orphan blob behind.
        await storage.remove(stored.key);
        throw error;
      }
    },

    async remove(creatorId, assetId) {
      const removed = await repository.delete(creatorId, assetId);
      if (!removed) return fail("not_found");
      // The row is gone, so the bytes are unreachable; drop them too. A storage
      // failure here must not fail the request, or the caller would retry a
      // delete that already succeeded.
      try {
        await storage.remove(removed.storageKey);
      } catch {
        // Ignore: the asset is already unreachable through the app.
      }
      return ok({ id: assetId });
    },

    async reorder(creatorId, productId, ids) {
      if (!(await deps.isOwnedProduct(creatorId, productId))) return fail("not_found");
      const owned = await repository.listByProduct(productId);
      const ownedIds = new Set(owned.map((asset) => asset.id));
      if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id))) return fail("invalid_input");
      await repository.reorder(creatorId, productId, ids);
      return ok({ ids });
    },
  };
}
