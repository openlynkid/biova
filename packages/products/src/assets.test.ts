import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import type { BlobStorage } from "@biova/storage";
import {
  createAssetRepository,
  createAssetService,
  createProductRepository,
  createProductService,
  sweepOrphanedAssets,
  type AssetRepository,
  type AssetService,
} from "./index";

// In-memory storage: the asset tests care about the rows and the service rules,
// not about the filesystem (that is covered by @biova/storage tests).
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  let counter = 0;
  const storage: BlobStorage = {
    async put({ data }) {
      counter += 1;
      const key = `aa/${counter.toString(16).padStart(32, "0")}`;
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
let service: AssetService;
let repository: AssetRepository;
let storage: BlobStorage;
let products: ReturnType<typeof createProductService>;
let creatorId: string;
let productId: string;
let objects: Map<string, Uint8Array>;

const bytes = (text: string) => new TextEncoder().encode(text);

beforeAll(async () => {
  context = await createTestDatabase();
  products = createProductService(createProductRepository(context.db));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "seller", displayName: "Seller" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;

  const product = await products.create({ creatorId, title: "E-book", slug: "ebook", priceIdr: 75_000 });
  if (!product.ok) throw new Error("failed to create product");
  productId = product.value.id;

  const memory = memoryStorage();
  objects = memory.objects;
  storage = memory.storage;
  repository = createAssetRepository(context.db);
  service = createAssetService(repository, memory.storage, {
    isOwnedProduct: (creator, id) => products.ownsProduct(creator, id),
  });
});

afterAll(async () => {
  await context.close();
});

describe("asset service", () => {
  test("adds an asset and lists it with metadata", async () => {
    const added = await service.add({ creatorId, productId, fileName: "preset.zip", contentType: "application/zip", data: bytes("zipdata") });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.fileName).toBe("preset.zip");
    expect(added.value.sizeBytes).toBe(7);

    const listed = await service.list(creatorId, productId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    // The storage key is never part of the creator-facing view.
    expect(JSON.stringify(listed.value)).not.toContain("storageKey");
  });

  test("refuses to add an asset to another creator's product", async () => {
    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "other", displayName: "Other" });
    if (!other.ok) throw new Error("failed to create other creator");

    const result = await service.add({
      creatorId: other.value.id,
      productId,
      fileName: "steal.zip",
      contentType: "application/zip",
      data: bytes("x"),
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  test("rejects an empty file name", async () => {
    const result = await service.add({ creatorId, productId, fileName: "   ", contentType: "application/zip", data: bytes("x") });
    expect(result).toEqual({ ok: false, error: "invalid_input" });
  });

  test("removes an asset and its bytes", async () => {
    const added = await service.add({ creatorId, productId, fileName: "temp.txt", contentType: "text/plain", data: bytes("temp") });
    if (!added.ok) throw new Error("expected asset");
    const before = objects.size;

    const removed = await service.remove(creatorId, added.value.id);
    expect(removed).toEqual({ ok: true, value: { id: added.value.id } });
    expect(objects.size).toBe(before - 1);

    const listed = await service.list(creatorId, productId);
    if (!listed.ok) throw new Error("expected list");
    expect(listed.value.some((asset) => asset.id === added.value.id)).toBe(false);
  });

  test("does not remove an asset owned by another creator", async () => {
    const added = await service.add({ creatorId, productId, fileName: "keep.txt", contentType: "text/plain", data: bytes("keep") });
    if (!added.ok) throw new Error("expected asset");
    const foreignId = "99999999-9999-4999-8999-999999999999";
    expect(await service.remove(creatorId, foreignId)).toEqual({ ok: false, error: "not_found" });
  });

  test("reorders only the full set of a product's assets", async () => {
    const fresh = await products.create({ creatorId, title: "Pack", slug: "pack", priceIdr: 10_000 });
    if (!fresh.ok) throw new Error("failed to create product");
    const a = await service.add({ creatorId, productId: fresh.value.id, fileName: "a.txt", contentType: "text/plain", data: bytes("a") });
    const b = await service.add({ creatorId, productId: fresh.value.id, fileName: "b.txt", contentType: "text/plain", data: bytes("b") });
    if (!a.ok || !b.ok) throw new Error("expected assets");

    const bad = await service.reorder(creatorId, fresh.value.id, [a.value.id]);
    expect(bad).toEqual({ ok: false, error: "invalid_input" });

    const good = await service.reorder(creatorId, fresh.value.id, [b.value.id, a.value.id]);
    expect(good.ok).toBe(true);
    const listed = await service.list(creatorId, fresh.value.id);
    if (!listed.ok) throw new Error("expected list");
    expect(listed.value.map((asset) => asset.fileName)).toEqual(["b.txt", "a.txt"]);
  });
});

describe("orphan sweep", () => {
  test("reports nothing when every stored key has a row", async () => {
    const result = await sweepOrphanedAssets(storage, repository);
    expect(result.orphans).toEqual([]);
    expect(result.objects).toBe(result.referenced);
  });

  test("finds bytes left behind when a product is deleted, and removes them only on request", async () => {
    const temp = await products.create({ creatorId, title: "Temp", slug: "temp", priceIdr: 1_000 });
    if (!temp.ok) throw new Error("failed to create product");
    const added = await service.add({ creatorId, productId: temp.value.id, fileName: "gone.txt", contentType: "text/plain", data: bytes("gone") });
    if (!added.ok) throw new Error("expected asset");
    const key = [...objects.keys()].at(-1);
    if (!key) throw new Error("expected stored key");

    // Deleting the product cascades the row but leaves the blob in the store.
    await products.remove(creatorId, temp.value.id);
    expect(objects.has(key)).toBe(true);

    const report = await sweepOrphanedAssets(storage, repository);
    expect(report.orphans).toContain(key);

    const cleaned = await sweepOrphanedAssets(storage, repository, { delete: true });
    expect(cleaned.removed).toBeGreaterThan(0);
    expect(objects.has(key)).toBe(false);
  });
});
