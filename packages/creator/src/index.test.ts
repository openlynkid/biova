import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService, type CreatorService } from "./index";

let context: TestDatabase;
let service: CreatorService;

beforeAll(async () => {
  context = await createTestDatabase();
  service = createCreatorService(createCreatorRepository(context.db));
});

afterAll(async () => {
  await context.close();
});

describe("creator service", () => {
  test("creates a creator for a user", async () => {
    const user = await createTestUser(context.db);
    const result = await service.getOrCreate({ userId: user.id, slug: "alice", displayName: "Alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe("alice");
    expect(result.value.displayName).toBe("Alice");
    expect(result.value.bio).toBeNull();
  });

  test("refuses a second creator for the same user", async () => {
    const user = await createTestUser(context.db);
    await service.getOrCreate({ userId: user.id, slug: "bob", displayName: "Bob" });
    const again = await service.getOrCreate({ userId: user.id, slug: "bob-two", displayName: "Bob Two" });
    expect(again).toEqual({ ok: false, error: "already_exists" });
  });

  test("refuses a slug that is already taken", async () => {
    const first = await createTestUser(context.db);
    const second = await createTestUser(context.db);
    await service.getOrCreate({ userId: first.id, slug: "taken", displayName: "First" });
    const result = await service.getOrCreate({ userId: second.id, slug: "taken", displayName: "Second" });
    expect(result).toEqual({ ok: false, error: "slug_taken" });
  });

  test("rejects reserved and malformed slugs", async () => {
    const user = await createTestUser(context.db);
    for (const slug of ["admin", "api", "AB", "-bad", "UPPER"]) {
      const result = await service.getOrCreate({ userId: user.id, slug, displayName: "Nope" });
      expect(result).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  test("updates the profile and refuses an empty display name", async () => {
    const user = await createTestUser(context.db);
    const created = await service.getOrCreate({ userId: user.id, slug: "carol", displayName: "Carol" });
    if (!created.ok) throw new Error("setup failed");

    const updated = await service.updateProfile({ creatorId: created.value.id, displayName: "Carol B", bio: "hello" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.displayName).toBe("Carol B");
    expect(updated.value.bio).toBe("hello");

    const blank = await service.updateProfile({ creatorId: created.value.id, displayName: "   " });
    expect(blank).toEqual({ ok: false, error: "invalid_input" });
  });

  test("looks creators up by slug and user id", async () => {
    const user = await createTestUser(context.db);
    await service.getOrCreate({ userId: user.id, slug: "dave", displayName: "Dave" });
    expect((await service.getBySlug("dave"))?.displayName).toBe("Dave");
    expect((await service.getByUserId(user.id))?.slug).toBe("dave");
    expect(await service.getBySlug("missing")).toBeUndefined();
  });
});
