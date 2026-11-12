import { z } from "zod";

export const pageStatusSchema = z.enum(["draft", "published", "archived"]);
export type PageStatus = z.infer<typeof pageStatusSchema>;

export const pageTitleSchema = z.string().trim().min(1).max(120);

// Appearance values a creator can set. Kept as a closed schema so the public
// read model is serializable and the renderer never receives arbitrary keys.
export const pageThemeSchema = z.object({
  accent: z.string().trim().max(32).optional(),
  background: z.string().trim().max(32).optional(),
  textColor: z.string().trim().max(32).optional(),
  buttonStyle: z.enum(["solid", "outline", "soft"]).optional(),
});
export type PageTheme = z.infer<typeof pageThemeSchema>;

export const updatePageSchema = z.object({
  title: pageTitleSchema.optional(),
  theme: pageThemeSchema.optional(),
});

export type UpdatePageInput = z.infer<typeof updatePageSchema>;

// A page may only move along these edges. Publishing requires content that the
// page domain checks separately; the transition table is the coarse guard.
export const allowedPageTransitions: Record<PageStatus, readonly PageStatus[]> = {
  draft: ["published", "archived"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function canTransitionPage(from: PageStatus, to: PageStatus): boolean {
  return from === to || allowedPageTransitions[from].includes(to);
}
