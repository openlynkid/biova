import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { createProductRepository, createProductService, type ProductService } from "./index";

let context: TestDatabase;
let service: ProductService;
let creatorId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  service = createProductService(createProductRepository(context.db));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "seller", displayName: "Seller" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;
});

afterAll(async () => {
  await context.close();
});

describe("product service", () => {
  test("creates products in insertion order with a draft status", async () => {
    const first = await service.create({ creatorId, title: "E-book", slug: "ebook", priceIdr: 49_000 });
    const second = await service.create({ creatorId, title: "Preset pack", slug: "preset-pack", priceIdr: 0 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value.status).toBe("draft");
    expect(first.value.priceIdr).toBe(49_000);

    const list = await service.list(creatorId);
    expect(list.map((product) => product.slug)).toEqual(["ebook", "preset-pack"]);
    expect(list.map((product) => product.sortOrder)).toEqual([0, 1]);
  });

  test("rejects invalid slugs, titles and prices", async () => {
    const cases = [
      { title: "Ok", slug: "Bad Slug", priceIdr: 1000 },
      { title: "Ok", slug: "ok", priceIdr: -1 },
      { title: "Ok", slug: "ok", priceIdr: 1.5 },
      { title: "Ok", slug: "ok", priceIdr: 100_000_001 },
      { title: "   ", slug: "ok", priceIdr: 1000 },
    ];
    for (const input of cases) {
      expect(await service.create({ creatorId, ...input })).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  test("rejects a duplicate slug for the same creator but allows it for another", async () => {
    const created = await service.create({ creatorId, title: "Unique", slug: "unique", priceIdr: 1000 });
    expect(created.ok).toBe(true);

    const duplicate = await service.create({ creatorId, title: "Again", slug: "unique", priceIdr: 2000 });
    expect(duplicate).toEqual({ ok: false, error: "slug_taken" });

    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "other-seller", displayName: "Other" });
    if (!other.ok) throw new Error("setup failed");

    const sameSlugElsewhere = await service.create({ creatorId: other.value.id, title: "Unique", slug: "unique", priceIdr: 3000 });
    expect(sameSlugElsewhere.ok).toBe(true);
  });

  test("updates a product and rejects an unknown product", async () => {
    const created = await service.create({ creatorId, title: "Editable", slug: "editable", priceIdr: 1000 });
    if (!created.ok) throw new Error("setup failed");

    const updated = await service.update({ creatorId, productId: created.value.id, title: "Edited", priceIdr: 25_000 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.title).toBe("Edited");
    expect(updated.value.priceIdr).toBe(25_000);

    const missing = await service.update({ creatorId, productId: "00000000-0000-0000-0000-000000000000", title: "x" });
    expect(missing).toEqual({ ok: false, error: "not_found" });
  });

  test("enforces the status transition table", async () => {
    const created = await service.create({ creatorId, title: "Lifecycle", slug: "lifecycle", priceIdr: 1000 });
    if (!created.ok) throw new Error("setup failed");
    const id = created.value.id;

    const published = await service.setStatus(creatorId, id, "published");
    expect(published.ok && published.value.status).toBe("published");

    const archived = await service.setStatus(creatorId, id, "archived");
    expect(archived.ok && archived.value.status).toBe("archived");

    // archived -> published is not an allowed edge.
    const invalid = await service.setStatus(creatorId, id, "published");
    expect(invalid).toEqual({ ok: false, error: "invalid_transition" });

    const unknown = await service.setStatus(creatorId, id, "live");
    expect(unknown).toEqual({ ok: false, error: "invalid_input" });
  });

  test("cannot update, delete or publish a product owned by another creator", async () => {
    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "intruder2", displayName: "Intruder" });
    if (!other.ok) throw new Error("setup failed");

    const created = await service.create({ creatorId, title: "Mine", slug: "mine", priceIdr: 1000 });
    if (!created.ok) throw new Error("setup failed");

    expect(await service.update({ creatorId: other.value.id, productId: created.value.id, title: "Stolen" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await service.remove(other.value.id, created.value.id)).toEqual({ ok: false, error: "not_found" });
    expect(await service.setStatus(other.value.id, created.value.id, "published")).toEqual({
      ok: false,
      error: "not_found",
    });

    const stillThere = (await service.list(creatorId)).find((product) => product.id === created.value.id);
    expect(stillThere?.title).toBe("Mine");
  });

  test("lists only published products", async () => {
    const user = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const fresh = await creators.getOrCreate({ userId: user.id, slug: "catalog", displayName: "Catalog" });
    if (!fresh.ok) throw new Error("setup failed");

    const draft = await service.create({ creatorId: fresh.value.id, title: "Draft", slug: "draft-item", priceIdr: 1000 });
    const live = await service.create({ creatorId: fresh.value.id, title: "Live", slug: "live-item", priceIdr: 2000 });
    if (!draft.ok || !live.ok) throw new Error("setup failed");

    expect(await service.hasPublishedProduct(fresh.value.id)).toBe(false);
    await service.setStatus(fresh.value.id, live.value.id, "published");
    expect(await service.hasPublishedProduct(fresh.value.id)).toBe(true);

    const published = await service.listPublished(fresh.value.id);
    expect(published.map((product) => product.slug)).toEqual(["live-item"]);
  });

  test("reorders products and rejects an incomplete or foreign set", async () => {
    const user = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const fresh = await creators.getOrCreate({ userId: user.id, slug: "sorter", displayName: "Sorter" });
    if (!fresh.ok) throw new Error("setup failed");

    await service.create({ creatorId: fresh.value.id, title: "A", slug: "a-item", priceIdr: 1000 });
    await service.create({ creatorId: fresh.value.id, title: "B", slug: "b-item", priceIdr: 2000 });

    const list = await service.list(fresh.value.id);
    const reversed = [...list].reverse().map((product) => product.id);
    const result = await service.reorder(fresh.value.id, reversed);
    expect(result.ok).toBe(true);

    const after = await service.list(fresh.value.id);
    expect(after.map((product) => product.id)).toEqual(reversed);
    expect(after.map((product) => product.sortOrder)).toEqual(reversed.map((_, index) => index));

    expect(await service.reorder(fresh.value.id, [reversed[0]])).toEqual({ ok: false, error: "invalid_input" });
    expect(
      await service.reorder(fresh.value.id, [...reversed.slice(1), "00000000-0000-0000-0000-000000000000"]),
    ).toEqual({ ok: false, error: "invalid_input" });
  });
});
