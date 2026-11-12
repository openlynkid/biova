import { describe, expect, test } from "bun:test";
import {
  canTransitionOrder,
  canTransitionPage,
  canTransitionProduct,
  createCreatorSchema,
  createLinkSchema,
  createOrderSchema,
  createProductSchema,
  creatorSlugSchema,
  formatPriceIdr,
  isPaymentFailed,
  isPaymentPaid,
  linkUrlSchema,
  pageThemeSchema,
  productSlugSchema,
} from "./index";
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

  test("theme colours must be hex, so CSS cannot be injected", () => {
    expect(pageThemeSchema.safeParse({ accent: "#8298ff" }).success).toBe(true);
    expect(pageThemeSchema.safeParse({ background: "#abc" }).success).toBe(true);
    for (const value of ["red", "#12345", "url(https://evil.test/x)", "var(--x)", "#fff;color:red"]) {
      expect(pageThemeSchema.safeParse({ accent: value }).success).toBe(false);
    }
  });
});

describe("product input", () => {
  test("accepts a well formed product and trims text", () => {
    const parsed = createProductSchema.safeParse({ title: "  E-book  ", slug: "ebook", priceIdr: 49_000 });
    expect(parsed.success && parsed.data.title).toBe("E-book");
    expect(createProductSchema.safeParse({ title: "E-book", slug: "ebook", priceIdr: 0 }).success).toBe(true);
  });

  test("rejects non-http slugs and out-of-range prices", () => {
    for (const slug of ["Bad Slug", "-x", "x-", "UP", "a b"]) {
      expect(productSlugSchema.safeParse(slug).success).toBe(false);
    }
    for (const priceIdr of [-1, 1.5, 100_000_001, Number.NaN]) {
      expect(createProductSchema.safeParse({ title: "T", slug: "t", priceIdr }).success).toBe(false);
    }
  });

  test("only allows the documented status edges", () => {
    expect(canTransitionProduct("draft", "published")).toBe(true);
    expect(canTransitionProduct("published", "archived")).toBe(true);
    expect(canTransitionProduct("archived", "draft")).toBe(true);
    expect(canTransitionProduct("archived", "published")).toBe(false);
  });

  test("formats whole rupiah without decimals", () => {
    expect(formatPriceIdr(0)).toBe("Rp0");
    expect(formatPriceIdr(49_000)).toBe("Rp49.000");
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

describe("order schema", () => {
  test("requires a name, a valid email and optional phone", () => {
    const ok = createOrderSchema.safeParse({
      productSlug: "ebook",
      buyerName: "  Buyer  ",
      buyerEmail: "buyer@example.com",
    });
    expect(ok.success && ok.data.buyerName).toBe("Buyer");

    expect(createOrderSchema.safeParse({ productSlug: "ebook", buyerName: "", buyerEmail: "a@b.com" }).success).toBe(false);
    expect(createOrderSchema.safeParse({ productSlug: "ebook", buyerName: "B", buyerEmail: "nope" }).success).toBe(false);
    expect(
      createOrderSchema.safeParse({ productSlug: "ebook", buyerName: "B", buyerEmail: "a@b.com", buyerPhone: "abc" }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({ productSlug: "ebook", buyerName: "B", buyerEmail: "a@b.com", buyerPhone: "+62 812 3456 7890" })
        .success,
    ).toBe(true);
  });

  test("only allows the documented order transitions", () => {
    expect(canTransitionOrder("pending", "paid")).toBe(true);
    expect(canTransitionOrder("paid", "refunded")).toBe(true);
    expect(canTransitionOrder("paid", "pending")).toBe(false);
    expect(canTransitionOrder("failed", "paid")).toBe(false);
    expect(canTransitionOrder("expired", "paid")).toBe(false);
    // A no-op transition is allowed so a repeated webhook is not an error.
    expect(canTransitionOrder("paid", "paid")).toBe(true);
  });

  test("classifies provider payment states", () => {
    expect(isPaymentPaid("settlement")).toBe(true);
    expect(isPaymentPaid("capture")).toBe(true);
    expect(isPaymentPaid("pending")).toBe(false);
    expect(isPaymentFailed("deny")).toBe(true);
    expect(isPaymentFailed("expire")).toBe(true);
    expect(isPaymentFailed("settlement")).toBe(false);
  });
});
