import { and, eq, ne } from "drizzle-orm";
import { creators } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import { createCreatorSchema, updateCreatorProfileSchema, type Result, ok, fail } from "@biova/shared";

export type Creator = typeof creators.$inferSelect;

export type CreatorError =
  | "slug_taken"
  | "already_exists"
  | "not_found"
  | "invalid_input";

export interface CreateCreatorArgs {
  userId: string;
  slug: string;
  displayName: string;
  bio?: string | null;
}

export interface UpdateCreatorProfileArgs {
  creatorId: string;
  displayName?: string;
  bio?: string | null;
}

export interface CreatorRepository {
  findByUserId(userId: string): Promise<Creator | undefined>;
  findBySlug(slug: string): Promise<Creator | undefined>;
  findById(id: string): Promise<Creator | undefined>;
  create(args: CreateCreatorArgs): Promise<Creator>;
  updateProfile(args: UpdateCreatorProfileArgs): Promise<Creator | undefined>;
  isSlugAvailable(slug: string, exceptCreatorId?: string): Promise<boolean>;
}

export function createCreatorRepository(db: Database): CreatorRepository {
  return {
    async findByUserId(userId) {
      const [row] = await db.select().from(creators).where(eq(creators.userId, userId)).limit(1);
      return row;
    },
    async findBySlug(slug) {
      const [row] = await db.select().from(creators).where(eq(creators.slug, slug)).limit(1);
      return row;
    },
    async findById(id) {
      const [row] = await db.select().from(creators).where(eq(creators.id, id)).limit(1);
      return row;
    },
    async create(args) {
      const [row] = await db
        .insert(creators)
        .values({
          userId: args.userId,
          slug: args.slug,
          displayName: args.displayName,
          bio: args.bio ?? null,
        })
        .returning();
      return row;
    },
    async updateProfile(args) {
      const patch: Partial<Pick<Creator, "displayName" | "bio">> = {};
      if (args.displayName !== undefined) patch.displayName = args.displayName;
      if (args.bio !== undefined) patch.bio = args.bio;
      if (Object.keys(patch).length === 0) return this.findById(args.creatorId);

      const [row] = await db.update(creators).set(patch).where(eq(creators.id, args.creatorId)).returning();
      return row;
    },
    async isSlugAvailable(slug, exceptCreatorId) {
      const condition = exceptCreatorId
        ? and(eq(creators.slug, slug), ne(creators.id, exceptCreatorId))
        : eq(creators.slug, slug);
      const [row] = await db.select({ id: creators.id }).from(creators).where(condition).limit(1);
      return row === undefined;
    },
  };
}

export interface CreatorService {
  getOrCreate(args: CreateCreatorArgs): Promise<Result<Creator, CreatorError>>;
  getByUserId(userId: string): Promise<Creator | undefined>;
  getBySlug(slug: string): Promise<Creator | undefined>;
  updateProfile(args: UpdateCreatorProfileArgs): Promise<Result<Creator, CreatorError>>;
}

export function createCreatorService(repository: CreatorRepository): CreatorService {
  return {
    async getOrCreate(args) {
      const parsed = createCreatorSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_input");

      const existing = await repository.findByUserId(args.userId);
      if (existing) return fail("already_exists");

      if (!(await repository.isSlugAvailable(parsed.data.slug))) return fail("slug_taken");

      const creator = await repository.create({
        userId: args.userId,
        slug: parsed.data.slug,
        displayName: parsed.data.displayName,
        bio: parsed.data.bio ?? null,
      });
      return ok(creator);
    },

    getByUserId(userId) {
      return repository.findByUserId(userId);
    },

    getBySlug(slug) {
      return repository.findBySlug(slug);
    },

    async updateProfile(args) {
      const parsed = updateCreatorProfileSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_input");

      const creator = await repository.updateProfile(args);
      if (!creator) return fail("not_found");
      return ok(creator);
    },
  };
}
