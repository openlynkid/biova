import { z } from "zod";

export const productStatusSchema = z.enum(["draft", "published", "archived"]);
export type ProductStatus = z.infer<typeof productStatusSchema>;

// Product slugs are unique per creator and appear in the public product URL, so
// they use the same character set as creator slugs.
export const productSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "use lowercase letters, numbers and single hyphens");

export const productTitleSchema = z.string().trim().min(1).max(120);
export const productDescriptionSchema = z.string().trim().max(2000);

// Prices are whole rupiah, stored as integers so no float drift can creep in.
// The cap is a guard against a typo publishing an absurd price.
export const MAX_PRICE_IDR = 100_000_000;
export const productPriceSchema = z.number().int().min(0).max(MAX_PRICE_IDR);

export const createProductSchema = z.object({
  title: productTitleSchema,
  slug: productSlugSchema,
  description: productDescriptionSchema.nullish(),
  priceIdr: productPriceSchema,
});

export const updateProductSchema = z.object({
  title: productTitleSchema.optional(),
  description: productDescriptionSchema.nullish(),
  priceIdr: productPriceSchema.optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// A product may only move along these edges; the table mirrors the page
// transition table so both domains behave the same way.
export const allowedProductTransitions: Record<ProductStatus, readonly ProductStatus[]> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransitionProduct(from: ProductStatus, to: ProductStatus): boolean {
  return from === to || allowedProductTransitions[from].includes(to);
}

// Rupiah has no minor unit, so prices render without decimals.
export function formatPriceIdr(priceIdr: number): string {
  return `Rp${priceIdr.toLocaleString("id-ID")}`;
}
