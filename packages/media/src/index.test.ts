import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import type { BlobStorage } from "@biova/storage";
import { createMediaRepository, createMediaService, type MediaService } from "./index";

// In-memory storage: the media tests care about the rows and the service rules,
// not the filesystem (that is covered by @biova/storage tests).
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  let counter = 0;
  const storage: BlobStorage = {
    async put({ data }) {
      counter += 1;
      const key = `bb/${counter.toString(16).padStart(32, "0")}`;
      objects.set(key, data);
      return { key, sizeBytes: data.byteLength };
    },
    async get(key) {
      return objects.get(key);
    },
    async remove(key) {
      objects.delete(key);
    },
    async list() {
      return [...objects.keys()];
    },
  };
  return { storage, objects };
}

let context: TestDatabase;
let service: MediaService;
let objects: Map<string, Uint8Array>;
let creatorId: string;
let slug: string;

const bytes = (text: string) => new TextEncoder().encode(text);
const png = (text: string) => ({ contentType: "image/png", data: bytes(text) });

beforeAll(async () => {
  context = await createTestDatabase();
  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "brand", displayName: "Brand" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;
  slug = created.value.slug;

  const memory = memoryStorage();
  objects = memory.objects;
  service = createMediaService(createMediaRepository(context.db), memory.storage);
});

afterAll(async () => {
  await context.close();
});

describe("media service", () => {
  test("uploads an avatar and exposes it as a versioned public URL", async () => {
    const result = await service.upload({ creatorId, kind: "avatar", ...png("avatar-bytes") });
    expect(result).toEqual({ ok: true, value: { kind: "avatar" } });

    const urls = await service.publicUrls(slug, creatorId);
    expect(urls.avatar).toMatch(new RegExp(`^/media/${slug}/avatar\\?v=\\d+$`));
    // A slot the creator has not filled is absent, not empty.
    expect(urls.cover).toBeUndefined();
  });

  test("serves the stored bytes with the declared content type", async () => {
    await service.upload({ creatorId, kind: "cover", ...png("cover-bytes") });
    const asset = await service.open(creatorId, "cover");
    expect(asset?.contentType).toBe("image/png");
    expect(new TextDecoder().decode(asset?.data)).toBe("cover-bytes");
  });

  test("replacing an image removes the previous blob", async () => {
    const first = await service.upload({ creatorId, kind: "avatar", ...png("first") });
    expect(first.ok).toBe(true);
    const before = objects.size;

    const second = await service.upload({ creatorId, kind: "avatar", ...png("second") });
    expect(second.ok).toBe(true);
    // One row per slot: the store does not grow when the slot is replaced.
    expect(objects.size).toBe(before);
    const asset = await service.open(creatorId, "avatar");
    expect(new TextDecoder().decode(asset?.data)).toBe("second");
  });

  test("rejects a non-image content type", async () => {
    const result = await service.upload({ creatorId, kind: "avatar", contentType: "application/zip", data: bytes("zip") });
    expect(result).toEqual({ ok: false, error: "unsupported_type" });
  });

  test("rejects an oversized image", async () => {
    const result = await service.upload({ creatorId, kind: "cover", contentType: "image/png", data: new Uint8Array(6 * 1024 * 1024) });
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  test("rejects an unknown slot", async () => {
    const result = await service.upload({ creatorId, kind: "banner", ...png("x") });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  test("remove clears the row and its bytes", async () => {
    await service.upload({ creatorId, kind: "cover", ...png("to-remove") });
    const before = objects.size;
    const removed = await service.remove(creatorId, "cover");
    expect(removed).toEqual({ ok: true, value: { kind: "cover" } });
    expect(objects.size).toBe(before - 1);
    expect(await service.open(creatorId, "cover")).toBeUndefined();
  });

  test("removing an empty slot is not_found", async () => {
    const result = await service.remove(creatorId, "cover");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  test("lists every storage key for the orphan sweep", async () => {
    const keys = await service.listStorageKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(objects.has(key)).toBe(true);
  });
});
