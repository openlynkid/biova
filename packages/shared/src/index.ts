import { z } from "zod";

export const creatorSlugSchema = z.string().min(3).max(48).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export const pageStatusSchema = z.enum(["draft", "published", "archived"]);
export type PageStatus = z.infer<typeof pageStatusSchema>;

// Session policy shared by the web app and the API. Better Auth interprets
// expiresIn/updateAge in seconds and cookieCache.maxAge in seconds.
export const sessionPolicy = {
  expiresIn: 60 * 60 * 24 * 7,
  updateAge: 60 * 60 * 24,
  cookieCache: { enabled: true, maxAge: 60 * 5 },
} as const;
