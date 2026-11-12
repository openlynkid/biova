import type { Result } from "@biova/shared";
import { ok, fail } from "@biova/shared";
import type { BlobStorage } from "@biova/storage";
import { createDownloadTokenSigner, type DownloadTokenSigner } from "./token";

export * from "./token";

export type DeliveryError = "not_found" | "invalid_token" | "unavailable";

export interface EntitlementRow {
  id: string;
  productId: string;
  orderId: string;
  buyerEmail: string;
  revokedAt: Date | null;
}

export interface DeliveryAsset {
  assetId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  // Signed, time-boxed link. It carries no storage key, so the underlying file
  // location never reaches the browser.
  downloadPath: string;
}

export interface DeliveryItem {
  entitlementId: string;
  productId: string;
  title: string;
  assets: DeliveryAsset[];
}

export interface DeliveryDownload {
  fileName: string;
  contentType: string;
  data: Uint8Array;
}

// Everything the delivery service needs from the other domains, injected by the
// composition root so no domain imports another.
export interface DeliveryDeps {
  findOrderByReference(reference: string): Promise<{ id: string } | undefined>;
  listOrderItems(orderId: string): Promise<{ productId: string | null; title: string }[]>;
  listEntitlementsByOrder(orderId: string): Promise<EntitlementRow[]>;
  findEntitlement(entitlementId: string): Promise<EntitlementRow | undefined>;
  listAssetsByProduct(productId: string): Promise<{ id: string; fileName: string; contentType: string; sizeBytes: number; storageKey: string }[]>;
  findAsset(assetId: string): Promise<{ id: string; productId: string; fileName: string; contentType: string; storageKey: string } | undefined>;
}

export interface DeliveryService {
  // Buyer-facing: the items a paid order grants, each asset with a signed link.
  // An order that is not found, or is not paid, returns not_found so an unpaid
  // reference discloses nothing.
  listForOrder(orderReference: string): Promise<Result<DeliveryItem[], DeliveryError>>;
  openDownload(token: string): Promise<Result<DeliveryDownload, DeliveryError>>;
}

export interface DeliveryServiceOptions {
  signer?: DownloadTokenSigner;
  secret: string;
  ttlSeconds?: number;
  now?: () => number;
}

export function createDeliveryService(
  deps: DeliveryDeps,
  storage: BlobStorage,
  options: DeliveryServiceOptions,
): DeliveryService {
  const signer = options.signer ?? createDownloadTokenSigner({ secret: options.secret, ttlSeconds: options.ttlSeconds, now: options.now });

  return {
    async listForOrder(orderReference) {
      const order = await deps.findOrderByReference(orderReference);
      if (!order) return fail("not_found");

      const [entitlements, items] = await Promise.all([
        deps.listEntitlementsByOrder(order.id),
        deps.listOrderItems(order.id),
      ]);
      const active = entitlements.filter((entitlement) => entitlement.revokedAt === null);
      if (active.length === 0) return fail("not_found");

      const titlesByProduct = new Map(items.filter((item) => item.productId).map((item) => [item.productId as string, item.title]));

      const result: DeliveryItem[] = [];
      for (const entitlement of active) {
        const assets = await deps.listAssetsByProduct(entitlement.productId);
        result.push({
          entitlementId: entitlement.id,
          productId: entitlement.productId,
          title: titlesByProduct.get(entitlement.productId) ?? "Your purchase",
          assets: assets.map((asset) => ({
            assetId: asset.id,
            fileName: asset.fileName,
            contentType: asset.contentType,
            sizeBytes: asset.sizeBytes,
            downloadPath: `/download/${signer.sign({ entitlementId: entitlement.id, assetId: asset.id })}`,
          })),
        });
      }
      return ok(result);
    },

    async openDownload(token) {
      const claims = signer.verify(token);
      if (!claims) return fail("invalid_token");

      const entitlement = await deps.findEntitlement(claims.entitlementId);
      if (!entitlement || entitlement.revokedAt !== null) return fail("invalid_token");

      const asset = await deps.findAsset(claims.assetId);
      // The token names one asset; the asset must belong to the product the
      // entitlement grants. A token edited to another asset fails here even if
      // the signature somehow matched.
      if (!asset || asset.productId !== entitlement.productId) return fail("invalid_token");

      const data = await storage.get(asset.storageKey);
      if (!data) return fail("unavailable");

      return ok({ fileName: asset.fileName, contentType: asset.contentType, data });
    },
  };
}
