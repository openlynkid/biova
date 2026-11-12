import { and, asc, eq, sql } from "drizzle-orm";
import { links } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import { createLinkSchema, updateLinkSchema, type Result, ok, fail } from "@biova/shared";

export type Link = typeof links.$inferSelect;

export type LinkError = "not_found" | "invalid_input";

export interface CreateLinkArgs {
  creatorId: string;
  title: string;
  url: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
}

export interface UpdateLinkArgs {
  creatorId: string;
  linkId: string;
  title?: string;
  url?: string;
  description?: string | null;
  icon?: string | null;
  enabled?: boolean;
}

export interface LinkRepository {
  listByCreator(creatorId: string): Promise<Link[]>;
  countEnabled(creatorId: string): Promise<number>;
  create(args: CreateLinkArgs & { sortOrder: number }): Promise<Link>;
  update(args: UpdateLinkArgs): Promise<Link | undefined>;
  delete(creatorId: string, linkId: string): Promise<boolean>;
  reorder(creatorId: string, orderedIds: string[]): Promise<void>;
}

export function createLinkRepository(db: Database): LinkRepository {
  return {
    listByCreator(creatorId) {
      return db
        .select()
        .from(links)
        .where(eq(links.creatorId, creatorId))
        .orderBy(asc(links.sortOrder), asc(links.createdAt));
    },
    async countEnabled(creatorId) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(links)
        .where(and(eq(links.creatorId, creatorId), eq(links.enabled, true)));
      return row?.count ?? 0;
    },
    async create(args) {
      const [row] = await db
        .insert(links)
        .values({
          creatorId: args.creatorId,
          title: args.title,
          url: args.url,
          description: args.description ?? null,
          icon: args.icon ?? null,
          enabled: args.enabled ?? true,
          sortOrder: args.sortOrder,
        })
        .returning();
      return row;
    },
    async update(args) {
      const patch: Partial<Pick<Link, "title" | "url" | "description" | "icon" | "enabled">> = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.url !== undefined) patch.url = args.url;
      if (args.description !== undefined) patch.description = args.description;
      if (args.icon !== undefined) patch.icon = args.icon;
      if (args.enabled !== undefined) patch.enabled = args.enabled;

      const [row] = await db
        .update(links)
        .set(patch)
        .where(and(eq(links.creatorId, args.creatorId), eq(links.id, args.linkId)))
        .returning();
      return row;
    },
    async delete(creatorId, linkId) {
      const rows = await db
        .delete(links)
        .where(and(eq(links.creatorId, creatorId), eq(links.id, linkId)))
        .returning({ id: links.id });
      return rows.length > 0;
    },
    async reorder(creatorId, orderedIds) {
      if (orderedIds.length === 0) return;
      // Single statement: order is derived from the array position, so a
      // partially applied reorder cannot happen.
      const positions = sql.join(
        orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
        sql`, `,
      );
      await db.execute(sql`
        update ${links} as l
        set sort_order = v.position
        from (values ${positions}) as v(id, position)
        where l.id = v.id and l.creator_id = ${creatorId}
      `);
    },
  };
}

export interface LinkService {
  list(creatorId: string): Promise<Link[]>;
  hasEnabledLink(creatorId: string): Promise<boolean>;
  create(args: CreateLinkArgs): Promise<Result<Link, LinkError>>;
  update(args: UpdateLinkArgs): Promise<Result<Link, LinkError>>;
  remove(creatorId: string, linkId: string): Promise<Result<{ id: string }, LinkError>>;
  reorder(creatorId: string, ids: string[]): Promise<Result<{ ids: string[] }, LinkError>>;
}

export function createLinkService(repository: LinkRepository): LinkService {
  return {
    list(creatorId) {
      return repository.listByCreator(creatorId);
    },

    async hasEnabledLink(creatorId) {
      return (await repository.countEnabled(creatorId)) > 0;
    },

    async create(args) {
      const parsed = createLinkSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_input");

      const existing = await repository.listByCreator(args.creatorId);
      const link = await repository.create({
        creatorId: args.creatorId,
        title: parsed.data.title,
        url: parsed.data.url,
        description: parsed.data.description ?? null,
        icon: parsed.data.icon ?? null,
        enabled: parsed.data.enabled ?? true,
        sortOrder: existing.length,
      });
      return ok(link);
    },

    async update(args) {
      const parsed = updateLinkSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_input");

      const link = await repository.update(args);
      if (!link) return fail("not_found");
      return ok(link);
    },

    async remove(creatorId, linkId) {
      const deleted = await repository.delete(creatorId, linkId);
      if (!deleted) return fail("not_found");
      return ok({ id: linkId });
    },

    async reorder(creatorId, ids) {
      const owned = await repository.listByCreator(creatorId);
      const ownedIds = new Set(owned.map((link) => link.id));
      if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id))) {
        return fail("invalid_input");
      }
      await repository.reorder(creatorId, ids);
      return ok({ ids });
    },
  };
}
