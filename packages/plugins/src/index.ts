import { and, asc, eq, sql } from "drizzle-orm";
import { pageBlocks, pluginInstallations, plugins, pluginSettings } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import {
  ok,
  fail,
  type PluginCatalog,
  type PluginManifest,
  type PluginPermission,
  type PluginSettings,
  type Result,
} from "@biova/shared";

export type PluginRow = typeof plugins.$inferSelect;
export type InstallationRow = typeof pluginInstallations.$inferSelect;
export type SettingsRow = typeof pluginSettings.$inferSelect;
export type PageBlockRow = typeof pageBlocks.$inferSelect;

export type PluginError =
  | "not_found"
  | "invalid_input"
  | "not_installed"
  | "permission_not_declared"
  | "plugin_disabled";

export interface PluginRepository {
  // Writes the build-time allowlist into the catalog table so an installation
  // has a row to reference and the dashboard can list what is available.
  upsertCatalog(manifests: PluginManifest[]): Promise<void>;
  findInstallation(creatorId: string, pluginId: string): Promise<InstallationRow | undefined>;
  listInstallations(creatorId: string): Promise<InstallationRow[]>;
  createInstallation(args: { creatorId: string; pluginId: string; version: string }): Promise<InstallationRow>;
  updateInstallation(
    creatorId: string,
    pluginId: string,
    patch: Partial<Pick<InstallationRow, "installed" | "enabled" | "grantedPermissions" | "version">>,
  ): Promise<InstallationRow | undefined>;
  deleteInstallation(creatorId: string, pluginId: string): Promise<void>;
  findSettings(installationId: string): Promise<SettingsRow | undefined>;
  upsertSettings(installationId: string, settings: PluginSettings): Promise<SettingsRow>;
  listBlocksByPage(pageId: string): Promise<PageBlockRow[]>;
  // Blocks whose plugin the creator has installed and enabled, and whose block is
  // enabled. This is the only set the public page may render.
  listRenderableBlocks(creatorId: string, pageId: string): Promise<PageBlockRow[]>;
  findBlock(creatorId: string, blockId: string): Promise<PageBlockRow | undefined>;
  createBlock(args: {
    pageId: string;
    pluginId: string;
    blockType: string;
    config: PluginSettings;
    sortOrder: number;
  }): Promise<PageBlockRow>;
  updateBlock(blockId: string, patch: Partial<Pick<PageBlockRow, "config" | "enabled">>): Promise<PageBlockRow | undefined>;
  deleteBlock(blockId: string): Promise<void>;
  reorderBlocks(pageId: string, orderedIds: string[]): Promise<void>;
}

export function createPluginRepository(db: Database): PluginRepository {
  return {
    async upsertCatalog(manifests) {
      if (manifests.length === 0) return;
      await db
        .insert(plugins)
        .values(
          manifests.map((manifest) => ({
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            currentVersion: manifest.version,
            source: "first-party",
            published: true,
          })),
        )
        .onConflictDoUpdate({
          target: plugins.id,
          // `excluded` is the row proposed by the conflicting insert, so the
          // catalog always tracks the current allowlist.
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            currentVersion: sql`excluded.current_version`,
          },
        });
    },

    async findInstallation(creatorId, pluginId) {
      const [row] = await db
        .select()
        .from(pluginInstallations)
        .where(and(eq(pluginInstallations.creatorId, creatorId), eq(pluginInstallations.pluginId, pluginId)))
        .limit(1);
      return row;
    },

    listInstallations(creatorId) {
      return db.select().from(pluginInstallations).where(eq(pluginInstallations.creatorId, creatorId));
    },

    async createInstallation(args) {
      const [row] = await db
        .insert(pluginInstallations)
        .values({
          creatorId: args.creatorId,
          pluginId: args.pluginId,
          version: args.version,
          installed: true,
          // Installed but off until the creator turns it on: activation is an
          // explicit second step, so a new plugin never changes a live page.
          enabled: false,
          grantedPermissions: [],
        })
        .returning();
      return row;
    },

    async updateInstallation(creatorId, pluginId, patch) {
      const [row] = await db
        .update(pluginInstallations)
        .set(patch)
        .where(and(eq(pluginInstallations.creatorId, creatorId), eq(pluginInstallations.pluginId, pluginId)))
        .returning();
      return row;
    },

    async deleteInstallation(creatorId, pluginId) {
      await db
        .delete(pluginInstallations)
        .where(and(eq(pluginInstallations.creatorId, creatorId), eq(pluginInstallations.pluginId, pluginId)));
    },

    async findSettings(installationId) {
      const [row] = await db
        .select()
        .from(pluginSettings)
        .where(eq(pluginSettings.installationId, installationId))
        .limit(1);
      return row;
    },

    async upsertSettings(installationId, settings) {
      const [row] = await db
        .insert(pluginSettings)
        .values({ installationId, settings })
        .onConflictDoUpdate({ target: pluginSettings.installationId, set: { settings } })
        .returning();
      return row;
    },

    listBlocksByPage(pageId) {
      return db
        .select()
        .from(pageBlocks)
        .where(eq(pageBlocks.pageId, pageId))
        .orderBy(asc(pageBlocks.sortOrder), asc(pageBlocks.createdAt));
    },

    async listRenderableBlocks(creatorId, pageId) {
      const rows = await db
        .select({ block: pageBlocks })
        .from(pageBlocks)
        .innerJoin(
          pluginInstallations,
          and(
            eq(pluginInstallations.creatorId, creatorId),
            eq(pluginInstallations.pluginId, pageBlocks.pluginId),
          ),
        )
        .where(
          and(
            eq(pageBlocks.pageId, pageId),
            eq(pageBlocks.enabled, true),
            eq(pluginInstallations.installed, true),
            eq(pluginInstallations.enabled, true),
          ),
        )
        .orderBy(asc(pageBlocks.sortOrder), asc(pageBlocks.createdAt));
      return rows.map((row) => row.block);
    },

    async findBlock(creatorId, blockId) {
      const [row] = await db
        .select({ block: pageBlocks })
        .from(pageBlocks)
        .innerJoin(
          pluginInstallations,
          and(
            eq(pluginInstallations.creatorId, creatorId),
            eq(pluginInstallations.pluginId, pageBlocks.pluginId),
          ),
        )
        .where(eq(pageBlocks.id, blockId))
        .limit(1);
      return row?.block;
    },

    async createBlock(args) {
      const [row] = await db
        .insert(pageBlocks)
        .values({
          pageId: args.pageId,
          pluginId: args.pluginId,
          blockType: args.blockType,
          config: args.config,
          sortOrder: args.sortOrder,
          enabled: true,
        })
        .returning();
      return row;
    },

    async updateBlock(blockId, patch) {
      const [row] = await db.update(pageBlocks).set(patch).where(eq(pageBlocks.id, blockId)).returning();
      return row;
    },

    async deleteBlock(blockId) {
      await db.delete(pageBlocks).where(eq(pageBlocks.id, blockId));
    },

    async reorderBlocks(pageId, orderedIds) {
      if (orderedIds.length === 0) return;
      // One statement: the order is the array position, so a partially applied
      // reorder cannot happen, and a row outside the page is left untouched.
      const positions = sql.join(
        orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
        sql`, `,
      );
      await db.execute(sql`
        update ${pageBlocks} as b
        set sort_order = v.position
        from (values ${positions}) as v(id, position)
        where b.id = v.id and b.page_id = ${pageId}
      `);
    },
  };
}

export interface PluginView {
  manifest: PluginManifest;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
  settings: PluginSettings;
}

export interface PublicBlockView {
  id: string;
  pluginId: string;
  blockType: string;
  config: PluginSettings;
}

export interface PluginService {
  syncCatalog(): Promise<void>;
  listForCreator(creatorId: string): Promise<PluginView[]>;
  install(creatorId: string, pluginId: string): Promise<Result<PluginView, PluginError>>;
  uninstall(creatorId: string, pluginId: string): Promise<Result<{ pluginId: string }, PluginError>>;
  setEnabled(creatorId: string, pluginId: string, enabled: boolean): Promise<Result<PluginView, PluginError>>;
  grantPermission(creatorId: string, pluginId: string, permission: PluginPermission): Promise<Result<PluginView, PluginError>>;
  revokePermission(creatorId: string, pluginId: string, permission: PluginPermission): Promise<Result<PluginView, PluginError>>;
  updateSettings(creatorId: string, pluginId: string, settings: PluginSettings): Promise<Result<PluginView, PluginError>>;
  listBlocks(creatorId: string, pageId: string): Promise<Result<PageBlockRow[], PluginError>>;
  addBlock(args: {
    creatorId: string;
    pageId: string;
    pluginId: string;
    blockType: string;
    config?: PluginSettings;
  }): Promise<Result<PageBlockRow, PluginError>>;
  updateBlock(args: {
    creatorId: string;
    blockId: string;
    config?: PluginSettings;
    enabled?: boolean;
  }): Promise<Result<PageBlockRow, PluginError>>;
  removeBlock(creatorId: string, blockId: string): Promise<Result<{ id: string }, PluginError>>;
  reorderBlocks(creatorId: string, pageId: string, ids: string[]): Promise<Result<{ ids: string[] }, PluginError>>;
  // The read model the public page renders. Only blocks whose plugin the creator
  // has installed and enabled, with no manifest or settings leakage.
  listPublicBlocks(creatorId: string, pageId: string): Promise<PublicBlockView[]>;
}

export function createPluginService(repository: PluginRepository, catalog: PluginCatalog): PluginService {
  async function view(creatorId: string, manifest: PluginManifest): Promise<PluginView> {
    const installation = await repository.findInstallation(creatorId, manifest.id);
    const stored = installation ? await repository.findSettings(installation.id) : undefined;
    return {
      manifest,
      installed: installation?.installed ?? false,
      enabled: installation?.enabled ?? false,
      grantedPermissions: (installation?.grantedPermissions ?? []) as PluginPermission[],
      settings: (stored?.settings ?? {}) as PluginSettings,
    };
  }

  // The set of plugins a creator has installed, used to scope every block
  // operation so one creator can never read or reorder another's blocks.
  async function installedPluginIds(creatorId: string): Promise<Set<string>> {
    const rows = await repository.listInstallations(creatorId);
    return new Set(rows.filter((row) => row.installed).map((row) => row.pluginId));
  }

  return {
    async syncCatalog() {
      await repository.upsertCatalog(catalog.list());
    },

    async listForCreator(creatorId) {
      const manifests = catalog.list();
      return Promise.all(manifests.map((manifest) => view(creatorId, manifest)));
    },

    async install(creatorId, pluginId) {
      const manifest = catalog.get(pluginId);
      if (!manifest) return fail("not_found");
      const existing = await repository.findInstallation(creatorId, pluginId);
      if (!existing) {
        // An installation references the catalog row by id, so the row must
        // exist first. Upserting here means install works even if the catalog
        // was never synced for this process.
        await repository.upsertCatalog([manifest]);
        await repository.createInstallation({ creatorId, pluginId, version: manifest.version });
      }
      return ok(await view(creatorId, manifest));
    },

    async uninstall(creatorId, pluginId) {
      const manifest = catalog.get(pluginId);
      if (!manifest) return fail("not_found");
      await repository.deleteInstallation(creatorId, pluginId);
      return ok({ pluginId });
    },

    async setEnabled(creatorId, pluginId, enabled) {
      const manifest = catalog.get(pluginId);
      if (!manifest) return fail("not_found");
      const installation = await repository.findInstallation(creatorId, pluginId);
      if (!installation) return fail("not_installed");
      await repository.updateInstallation(creatorId, pluginId, { enabled });
      return ok(await view(creatorId, manifest));
    },

    async grantPermission(creatorId, pluginId, permission) {
      const manifest = catalog.get(pluginId);
      if (!manifest) return fail("not_found");
      // A plugin may only be granted a capability it declared: the grant can
      // narrow the request, never widen it.
      if (!manifest.permissions.includes(permission)) return fail("permission_not_declared");
      const installation = await repository.findInstallation(creatorId, pluginId);
      if (!installation) return fail("not_installed");
      const granted = new Set(installation.grantedPermissions as PluginPermission[]);
      granted.add(permission);
      await repository.updateInstallation(creatorId, pluginId, { grantedPermissions: [...granted] });
      return ok(await view(creatorId, manifest));
    },

    async revokePermission(creatorId, pluginId, permission) {
      const manifest = catalog.get(pluginId);
      if (!manifest) return fail("not_found");
      const installation = await repository.findInstallation(creatorId, pluginId);
      if (!installation) return fail("not_installed");
      const granted = (installation.grantedPermissions as PluginPermission[]).filter((item) => item !== permission);
      await repository.updateInstallation(creatorId, pluginId, { grantedPermissions: granted });
      return ok(await view(creatorId, manifest));
    },

    async updateSettings(creatorId, pluginId, settings) {
      const manifest = catalog.get(pluginId);
      if (!manifest) return fail("not_found");
      const installation = await repository.findInstallation(creatorId, pluginId);
      if (!installation) return fail("not_installed");
      await repository.upsertSettings(installation.id, settings);
      return ok(await view(creatorId, manifest));
    },

    async listBlocks(creatorId, pageId) {
      const [blocks, installed] = await Promise.all([
        repository.listBlocksByPage(pageId),
        installedPluginIds(creatorId),
      ]);
      return ok(blocks.filter((block) => installed.has(block.pluginId)));
    },

    async addBlock(args) {
      const manifest = catalog.get(args.pluginId);
      if (!manifest) return fail("not_found");
      if (!manifest.extensions.pageBlocks) return fail("invalid_input");
      const installation = await repository.findInstallation(args.creatorId, args.pluginId);
      if (!installation?.installed) return fail("not_installed");
      // A disabled plugin may not add blocks: the page would gain content the
      // creator has switched off.
      if (!installation.enabled) return fail("plugin_disabled");
      const existing = await repository.listBlocksByPage(args.pageId);
      const row = await repository.createBlock({
        pageId: args.pageId,
        pluginId: args.pluginId,
        blockType: args.blockType,
        config: args.config ?? {},
        sortOrder: existing.length,
      });
      return ok(row);
    },

    async updateBlock(args) {
      const block = await repository.findBlock(args.creatorId, args.blockId);
      if (!block) return fail("not_found");
      const patch: Partial<Pick<PageBlockRow, "config" | "enabled">> = {};
      if (args.config !== undefined) patch.config = args.config;
      if (args.enabled !== undefined) patch.enabled = args.enabled;
      const row = await repository.updateBlock(block.id, patch);
      return row ? ok(row) : fail("not_found");
    },

    async removeBlock(creatorId, blockId) {
      const block = await repository.findBlock(creatorId, blockId);
      if (!block) return fail("not_found");
      await repository.deleteBlock(block.id);
      return ok({ id: block.id });
    },

    async reorderBlocks(creatorId, pageId, ids) {
      const [blocks, installed] = await Promise.all([
        repository.listBlocksByPage(pageId),
        installedPluginIds(creatorId),
      ]);
      const owned = blocks.filter((block) => installed.has(block.pluginId));
      const allowed = new Set(owned.map((block) => block.id));
      // Reordering may only touch blocks the creator can already see; an id from
      // another page or creator is rejected rather than silently skipped.
      if (!ids.every((id) => allowed.has(id))) return fail("not_found");
      await repository.reorderBlocks(pageId, ids);
      return ok({ ids });
    },

    async listPublicBlocks(creatorId, pageId) {
      const rows = await repository.listRenderableBlocks(creatorId, pageId);
      return rows.map((row) => ({
        id: row.id,
        pluginId: row.pluginId,
        blockType: row.blockType,
        config: row.config as PluginSettings,
      }));
    },
  };
}
