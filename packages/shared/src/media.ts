import { z } from "zod";

// Public images: creator branding (avatar, cover) and the product thumbnail.
// Kept apart from product assets: these are public (they appear on the public
// page), so the read model is a URL, never a storage key.
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

// A single public image with no slot name, used for a product thumbnail. The
// type and size rules are the branding ones, so both paths accept the same set
// of images and reject the same oversized or non-image uploads.
export const imageUploadSchema = z.object({
  contentType: mediaContentTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_MEDIA_BYTES),
});

export type ImageUploadInput = z.infer<typeof imageUploadSchema>;

// Product thumbnails are public like branding, so they share the versioned-URL
// shape: replacing the image changes the URL and busts the cache. The path is
// scoped by creator slug and includes a static `product` segment, so it never
// collides with a branding slot (`/media/:slug/:kind`) even if a creator's slug
// is literally "product".
export function productThumbnailUrl(slug: string, productId: string, version: number): string {
  return `/media/${slug}/product/${productId}?v=${version}`;
}

// The version is the row's `updatedAt` in epoch seconds. It rides in the URL so
// replacing an image changes the URL, which both busts a browser cache and lets
// the public route answer with a long-lived immutable cache.
export function mediaUrl(slug: string, kind: MediaKind, version: number): string {
  return `/media/${slug}/${kind}?v=${version}`;
}
