import { z } from "zod";

// Creator branding images: a profile avatar and a page cover. Kept apart from
// product assets: these are public (they appear on the public page), so the read
// model is a URL, never a storage key.
export const mediaKindSchema = z.enum(["avatar", "cover"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

// Images only. The type is checked at the boundary so a creator cannot use the
// branding slot to host an arbitrary file; the public route serves it inline.
export const MEDIA_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"] as const;
export const mediaContentTypeSchema = z.enum(MEDIA_CONTENT_TYPES);
export type MediaContentType = z.infer<typeof mediaContentTypeSchema>;

// A branding image is smaller than a deliverable; a cover that large would be
// re-encoded by the creator's editor, not uploaded raw.
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export const mediaUploadSchema = z.object({
  kind: mediaKindSchema,
  contentType: mediaContentTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_MEDIA_BYTES),
});

export type MediaUploadInput = z.infer<typeof mediaUploadSchema>;

// The version is the row's `updatedAt` in epoch seconds. It rides in the URL so
// replacing an image changes the URL, which both busts a browser cache and lets
// the public route answer with a long-lived immutable cache.
export function mediaUrl(slug: string, kind: MediaKind, version: number): string {
  return `/media/${slug}/${kind}?v=${version}`;
}
