import { describe, expect, test } from "bun:test";
import { sessionPolicy } from "@biova/shared";

describe("session policy", () => {
  test("sessions expire in seven days and refresh daily", () => {
    expect(sessionPolicy.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(sessionPolicy.updateAge).toBe(60 * 60 * 24);
  });

  test("cookie cache is enabled with a short max age", () => {
    expect(sessionPolicy.cookieCache.enabled).toBe(true);
    expect(sessionPolicy.cookieCache.maxAge).toBeLessThanOrEqual(sessionPolicy.updateAge);
  });
});
