import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDatabase, createTestUser, type TestDatabase } from "@biova/database/testing";
import { createCreatorRepository, createCreatorService } from "@biova/creator";
import { createPageRepository, createPageService } from "@biova/page";
import type { PluginCatalog, PluginManifest } from "@biova/shared";
import { createPluginRepository, createPluginService, type PluginService } from "./index";

const socialLinks: PluginManifest = {
  id: "social-links",
  name: "Social Links",
  version: "1.0.0",
  description: "Links block",
  compatibility: { sdk: "^0.1.0", core: "^0.1.0" },
  permissions: ["page:read", "page:write"],
  extensions: { pageBlocks: true },
};

// A second plugin that declares no page blocks, to prove a block cannot be added
// for a plugin that does not offer one.
const noBlocks: PluginManifest = {
  id: "no-blocks",
  name: "No Blocks",
  version: "1.0.0",
  description: "Nothing",
  compatibility: { sdk: "^0.1.0", core: "^0.1.0" },
  permissions: [],
  extensions: {},
};

function catalog(manifests: PluginManifest[]): PluginCatalog {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  return { get: (id) => byId.get(id), list: () => [...byId.values()] };
}

let context: TestDatabase;
let service: PluginService;
let aliceId: string;
let bobId: string;
let alicePageId: string;

beforeAll(async () => {
  context = await createTestDatabase();
  const creators = createCreatorService(createCreatorRepository(context.db));
  const pages = createPageService(createPageRepository(context.db), async () => true);

  const alice = await creators.getOrCreate({ userId: (await createTestUser(context.db)).id, slug: "alice", displayName: "Alice" });
  const bob = await creators.getOrCreate({ userId: (await createTestUser(context.db)).id, slug: "bob", displayName: "Bob" });
  if (!alice.ok || !bob.ok) throw new Error("failed to create creators");
  aliceId = alice.value.id;
  bobId = bob.value.id;
  alicePageId = (await pages.ensurePage(aliceId)).id;

  service = createPluginService(createPluginRepository(context.db), catalog([socialLinks, noBlocks]));
});

afterAll(async () => {
  await context.close();
});

describe("plugin install and activation", () => {
  test("a plugin starts installed but disabled with no permissions", async () => {
    const result = await service.install(aliceId, "social-links");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.installed).toBe(true);
    expect(result.value.enabled).toBe(false);
    expect(result.value.grantedPermissions).toEqual([]);
  });

  test("install is idempotent and rejects an unknown plugin", async () => {
    await service.install(aliceId, "social-links");
    const list = await service.listForCreator(aliceId);
    expect(list.filter((plugin) => plugin.installed)).toHaveLength(1);
    expect((await service.install(aliceId, "ghost")).ok).toBe(false);
  });

  test("a block cannot be added while the plugin is disabled", async () => {
    const result = await service.addBlock({
      creatorId: aliceId,
      pageId: alicePageId,
      pluginId: "social-links",
      blockType: "social-links",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("plugin_disabled");
  });

  test("enabling allows a block and the public read model returns it", async () => {
    await service.setEnabled(aliceId, "social-links", true);
    const added = await service.addBlock({
      creatorId: aliceId,
      pageId: alicePageId,
      pluginId: "social-links",
      blockType: "social-links",
      config: { links: [{ label: "Site", url: "https://example.com" }] },
    });
    expect(added.ok).toBe(true);

    const blocks = await service.listPublicBlocks(aliceId, alicePageId);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockType).toBe("social-links");
  });

  test("a plugin that declares no blocks cannot add one", async () => {
    await service.install(aliceId, "no-blocks");
    await service.setEnabled(aliceId, "no-blocks", true);
    const result = await service.addBlock({ creatorId: aliceId, pageId: alicePageId, pluginId: "no-blocks", blockType: "anything" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_input");
  });
});

describe("permission management", () => {
  test("grant narrows to declared permissions and revoke removes", async () => {
    const denied = await service.grantPermission(aliceId, "social-links", "commerce:write");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("permission_not_declared");

    const granted = await service.grantPermission(aliceId, "social-links", "page:write");
    expect(granted.ok).toBe(true);
    if (granted.ok) expect(granted.value.grantedPermissions).toEqual(["page:write"]);

    const revoked = await service.revokePermission(aliceId, "social-links", "page:write");
    expect(revoked.ok).toBe(true);
    if (revoked.ok) expect(revoked.value.grantedPermissions).toEqual([]);
  });

  test("granting to an uninstalled plugin fails", async () => {
    const result = await service.grantPermission(bobId, "social-links", "page:read");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_installed");
  });
});

describe("creator isolation", () => {
  test("one creator cannot see or reorder another creator's blocks", async () => {
    // Bob has not installed the plugin, so Alice's block is invisible to him and
    // the public read model is empty for Bob's page.
    const aliceBlocks = await service.listPublicBlocks(aliceId, alicePageId);
    expect(aliceBlocks).toHaveLength(1);

    const bobView = await service.listBlocks(bobId, alicePageId);
    expect(bobView.ok).toBe(true);
    if (bobView.ok) expect(bobView.value).toHaveLength(0);

    const reorder = await service.reorderBlocks(bobId, alicePageId, [aliceBlocks[0].id]);
    expect(reorder.ok).toBe(false);
  });

  test("disabling the plugin removes its blocks from the public read model", async () => {
    await service.setEnabled(aliceId, "social-links", false);
    expect(await service.listPublicBlocks(aliceId, alicePageId)).toHaveLength(0);
    await service.setEnabled(aliceId, "social-links", true);
  });

  test("uninstalling removes the installation and its blocks from public view", async () => {
    const result = await service.uninstall(aliceId, "social-links");
    expect(result.ok).toBe(true);
    expect(await service.listPublicBlocks(aliceId, alicePageId)).toHaveLength(0);
    const list = await service.listForCreator(aliceId);
    expect(list.find((plugin) => plugin.manifest.id === "social-links")?.installed).toBe(false);
  });
});
