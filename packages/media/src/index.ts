import { and, eq } from "drizzle-orm";
import { creatorMedia } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import {
  MAX_MEDIA_BYTES,
  mediaUploadSchema,
  mediaUrl,
  type MediaKind,
  type Result,
  ok,
  fail,
} from "@biova/shared";
import type { BlobStorage } from "@biova/storage";

export type CreatorMedia = typeof creatorMedia.$inferSelect;

export type MediaError = "not_found" | "invalid_input" | "unsupported_type" | "too_large" | "storage_unavailable";

export interface MediaRepository {
  findByCreator(creatorId: string, kind: MediaKind): Promise<CreatorMedia | undefined>;
  listByCreator(creatorId: string): Promise<CreatorMedia[]>;
  // Writes the slot and returns the previous key so the caller can remove the
  // replaced blob. `replacedKey` is undefined on a first upload.
  put(args: {
    creatorId: string;
    kind: MediaKind;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
  }): Promise<{ row: CreatorMedia; replacedKey: string | undefined }>;
  remove(creatorId: string, kind: MediaKind): Promise<CreatorMedia | undefined>;
  // Every key any row still references, for the orphan sweep.
  listStorageKeys(): Promise<string[]>;
}

export function createMediaRepository(db: Database): MediaRepository {
  return {
    async findByCreator(creatorId, kind) {
      const [row] = await db
        .select()
        .from(creatorMedia)
        .where(and(eq(creatorMedia.creatorId, creatorId), eq(creatorMedia.kind, kind)))
        .limit(1);
      return row;
    },

    listByCreator(creatorId) {
      return db.select().from(creatorMedia).where(eq(creatorMedia.creatorId, creatorId));
    },

    async put(args) {
      // Read the current key first: after the upsert the row points at the new
      // blob, so the replaced key can no longer be recovered from it.
      const previous = await this.findByCreator(args.creatorId, args.kind);
      const [row] = await db
        .insert(creatorMedia)
        .values({
          creatorId: args.creatorId,
          kind: args.kind,
          contentType: args.contentType,
          sizeBytes: args.sizeBytes,
          storageKey: args.storageKey,
        })
        .onConflictDoUpdate({
          target: [creatorMedia.creatorId, creatorMedia.kind],
          set: {
            contentType: args.contentType,
            sizeBytes: args.sizeBytes,
            storageKey: args.storageKey,
            updatedAt: new Date(),
          },
        })
        .returning();
      return { row, replacedKey: previous?.storageKey };
    },

    async remove(creatorId, kind) {
      const [row] = await db
        .delete(creatorMedia)
        .where(and(eq(creatorMedia.creatorId, creatorId), eq(creatorMedia.kind, kind)))
        .returning();
      return row;
    },

    async listStorageKeys() {
      const rows = await db.select({ storageKey: creatorMedia.storageKey }).from(creatorMedia);
      return rows.map((row) => row.storageKey);
    },
  };
}

export interface MediaAsset {
  contentType: string;
  data: Uint8Array;
}

export interface MediaService {
  // Public read model for a creator's branding, keyed by slug. Absent slots are
  // omitted, so the page renders a placeholder rather than a broken image.
  publicUrls(slug: string, creatorId: string): Promise<Partial<Record<MediaKind, string>>>;
  // The bytes behind a slot, for the public serving route. Undefined when the
  // creator has not uploaded that slot.
  open(creatorId: string, kind: MediaKind): Promise<MediaAsset | undefined>;
  upload(args: {
    creatorId: string;
    kind: string;
    contentType: string;
    data: Uint8Array;
  }): Promise<Result<{ kind: MediaKind }, MediaError>>;
  remove(creatorId: string, kind: string): Promise<Result<{ kind: MediaKind }, MediaError>>;
  listStorageKeys(): Promise<string[]>;
}

export function createMediaService(
  repository: MediaRepository,
  storage: BlobStorage,
  maxBytes: number = MAX_MEDIA_BYTES,
): MediaService {
  return {
    async publicUrls(slug, creatorId) {
      const rows = await repository.listByCreator(creatorId);
      const urls: Partial<Record<MediaKind, string>> = {};
      for (const row of rows) {
        const kind = row.kind as MediaKind;
        urls[kind] = mediaUrl(slug, kind, Math.floor(row.updatedAt.getTime() / 1000));
      }
      return urls;
    },

    async open(creatorId, kind) {
      const row = await repository.findByCreator(creatorId, kind);
      if (!row) return undefined;
      const data = await storage.get(row.storageKey);
      if (!data) return undefined;
      return { contentType: row.contentType, data };
    },

    async upload(args) {
      const parsed = mediaUploadSchema.safeParse({
        kind: args.kind,
        contentType: args.contentType,
        sizeBytes: args.data.byteLength,
      });
      if (!parsed.success) {
        // A wrong type is a distinct failure from an oversized file so the route
        // can answer 415 instead of a generic 400.
        const typeOk = mediaUploadSchema.shape.contentType.safeParse(args.contentType).success;
        return fail(args.data.byteLength > maxBytes ? "too_large" : typeOk ? "invalid_input" : "unsupported_type");
      }

      const stored = await storage.put({
        data: args.data,
        contentType: parsed.data.contentType,
        fileName: `${parsed.data.kind}.img`,
      });

      try {
        const { replacedKey } = await repository.put({
          creatorId: args.creatorId,
          kind: parsed.data.kind,
          contentType: parsed.data.contentType,
          sizeBytes: stored.sizeBytes,
          storageKey: stored.key,
        });
        // The row is the source of truth. Once it points at the new blob, the
        // replaced blob is unreachable and can be removed.
        if (replacedKey) await storage.remove(replacedKey);
        return ok({ kind: parsed.data.kind });
      } catch (error) {
        await storage.remove(stored.key);
        void error;
        return fail("storage_unavailable");
      }
    },

    async remove(creatorId, kind) {
      const parsed = mediaUploadSchema.shape.kind.safeParse(kind);
      if (!parsed.success) return fail("invalid_input");
      const row = await repository.remove(creatorId, parsed.data);
      if (!row) return fail("not_found");
      await storage.remove(row.storageKey);
      return ok({ kind: parsed.data });
    },

    listStorageKeys() {
      return repository.listStorageKeys();
    },
  };
}
