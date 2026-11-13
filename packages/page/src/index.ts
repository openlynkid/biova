import { and, asc, eq } from "drizzle-orm";
import { creators, pages } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import { canTransitionPage, pageStatusSchema, updatePageSchema, type PageStatus, type Result, ok, fail } from "@biova/shared";

export type Page = typeof pages.$inferSelect;
export type PageStatusValue = PageStatus;

export type PageError =
  | "already_exists"
  | "not_found"
  | "invalid_input"
  | "invalid_transition"
  | "not_publishable";

export interface CreatePageArgs {
  creatorId: string;
  title: string;
  theme?: Record<string, unknown>;
}

export interface UpdatePageArgs {
  creatorId: string;
  title?: string;
  theme?: Record<string, unknown>;
}

export interface PageRepository {
  findByCreatorId(creatorId: string): Promise<Page | undefined>;
  findPublishedBySlug(slug: string): Promise<Page | undefined>;
  listPublishedWithCreator(): Promise<PublishedPageEntry[]>;
  create(args: CreatePageArgs): Promise<Page>;
  update(args: UpdatePageArgs): Promise<Page | undefined>;
  setStatus(creatorId: string, status: PageStatus): Promise<Page | undefined>;
}

// One row per published page, joined with its creator slug. Used to build the
// sitemap, so it carries only what a sitemap needs.
export interface PublishedPageEntry {
  slug: string;
  lastModified: Date;
}

export function createPageRepository(db: Database): PageRepository {
  return {
    async findByCreatorId(creatorId) {
      const [row] = await db.select().from(pages).where(eq(pages.creatorId, creatorId)).limit(1);
      return row;
    },
    async findPublishedBySlug(slug) {
      const [row] = await db
        .select({ page: pages })
        .from(pages)
        .innerJoin(creators, eq(pages.creatorId, creators.id))
        .where(and(eq(creators.slug, slug), eq(pages.status, "published")))
        .limit(1);
      return row?.page;
    },
    async listPublishedWithCreator() {
      const rows = await db
        .select({ slug: creators.slug, updatedAt: pages.updatedAt })
        .from(pages)
        .innerJoin(creators, eq(pages.creatorId, creators.id))
        .where(eq(pages.status, "published"))
        .orderBy(asc(creators.slug));
      return rows.map((row) => ({ slug: row.slug, lastModified: row.updatedAt }));
    },
    async create(args) {
      const [row] = await db
        .insert(pages)
        .values({
          creatorId: args.creatorId,
          title: args.title,
          theme: args.theme ?? {},
        })
        .returning();
      return row;
    },
    async update(args) {
      const patch: Partial<Pick<Page, "title" | "theme">> = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.theme !== undefined) patch.theme = args.theme;
      if (Object.keys(patch).length === 0) return this.findByCreatorId(args.creatorId);

      const [row] = await db
        .update(pages)
        .set(patch)
        .where(eq(pages.creatorId, args.creatorId))
        .returning();
      return row;
    },
    async setStatus(creatorId, status) {
      const [row] = await db
        .update(pages)
        .set({ status, ...(status === "published" ? { publishedAt: new Date() } : {}) })
        .where(eq(pages.creatorId, creatorId))
        .returning();
      return row;
    },
  };
}

// Injected by the composition root so the page domain does not depend on the
// links domain. Returns true when the page has at least one enabled link.
export type PublishableChecker = (creatorId: string) => Promise<boolean>;

export interface PageService {
  ensurePage(creatorId: string, title?: string): Promise<Page>;
  getByCreatorId(creatorId: string): Promise<Page | undefined>;
  getPublishedBySlug(slug: string): Promise<Page | undefined>;
  listPublishedWithCreator(): Promise<PublishedPageEntry[]>;
  update(args: UpdatePageArgs): Promise<Result<Page, PageError>>;
  setStatus(creatorId: string, status: string): Promise<Result<Page, PageError>>;
}

export function createPageService(repository: PageRepository, isPublishable: PublishableChecker): PageService {
  return {
    async ensurePage(creatorId, title = "My page") {
      const existing = await repository.findByCreatorId(creatorId);
      if (existing) return existing;
      return repository.create({ creatorId, title });
    },

    getByCreatorId(creatorId) {
      return repository.findByCreatorId(creatorId);
    },

    getPublishedBySlug(slug) {
      return repository.findPublishedBySlug(slug);
    },

    listPublishedWithCreator() {
      return repository.listPublishedWithCreator();
    },

    async update(args) {
      const parsed = updatePageSchema.safeParse({ title: args.title, theme: args.theme });
      if (!parsed.success) return fail("invalid_input");

      const page = await repository.update({
        creatorId: args.creatorId,
        title: parsed.data.title,
        theme: parsed.data.theme,
      });
      if (!page) return fail("not_found");
      return ok(page);
    },

    async setStatus(creatorId, status) {
      const parsed = pageStatusSchema.safeParse(status);
      if (!parsed.success) return fail("invalid_input");

      const page = await repository.findByCreatorId(creatorId);
      if (!page) return fail("not_found");
      if (!canTransitionPage(page.status, parsed.data)) return fail("invalid_transition");

      // Publishing an empty page is a common mistake; require at least one link.
      if (parsed.data === "published" && !(await isPublishable(creatorId))) {
        return fail("not_publishable");
      }

      const updated = await repository.setStatus(creatorId, parsed.data);
      return updated ? ok(updated) : fail("not_found");
    },
  };
}
