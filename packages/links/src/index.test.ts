import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { createLinkRepository, createLinkService, type LinkService } from "./index";

let context: TestDatabase;
let service: LinkService;
let creatorId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  service = createLinkService(createLinkRepository(context.db));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "linker", displayName: "Linker" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;
});

afterAll(async () => {
  await context.close();
});

describe("link service", () => {
  test("creates links in insertion order", async () => {
    const first = await service.create({ creatorId, title: "First", url: "https://example.com" });
    const second = await service.create({ creatorId, title: "Second", url: "https://example.org" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const list = await service.list(creatorId);
    expect(list.map((link) => link.title)).toEqual(["First", "Second"]);
    expect(list[0].sortOrder).toBe(0);
    expect(list[1].sortOrder).toBe(1);
  });

  test("rejects non-http and javascript URLs", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "not-a-url"]) {
      const result = await service.create({ creatorId, title: "Bad", url });
      expect(result).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  test("updates a link and rejects an unknown link", async () => {
    const created = await service.create({ creatorId, title: "Editable", url: "https://example.com/edit" });
    if (!created.ok) throw new Error("setup failed");

    const updated = await service.update({ creatorId, linkId: created.value.id, title: "Edited" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.title).toBe("Edited");

    const missing = await service.update({ creatorId, linkId: "00000000-0000-0000-0000-000000000000", title: "x" });
    expect(missing).toEqual({ ok: false, error: "not_found" });
  });

  test("cannot update or delete a link owned by another creator", async () => {
    const otherUser = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const other = await creators.getOrCreate({ userId: otherUser.id, slug: "intruder", displayName: "Intruder" });
    if (!other.ok) throw new Error("setup failed");

    const created = await service.create({ creatorId, title: "Mine", url: "https://example.com/mine" });
    if (!created.ok) throw new Error("setup failed");

    const stolen = await service.update({ creatorId: other.value.id, linkId: created.value.id, title: "Stolen" });
    expect(stolen).toEqual({ ok: false, error: "not_found" });

    const removed = await service.remove(other.value.id, created.value.id);
    expect(removed).toEqual({ ok: false, error: "not_found" });

    const stillThere = (await service.list(creatorId)).find((link) => link.id === created.value.id);
    expect(stillThere?.title).toBe("Mine");
  });

  test("reorders links and rejects an incomplete or foreign set", async () => {
    const created = await service.create({ creatorId, title: "Reorder", url: "https://example.com/reorder" });
    if (!created.ok) throw new Error("setup failed");

    const list = await service.list(creatorId);
    const reversed = [...list].reverse().map((link) => link.id);
    const result = await service.reorder(creatorId, reversed);
    expect(result.ok).toBe(true);

    const after = await service.list(creatorId);
    expect(after.map((link) => link.id)).toEqual(reversed);
    expect(after.map((link) => link.sortOrder)).toEqual(reversed.map((_, index) => index));

    const partial = await service.reorder(creatorId, [reversed[0]]);
    expect(partial).toEqual({ ok: false, error: "invalid_input" });

    const foreign = await service.reorder(creatorId, [...reversed.slice(1), "00000000-0000-0000-0000-000000000000"]);
    expect(foreign).toEqual({ ok: false, error: "invalid_input" });
  });

  test("reports whether a creator has an enabled link", async () => {
    const user = await createTestUser(context.db);
    const creators = createCreatorService(createCreatorRepository(context.db));
    const fresh = await creators.getOrCreate({ userId: user.id, slug: "fresh", displayName: "Fresh" });
    if (!fresh.ok) throw new Error("setup failed");

    expect(await service.hasEnabledLink(fresh.value.id)).toBe(false);
    const created = await service.create({ creatorId: fresh.value.id, title: "One", url: "https://example.com/one", enabled: false });
    if (!created.ok) throw new Error("setup failed");
    expect(await service.hasEnabledLink(fresh.value.id)).toBe(false);

    await service.update({ creatorId: fresh.value.id, linkId: created.value.id, enabled: true });
    expect(await service.hasEnabledLink(fresh.value.id)).toBe(true);
  });
});
