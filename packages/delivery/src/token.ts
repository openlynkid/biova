import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  downloadTokenClaimsSchema,
  type DownloadTokenClaims,
} from "@biova/shared";

// Signed download tokens. A token is `v1.<payload>.<signature>` where the
// signature is an HMAC over the payload, so a buyer cannot edit the asset id to
// point at someone else's file, and a leaked link stops working after the TTL.
export interface DownloadTokenSigner {
  sign(input: { entitlementId: string; assetId: string }): string;
  verify(token: string): DownloadTokenClaims | null;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function createDownloadTokenSigner(options: { secret: string; ttlSeconds?: number; now?: () => number }): DownloadTokenSigner {
  const ttlSeconds = options.ttlSeconds ?? DOWNLOAD_TOKEN_TTL_SECONDS;
  const now = options.now ?? Date.now;

  function signature(payload: string): Buffer {
    return createHmac("sha256", options.secret).update(payload).digest();
  }

  return {
    sign({ entitlementId, assetId }) {
      const claims: DownloadTokenClaims = {
        entitlementId,
        assetId,
        expiresAt: Math.floor(now() / 1000) + ttlSeconds,
      };
      const payload = base64url(Buffer.from(JSON.stringify(claims)));
      return `v1.${payload}.${base64url(signature(payload))}`;
    },

    verify(token) {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[0] !== "v1") return null;

      const [, payload, provided] = parts;
      const expected = signature(payload);
      const providedBuffer = Buffer.from(provided, "base64url");
      // Length must match before timingSafeEqual, which throws on a mismatch.
      if (providedBuffer.length !== expected.length) return null;
      if (!timingSafeEqual(providedBuffer, expected)) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return null;
      }

      const claims = downloadTokenClaimsSchema.safeParse(parsed);
      if (!claims.success) return null;
      if (claims.data.expiresAt * 1000 <= now()) return null;
      return claims.data;
    },
  };
}
