export * from "./creator";
export * from "./page";
export * from "./links";
export * from "./result";
export * from "./rate-limit";
export * from "./env";

// Session policy shared by the web app and the API. Better Auth interprets
// expiresIn/updateAge in seconds and cookieCache.maxAge in seconds.
export const sessionPolicy = {
  expiresIn: 60 * 60 * 24 * 7,
  updateAge: 60 * 60 * 24,
  cookieCache: { enabled: true, maxAge: 60 * 5 },
} as const;
