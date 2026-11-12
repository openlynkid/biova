import { and, asc, eq, sql } from "drizzle-orm";
import { products } from "@biova/database/schema";
import type { Database } from "@biova/database/types";
import {
  canTransitionProduct,
  createProductSchema,
  productStatusSchema,
  updateProductSchema,
  type ProductStatus,
  type Result,
  ok,
  fail,
} from "@biova/shared";

export type Product = typeof products.$inferSelect;

export type ProductError =
  | "not_found"
  | "invalid_input"
  | "invalid_transition"
  | "slug_taken";

export interface CreateProductArgs {
  creatorId: string;
  title: string;
  slug: string;
  description?: string | null;
  priceIdr: number;
}

export interface UpdateProductArgs {
  creatorId: string;
  productId: string;
  title?: string;
  description?: string | null;
  priceIdr?: number;
}

export interface ProductRepository {
  listByCreator(creatorId: string): Promise<Product[]>;
  listPublishedByCreator(creatorId: string): Promise<Product[]>;
  countPublished(creatorId: string): Promise<number>;
  create(args: CreateProductArgs & { sortOrder: number }): Promise<Product>;
  update(args: UpdateProductArgs): Promise<Product | undefined>;
  delete(creatorId: string, productId: string): Promise<boolean>;
  setStatus(creatorId: string, productId: string, status: ProductStatus): Promise<Product | undefined>;
  isSlugAvailable(creatorId: string, slug: string, exceptProductId?: string): Promise<boolean>;
  ownsProduct(creatorId: string, productId: string): Promise<boolean>;
  reorder(creatorId: string, orderedIds: string[]): Promise<void>;
}

export function createProductRepository(db: Database): ProductRepository {
  return {
    listByCreator(creatorId) {
      return db
        .select()
        .from(products)
        .where(eq(products.creatorId, creatorId))
        .orderBy(asc(products.sortOrder), asc(products.createdAt));
    },
    listPublishedByCreator(creatorId) {
      return db
        .select()
        .from(products)
        .where(and(eq(products.creatorId, creatorId), eq(products.status, "published")))
        .orderBy(asc(products.sortOrder), asc(products.createdAt));
    },
    async countPublished(creatorId) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(eq(products.creatorId, creatorId), eq(products.status, "published")));
      return row?.count ?? 0;
    },
    async create(args) {
      const [row] = await db
        .insert(products)
        .values({
          creatorId: args.creatorId,
          title: args.title,
          slug: args.slug,
          description: args.description ?? null,
          priceIdr: args.priceIdr,
          sortOrder: args.sortOrder,
        })
        .returning();
      return row;
    },
    async update(args) {
      const patch: Partial<Pick<Product, "title" | "description" | "priceIdr">> = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.priceIdr !== undefined) patch.priceIdr = args.priceIdr;
      if (Object.keys(patch).length === 0) {
        const [row] = await db
          .select()
          .from(products)
          .where(and(eq(products.creatorId, args.creatorId), eq(products.id, args.productId)))
          .limit(1);
        return row;
      }

      const [row] = await db
        .update(products)
        .set(patch)
        .where(and(eq(products.creatorId, args.creatorId), eq(products.id, args.productId)))
        .returning();
      return row;
    },
    async delete(creatorId, productId) {
      const rows = await db
        .delete(products)
        .where(and(eq(products.creatorId, creatorId), eq(products.id, productId)))
        .returning({ id: products.id });
      return rows.length > 0;
    },
    async setStatus(creatorId, productId, status) {
      const [row] = await db
        .update(products)
        .set({ status })
        .where(and(eq(products.creatorId, creatorId), eq(products.id, productId)))
        .returning();
      return row;
    },
    async isSlugAvailable(creatorId, slug, exceptProductId) {
      const conditions = [eq(products.creatorId, creatorId), eq(products.slug, slug)];
      if (exceptProductId) conditions.push(sql`${products.id} <> ${exceptProductId}`);
      const [row] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(...conditions))
        .limit(1);
      return row === undefined;
    },
    async ownsProduct(creatorId, productId) {
      const [row] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.creatorId, creatorId), eq(products.id, productId)))
        .limit(1);
      return row !== undefined;
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
        update ${products} as p
        set sort_order = v.position
        from (values ${positions}) as v(id, position)
        where p.id = v.id and p.creator_id = ${creatorId}
      `);
    },
  };
}

export interface ProductService {
  list(creatorId: string): Promise<Product[]>;
  listPublished(creatorId: string): Promise<Product[]>;
  hasPublishedProduct(creatorId: string): Promise<boolean>;
  ownsProduct(creatorId: string, productId: string): Promise<boolean>;
  create(args: CreateProductArgs): Promise<Result<Product, ProductError>>;
  update(args: UpdateProductArgs): Promise<Result<Product, ProductError>>;
  remove(creatorId: string, productId: string): Promise<Result<{ id: string }, ProductError>>;
  setStatus(creatorId: string, productId: string, status: string): Promise<Result<Product, ProductError>>;
  reorder(creatorId: string, ids: string[]): Promise<Result<{ ids: string[] }, ProductError>>;
}

export function createProductService(repository: ProductRepository): ProductService {
  return {
    list(creatorId) {
      return repository.listByCreator(creatorId);
    },

    listPublished(creatorId) {
      return repository.listPublishedByCreator(creatorId);
    },

    async hasPublishedProduct(creatorId) {
      return (await repository.countPublished(creatorId)) > 0;
    },

    ownsProduct(creatorId, productId) {
      return repository.ownsProduct(creatorId, productId);
    },

    async create(args) {
      const parsed = createProductSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_input");

      if (!(await repository.isSlugAvailable(args.creatorId, parsed.data.slug))) return fail("slug_taken");

      const existing = await repository.listByCreator(args.creatorId);
      const product = await repository.create({
        creatorId: args.creatorId,
        title: parsed.data.title,
        slug: parsed.data.slug,
        description: parsed.data.description ?? null,
        priceIdr: parsed.data.priceIdr,
        sortOrder: existing.length,
      });
      return ok(product);
    },

    async update(args) {
      const parsed = updateProductSchema.safeParse(args);
      if (!parsed.success) return fail("invalid_input");

      const product = await repository.update(args);
      if (!product) return fail("not_found");
      return ok(product);
    },

    async remove(creatorId, productId) {
      const deleted = await repository.delete(creatorId, productId);
      if (!deleted) return fail("not_found");
      return ok({ id: productId });
    },

    async setStatus(creatorId, productId, status) {
      const parsed = productStatusSchema.safeParse(status);
      if (!parsed.success) return fail("invalid_input");

      const current = (await repository.listByCreator(creatorId)).find((product) => product.id === productId);
      if (!current) return fail("not_found");
      if (!canTransitionProduct(current.status, parsed.data)) return fail("invalid_transition");

      const updated = await repository.setStatus(creatorId, productId, parsed.data);
      return updated ? ok(updated) : fail("not_found");
    },

    async reorder(creatorId, ids) {
      const owned = await repository.listByCreator(creatorId);
      const ownedIds = new Set(owned.map((product) => product.id));
      if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id))) {
        return fail("invalid_input");
      }
      await repository.reorder(creatorId, ids);
      return ok({ ids });
    },
  };
}

export * from "./assets";
