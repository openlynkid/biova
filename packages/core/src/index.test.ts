import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createServices, getPublicPage, type BiovaServices } from "./index";

let context: TestDatabase;
let services: BiovaServices;
let creatorId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  services = createServices(context.db);

  const user = await createTestUser(context.db);
  const created = await services.creators.getOrCreate({ userId: user.id, slug: "coreuser", displayName: "Core" });
  if (!created.ok) throw new Error("failed to create creator");
  creatorId = created.value.id;
  await services.pages.ensurePage(creatorId);
});

afterAll(async () => {
  await context.close();
});

describe("public page read model", () => {
  test("is hidden while the page is a draft", async () => {
    expect(await getPublicPage(services, "coreuser")).toBeUndefined();
  });

  test("only exposes enabled links and only known theme keys", async () => {
    await services.links.create({ creatorId, title: "Visible", url: "https://example.com" });
    await services.links.create({ creatorId, title: "Hidden", url: "https://example.com/hidden", enabled: false });
    await services.pages.update({ creatorId, theme: { accent: "#0af" } });
    await services.pages.setStatus(creatorId, "published");

    const page = await getPublicPage(services, "coreuser");
    expect(page).toBeDefined();
    if (!page) return;
    expect(page.links.map((link) => link.title)).toEqual(["Visible"]);
    expect(page.page.theme).toEqual({ accent: "#0af" });
  });

  test("returns undefined for an unknown username", async () => {
    expect(await getPublicPage(services, "nobody")).toBeUndefined();
  });
});
