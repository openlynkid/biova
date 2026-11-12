import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServices, type BiovaServices } from "@biova/core";
import { createOrderSchema, orderReferenceSchema } from "@biova/shared";

// Loaded lazily so the browser bundle never pulls in the database driver.
let servicesPromise: Promise<BiovaServices> | undefined;
function getServices(): Promise<BiovaServices> {
  servicesPromise ??= import("@biova/database").then(({ db }) => createServices(db));
  return servicesPromise;
}

export interface CheckoutProduct {
  creatorSlug: string;
  creatorName: string;
  slug: string;
  title: string;
  description: string | null;
  priceIdr: number;
}

// Public product read for the checkout page. Only a published product on a
// published page is returned, matching what the public page shows.
export const getCheckoutProduct = createServerFn({ method: "GET" })
  .validator(z.object({ creatorSlug: z.string().min(1).max(48), productSlug: z.string().min(1).max(48) }))
  .handler(async ({ data }): Promise<CheckoutProduct | null> => {
    const services = await getServices();
    const creator = await services.creators.getBySlug(data.creatorSlug);
    if (!creator) return null;
    const page = await services.pages.getByCreatorId(creator.id);
    if (!page || page.status !== "published") return null;

    const published = await services.products.listPublished(creator.id);
    const product = published.find((row) => row.slug === data.productSlug);
    if (!product) return null;

    return {
      creatorSlug: creator.slug,
      creatorName: creator.displayName,
      slug: product.slug,
      title: product.title,
      description: product.description,
      priceIdr: product.priceIdr,
    };
  });

// Starts a checkout for a visitor. Public: no session is required to buy. The
// price is resolved server-side, so the form never sends an amount.
export const startCheckout = createServerFn({ method: "POST" })
  .validator(createOrderSchema.extend({ creatorSlug: z.string().min(1).max(48) }))
  .handler(async ({ data }) => {
    const services = await getServices();
    const result = await services.orders.checkout({
      creatorSlug: data.creatorSlug,
      productSlug: data.productSlug,
      buyerName: data.buyerName,
      buyerEmail: data.buyerEmail,
      buyerPhone: data.buyerPhone ?? null,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return {
      ok: true as const,
      data: { reference: result.value.order.reference, redirectUrl: result.value.redirectUrl },
    };
  });

export interface OrderView {
  reference: string;
  status: string;
  totalIdr: number;
  currency: string;
  buyerEmail: string;
  paidAt: string | null;
  items: { title: string; unitPriceIdr: number }[];
}

// Buyer order lookup. The reference acts as the bearer credential; the page is
// reachable only with the value returned from checkout.
export const getOrder = createServerFn({ method: "GET" })
  .validator(z.object({ reference: orderReferenceSchema }))
  .handler(async ({ data }): Promise<OrderView | null> => {
    const services = await getServices();
    const found = await services.orders.getByReference(data.reference);
    if (!found) return null;
    return {
      reference: found.order.reference,
      status: found.order.status,
      totalIdr: found.order.totalIdr,
      currency: found.order.currency,
      buyerEmail: found.order.buyerEmail,
      paidAt: found.order.paidAt ? found.order.paidAt.toISOString() : null,
      items: found.items.map((item) => ({ title: item.title, unitPriceIdr: item.unitPriceIdr })),
    };
  });
