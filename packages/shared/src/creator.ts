import { z } from "zod";

// Slugs that would collide with platform routes or look official. Keep in sync
// with any new top-level route (see apps/web/src/routes).
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "dashboard",
  "help",
  "login",
  "logout",
  "me",
  "new",
  "pricing",
  "settings",
  "signin",
  "signup",
  "static",
  "support",
  "www",
]);

export const creatorSlugSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "use lowercase letters, numbers and single hyphens")
  .refine((slug) => !RESERVED_SLUGS.has(slug), "this username is reserved");

export const displayNameSchema = z.string().trim().min(1).max(120);
export const bioSchema = z.string().trim().max(500);

export const createCreatorSchema = z.object({
  slug: creatorSlugSchema,
  displayName: displayNameSchema,
  bio: bioSchema.nullish(),
});

export const updateCreatorProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: bioSchema.nullish(),
});

export type CreateCreatorInput = z.infer<typeof createCreatorSchema>;
export type UpdateCreatorProfileInput = z.infer<typeof updateCreatorProfileSchema>;
