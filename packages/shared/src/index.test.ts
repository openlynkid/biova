import { describe, expect, test } from "bun:test";
import { canTransitionPage, createCreatorSchema, createLinkSchema, creatorSlugSchema, linkUrlSchema, pageThemeSchema } from "./index";
import { createRateLimiter } from "./rate-limit";

describe("creator slug", () => {
  test("accepts lowercase slugs with single hyphens", () => {
    for (const slug of ["alice", "alice-b", "a1-b2", "abc"]) {
      expect(creatorSlugSchema.safeParse(slug).success).toBe(true);
    }
  });

  test("rejects reserved names, edge hyphens and uppercase", () => {
    for (const slug of ["admin", "api", "login", "-alice", "alice-", "Alice", "al ice", "ab"]) {
      expect(creatorSlugSchema.safeParse(slug).success).toBe(false);
    }
  });

  test("create schema trims the display name and rejects blanks", () => {
    const parsed = createCreatorSchema.safeParse({ slug: "alice", displayName: "  Alice  " });
    expect(parsed.success && parsed.data.displayName).toBe("Alice");
    expect(createCreatorSchema.safeParse({ slug: "alice", displayName: "   " }).success).toBe(false);
  });
});

describe("link url", () => {
  test("accepts only http and https", () => {
    expect(linkUrlSchema.safeParse("https://example.com").success).toBe(true);
    expect(linkUrlSchema.safeParse("http://example.com").success).toBe(true);
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "//example.com", "nope"]) {
      expect(linkUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  test("create schema requires a title and a valid url", () => {
    expect(createLinkSchema.safeParse({ title: "Site", url: "https://example.com" }).success).toBe(true);
    expect(createLinkSchema.safeParse({ title: "", url: "https://example.com" }).success).toBe(false);
    expect(createLinkSchema.safeParse({ title: "Site", url: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("page transitions", () => {
  test("allows the documented edges only", () => {
    expect(canTransitionPage("draft", "published")).toBe(true);
    expect(canTransitionPage("draft", "archived")).toBe(true);
    expect(canTransitionPage("published", "draft")).toBe(true);
    expect(canTransitionPage("archived", "draft")).toBe(true);
    expect(canTransitionPage("archived", "published")).toBe(false);
    expect(canTransitionPage("draft", "draft")).toBe(true);
  });

  test("theme schema drops unknown keys", () => {
    const parsed = pageThemeSchema.safeParse({ accent: "#fff", unknown: "x" });
    expect(parsed.success && parsed.data).toEqual({ accent: "#fff" });
    expect(pageThemeSchema.safeParse({ buttonStyle: "neon" }).success).toBe(false);
  });
});

describe("rate limiter", () => {
  test("blocks after the limit within the window and resets after it", () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: () => clock });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").remaining).toBe(0);
    const blocked = limiter.consume("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);

    // Other keys are unaffected.
    expect(limiter.consume("b").allowed).toBe(true);

    clock = 1001;
    expect(limiter.consume("a").allowed).toBe(true);
  });
});
