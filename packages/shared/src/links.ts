import { z } from "zod";

// Link destinations must be http(s). This blocks javascript:, data: and other
// schemes that would become an XSS vector when rendered on the public page.
export const linkUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

export const linkTitleSchema = z.string().trim().min(1).max(120);
export const linkDescriptionSchema = z.string().trim().max(240);
export const linkIconSchema = z.string().trim().max(32);

export const createLinkSchema = z.object({
  title: linkTitleSchema,
  url: linkUrlSchema,
  description: linkDescriptionSchema.nullish(),
  icon: linkIconSchema.nullish(),
  enabled: z.boolean().optional(),
});

export const updateLinkSchema = createLinkSchema.partial();

export const reorderLinksSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
});

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;
