import { z } from "zod";

export const creatorSlugSchema = z.string().min(3).max(48).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export const pageStatusSchema = z.enum(["draft", "published", "archived"]);
export type PageStatus = z.infer<typeof pageStatusSchema>;
