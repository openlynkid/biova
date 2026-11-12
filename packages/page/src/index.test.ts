import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { createLinkRepository, createLinkService } from "@biova/links";
import { createPageRepository, createPageService, type PageService } from "./index";

let context: TestDatabase;
let pages: PageService;
let creatorId: string;
let links: ReturnType<typeof createLinkService>;

beforeAll(async () => {
  context = await createTestDatabase();
  links = createLinkService(createLinkRepository(context.db));
  pages = createPageService(createPageRepository(context.db), (id) => links.hasEnabledLink(id));

  const user = await createTestUser(context.db);
  const creators = createCreatorService(createCreatorRepository(context.db));
  const created = await creators.getOrCreate({ userId: user.id, slug: "pager", displayName: "Pager" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;
});

afterAll(async () => {
  await context.close();
});

describe("page service", () => {
  test("ensurePage is idempotent and starts as draft", async () => {
    const first = await pages.ensurePage(creatorId, "My page");
    const second = await pages.ensurePage(creatorId, "Ignored title");
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("draft");
    expect(first.publishedAt).toBeNull();
  });

  test("cannot publish a page with no enabled link", async () => {
    const result = await pages.setStatus(creatorId, "published");
    expect(result).toEqual({ ok: false, error: "not_publishable" });
  });

  test("publishes once a link exists and records publishedAt", async () => {
    const link = await links.create({ creatorId, title: "Home", url: "https://example.com" });
    expect(link.ok).toBe(true);

    const published = await pages.setStatus(creatorId, "published");
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.status).toBe("published");
    expect(published.value.publishedAt).not.toBeNull();
  });

  test("exposes the published page by slug only while published", async () => {
    expect((await pages.getPublishedBySlug("pager"))?.status).toBe("published");

    await pages.setStatus(creatorId, "draft");
    expect(await pages.getPublishedBySlug("pager")).toBeUndefined();
    await pages.setStatus(creatorId, "published");
  });

  test("rejects unknown statuses and invalid transitions", async () => {
    const unknown = await pages.setStatus(creatorId, "live");
    expect(unknown).toEqual({ ok: false, error: "invalid_input" });

    await pages.setStatus(creatorId, "archived");
    const archivedToPublished = await pages.setStatus(creatorId, "published");
    expect(archivedToPublished).toEqual({ ok: false, error: "invalid_transition" });
    await pages.setStatus(creatorId, "draft");
  });

  test("updates title and theme, and refuses a blank title", async () => {
    const updated = await pages.update({ creatorId, title: "Renamed", theme: { accent: "#0af" } });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.title).toBe("Renamed");
    expect(updated.value.theme).toEqual({ accent: "#0af" });

    const blank = await pages.update({ creatorId, title: "   " });
    expect(blank).toEqual({ ok: false, error: "invalid_input" });
  });
});
