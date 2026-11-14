import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import type { BlobStorage } from "@biova/storage";
import { createProductRepository, createProductService, type ProductService } from "./index";
import { createThumbnailRepository, createThumbnailService, type ThumbnailService } from "./thumbnail";

// In-memory storage: these tests care about the rows and the service rules, not
// the filesystem (that is covered by @biova/storage tests).
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
let products: ProductService;
let thumbnails: ThumbnailService;
let objects: Map<string, Uint8Array>;
let creatorId: string;
let productId: string;

const bytes = (text: string) => new TextEncoder().encode(text);
const png = (text: string) => ({ contentType: "image/png", data: bytes(text) });

beforeAll(async () => {
  context = await createTestDatabase();
  products = createProductService(createProductRepository(context.db));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "seller", displayName: "Seller" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;

  const product = await products.create({ creatorId, title: "E-book", slug: "ebook", priceIdr: 49_000 });
  if (!product.ok) throw new Error("failed to create product");
  productId = product.value.id;

  const memory = memoryStorage();
  objects = memory.objects;
  thumbnails = createThumbnailService(createThumbnailRepository(context.db), memory.storage);
});

afterAll(async () => {
  await context.close();
});

describe("thumbnail service", () => {
  test("uploads a thumbnail and exposes a versioned public URL", async () => {
    const result = await thumbnails.upload({ creatorId, productId, ...png("first") });
    expect(result.ok).toBe(true);

    const product = await products.findPublished(creatorId, productId);
    // The product is still a draft, so it is not served publicly; the URL is
    // built from the row directly for this check.
    expect(product).toBeUndefined();

    const owned = await products.list(creatorId);
    const row = owned.find((item) => item.id === productId);
    expect(row?.thumbnailKey).not.toBeNull();
    expect(row?.thumbnailContentType).toBe("image/png");
    expect(thumbnails.publicUrl("seller", productId, row!.updatedAt)).toMatch(/^\/media\/seller\/product\/.+\?v=\d+$/);

    const opened = await thumbnails.open(creatorId, productId);
    expect(opened?.contentType).toBe("image/png");
    expect(new TextDecoder().decode(opened?.data)).toBe("first");
  });

  test("replacing a thumbnail swaps the blob and removes the old one", async () => {
    const before = await products.list(creatorId);
    const firstKey = before.find((item) => item.id === productId)!.thumbnailKey!;

    await thumbnails.upload({ creatorId, productId, ...png("second") });

    const after = await products.list(creatorId);
    const secondKey = after.find((item) => item.id === productId)!.thumbnailKey!;
    expect(secondKey).not.toBe(firstKey);
    expect(objects.has(firstKey)).toBe(false);
    expect(objects.has(secondKey)).toBe(true);
  });

  test("rejects a non-image content type as unsupported", async () => {
    const result = await thumbnails.upload({ creatorId, productId, contentType: "application/pdf", data: bytes("x") });
    expect(result).toEqual({ ok: false, error: "unsupported_type" });
  });

  test("rejects an oversized file", async () => {
    const result = await thumbnails.upload({
      creatorId,
      productId,
      contentType: "image/png",
      data: new Uint8Array(6 * 1024 * 1024),
    });
    expect(result).toEqual({ ok: false, error: "too_large" });
  });

  test("rejects an unknown or unowned product", async () => {
    const other = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const otherCreator = await creators.getOrCreate({ userId: other.id, slug: "other", displayName: "Other" });
    if (!otherCreator.ok) throw new Error("setup failed");

    expect(await thumbnails.upload({ creatorId: otherCreator.value.id, productId, ...png("x") })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await thumbnails.remove(otherCreator.value.id, productId)).toEqual({ ok: false, error: "not_found" });
  });

  test("removes the thumbnail and its blob", async () => {
    const before = await products.list(creatorId);
    const key = before.find((item) => item.id === productId)!.thumbnailKey!;

    const result = await thumbnails.remove(creatorId, productId);
    expect(result.ok).toBe(true);
    expect(objects.has(key)).toBe(false);
    expect(await thumbnails.open(creatorId, productId)).toBeUndefined();

    const after = await products.list(creatorId);
    expect(after.find((item) => item.id === productId)!.thumbnailKey).toBeNull();
  });

  test("removing when there is no thumbnail is not found", async () => {
    expect(await thumbnails.remove(creatorId, productId)).toEqual({ ok: false, error: "not_found" });
  });

  test("lists only the storage keys that rows still reference", async () => {
    expect(await thumbnails.listStorageKeys()).toEqual([]);
    await thumbnails.upload({ creatorId, productId, ...png("kept") });
    const keys = await thumbnails.listStorageKeys();
    expect(keys).toHaveLength(1);
    expect(objects.has(keys[0])).toBe(true);
  });
});
