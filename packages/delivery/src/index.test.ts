import { describe, expect, test } from "bun:test";
import { createDeliveryService, createDownloadTokenSigner, type DeliveryDeps } from "./index";

const SECRET = "delivery-test-secret";

// In-memory storage so the tests do not touch the filesystem.
function memoryStorage(objects: Record<string, Uint8Array>) {
  return {
    put: async () => ({ key: "unused", sizeBytes: 0 }),
    get: async (key: string) => objects[key],
    remove: async () => {},
    list: async () => Object.keys(objects),
  };
}

const ENTITLEMENT = { id: "11111111-1111-4111-8111-111111111111", productId: "product-1", orderId: "order-1", buyerEmail: "buyer@example.com", revokedAt: null };
const ASSET = { id: "22222222-2222-4222-8222-222222222222", productId: "product-1", fileName: "preset.zip", contentType: "application/zip", sizeBytes: 5, storageKey: "aa/blob.zip" };
const OTHER_ASSET = { id: "33333333-3333-4333-8333-333333333333", productId: "product-2", fileName: "other.zip", contentType: "application/zip", sizeBytes: 5, storageKey: "aa/other.zip" };

function makeDeps(overrides: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    findOrderByReference: async (reference) => (reference === "REF1" ? { id: "order-1" } : undefined),
    listOrderItems: async () => [{ productId: "product-1", title: "Preset Pack" }],
    listEntitlementsByOrder: async () => [ENTITLEMENT],
    findEntitlement: async (id) => (id === ENTITLEMENT.id ? ENTITLEMENT : undefined),
    listAssetsByProduct: async (productId) => (productId === "product-1" ? [ASSET] : []),
    findAsset: async (id) => {
      if (id === ASSET.id) return ASSET;
      if (id === OTHER_ASSET.id) return OTHER_ASSET;
      return undefined;
    },
    ...overrides,
  };
}

describe("download token signer", () => {
  test("round-trips valid claims", () => {
    const signer = createDownloadTokenSigner({ secret: SECRET });
    const token = signer.sign({ entitlementId: ENTITLEMENT.id, assetId: ASSET.id });
    const claims = signer.verify(token);
    expect(claims?.entitlementId).toBe(ENTITLEMENT.id);
    expect(claims?.assetId).toBe(ASSET.id);
  });

  test("rejects a token signed with another secret", () => {
    const token = createDownloadTokenSigner({ secret: "other" }).sign({ entitlementId: ENTITLEMENT.id, assetId: ASSET.id });
    expect(createDownloadTokenSigner({ secret: SECRET }).verify(token)).toBeNull();
  });

  test("rejects a tampered payload", () => {
    const signer = createDownloadTokenSigner({ secret: SECRET });
    const token = signer.sign({ entitlementId: ENTITLEMENT.id, assetId: ASSET.id });
    const [prefix, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ entitlementId: ENTITLEMENT.id, assetId: OTHER_ASSET.id, expiresAt: 9_999_999_999 })).toString("base64url");
    expect(signer.verify(`${prefix}.${forged}.${sig}`)).toBeNull();
  });

  test("rejects an expired token", () => {
    const signer = createDownloadTokenSigner({ secret: SECRET, ttlSeconds: 60, now: () => 1_000_000 });
    const token = signer.sign({ entitlementId: ENTITLEMENT.id, assetId: ASSET.id });
    const later = createDownloadTokenSigner({ secret: SECRET, now: () => 1_000_000 + 61_000 });
    expect(later.verify(token)).toBeNull();
  });
});

describe("delivery service", () => {
  test("lists signed links for a paid order", async () => {
    const service = createDeliveryService(makeDeps(), memoryStorage({ [ASSET.storageKey]: new Uint8Array([1, 2, 3]) }), { secret: SECRET });
    const result = await service.listForOrder("REF1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].title).toBe("Preset Pack");
    expect(result.value[0].assets[0].fileName).toBe("preset.zip");
    expect(result.value[0].assets[0].downloadPath.startsWith("/download/v1.")).toBe(true);
    // The storage key never reaches the buyer.
    expect(JSON.stringify(result.value)).not.toContain("aa/blob.zip");
  });

  test("returns not_found for an unknown order", async () => {
    const service = createDeliveryService(makeDeps(), memoryStorage({}), { secret: SECRET });
    const result = await service.listForOrder("NOPE");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  test("returns not_found when the order has no entitlement yet", async () => {
    const service = createDeliveryService(makeDeps({ listEntitlementsByOrder: async () => [] }), memoryStorage({}), { secret: SECRET });
    expect(await service.listForOrder("REF1")).toEqual({ ok: false, error: "not_found" });
  });

  test("downloads the file behind a valid token", async () => {
    const service = createDeliveryService(makeDeps(), memoryStorage({ [ASSET.storageKey]: new TextEncoder().encode("data!") }), { secret: SECRET });
    const listed = await service.listForOrder("REF1");
    if (!listed.ok) throw new Error("expected links");
    const token = listed.value[0].assets[0].downloadPath.replace("/download/", "");

    const download = await service.openDownload(token);
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    expect(download.value.fileName).toBe("preset.zip");
    expect(new TextDecoder().decode(download.value.data)).toBe("data!");
  });

  test("rejects a forged token", async () => {
    const service = createDeliveryService(makeDeps(), memoryStorage({}), { secret: SECRET });
    expect(await service.openDownload("v1.abc.def")).toEqual({ ok: false, error: "invalid_token" });
  });

  test("rejects a token whose asset belongs to another product", async () => {
    const service = createDeliveryService(makeDeps(), memoryStorage({}), { secret: SECRET });
    const signer = createDownloadTokenSigner({ secret: SECRET });
    const token = signer.sign({ entitlementId: ENTITLEMENT.id, assetId: OTHER_ASSET.id });
    expect(await service.openDownload(token)).toEqual({ ok: false, error: "invalid_token" });
  });

  test("rejects a download after the entitlement is revoked", async () => {
    const revoked = { ...ENTITLEMENT, revokedAt: new Date() };
    const service = createDeliveryService(makeDeps({ findEntitlement: async () => revoked }), memoryStorage({}), { secret: SECRET });
    const token = createDownloadTokenSigner({ secret: SECRET }).sign({ entitlementId: ENTITLEMENT.id, assetId: ASSET.id });
    expect(await service.openDownload(token)).toEqual({ ok: false, error: "invalid_token" });
  });

  test("reports unavailable when the stored file is missing", async () => {
    const service = createDeliveryService(makeDeps(), memoryStorage({}), { secret: SECRET });
    const token = createDownloadTokenSigner({ secret: SECRET }).sign({ entitlementId: ENTITLEMENT.id, assetId: ASSET.id });
    expect(await service.openDownload(token)).toEqual({ ok: false, error: "unavailable" });
  });
});
