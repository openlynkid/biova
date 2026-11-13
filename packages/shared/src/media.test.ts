import { describe, expect, test } from "bun:test";
import { MAX_MEDIA_BYTES, mediaKindSchema, mediaUploadSchema, mediaUrl } from "./media";

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
