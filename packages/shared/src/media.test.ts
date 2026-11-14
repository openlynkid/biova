import { describe, expect, test } from "bun:test";
import { MAX_MEDIA_BYTES, imageUploadSchema, mediaKindSchema, mediaUploadSchema, mediaUrl, productThumbnailUrl } from "./media";

describe("mediaKindSchema", () => {
  test("accepts the two branding slots", () => {
    expect(mediaKindSchema.safeParse("avatar").success).toBe(true);
    expect(mediaKindSchema.safeParse("cover").success).toBe(true);
  });

  test("rejects anything else", () => {
    expect(mediaKindSchema.safeParse("banner").success).toBe(false);
  });
});

describe("mediaUploadSchema", () => {
  test("accepts an image within the size cap", () => {
    expect(mediaUploadSchema.safeParse({ kind: "avatar", contentType: "image/png", sizeBytes: 1024 }).success).toBe(true);
  });

  test("rejects a non-image content type", () => {
    expect(mediaUploadSchema.safeParse({ kind: "avatar", contentType: "application/zip", sizeBytes: 10 }).success).toBe(false);
  });

  test("rejects a file above the cap", () => {
    expect(mediaUploadSchema.safeParse({ kind: "cover", contentType: "image/jpeg", sizeBytes: MAX_MEDIA_BYTES + 1 }).success).toBe(false);
  });

  test("rejects an empty file", () => {
    expect(mediaUploadSchema.safeParse({ kind: "cover", contentType: "image/jpeg", sizeBytes: 0 }).success).toBe(false);
  });
});

describe("mediaUrl", () => {
  test("is a relative, cache-busting public path", () => {
    expect(mediaUrl("alice", "avatar", 1700000000)).toBe("/media/alice/avatar?v=1700000000");
  });
});

describe("imageUploadSchema", () => {
  test("accepts an image within the size cap", () => {
    expect(imageUploadSchema.safeParse({ contentType: "image/png", sizeBytes: 1024 }).success).toBe(true);
  });

  test("rejects a non-image content type", () => {
    expect(imageUploadSchema.safeParse({ contentType: "application/pdf", sizeBytes: 10 }).success).toBe(false);
  });

  test("rejects a file above the cap and an empty file", () => {
    expect(imageUploadSchema.safeParse({ contentType: "image/webp", sizeBytes: MAX_MEDIA_BYTES + 1 }).success).toBe(false);
    expect(imageUploadSchema.safeParse({ contentType: "image/webp", sizeBytes: 0 }).success).toBe(false);
  });
});

describe("productThumbnailUrl", () => {
  test("is scoped by creator slug and carries a version", () => {
    expect(productThumbnailUrl("alice", "11111111-1111-1111-1111-111111111111", 1700000000)).toBe(
      "/media/alice/product/11111111-1111-1111-1111-111111111111?v=1700000000",
    );
  });
});
