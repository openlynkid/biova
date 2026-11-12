import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { createServices, type BiovaServices } from "@biova/core";
import {
  createLinkSchema,
  createProductSchema,
  creatorSlugSchema,
  displayNameSchema,
  bioSchema,
  linkUrlSchema,
  linkTitleSchema,
  linkDescriptionSchema,
  linkIconSchema,
  pageThemeSchema,
  pageStatusSchema,
  productStatusSchema,
  productTitleSchema,
  productDescriptionSchema,
  productPriceSchema,
  type PageTheme,
} from "@biova/shared";

// Loaded lazily so the browser bundle never pulls in the database driver.
let servicesPromise: Promise<BiovaServices> | undefined;
function getServices(): Promise<BiovaServices> {
  servicesPromise ??= import("@biova/database").then(({ db }) => createServices(db));
  return servicesPromise;
}

// Resolve the signed-in user from the incoming request cookies. Runs on the
// server only; `getRequestHeaders` is a no-op in the browser bundle.
async function sessionUserId(): Promise<string | null> {
  const headers = getRequestHeaders();
  const { auth } = await import("@biova/auth");
  const session = await auth.api.getSession({ headers });
  return session ? session.user.id : null;
}

async function requireCreator() {
  const userId = await sessionUserId();
  if (!userId) throw new Error("unauthorized");
  const services = await getServices();
  const creator = await services.creators.getByUserId(userId);
  return { services, creator, userId };
}

export interface ProductView {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  priceIdr: number;
  status: string;
}

export interface DashboardData {
  creator: {
    id: string;
    slug: string;
    displayName: string;
    bio: string | null;
  };
  page: { title: string; status: string; theme: PageTheme } | null;
  links: { id: string; title: string; url: string; description: string | null; icon: string | null; enabled: boolean }[];
  products: ProductView[];
}

// The dashboard loader: one round trip for creator, page and links.
export const getDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardData | null> => {
  const userId = await sessionUserId();
  if (!userId) return null;
  const services = await getServices();
  const creator = await services.creators.getByUserId(userId);
  if (!creator) return null;

  const page = await services.pages.ensurePage(creator.id);
  const links = await services.links.list(creator.id);
  const products = await services.products.list(creator.id);

  return {
    creator: { id: creator.id, slug: creator.slug, displayName: creator.displayName, bio: creator.bio },
    page: { title: page.title, status: page.status, theme: pageThemeSchema.safeParse(page.theme).data ?? {} },
    links: links.map(({ id, title, url, description, icon, enabled }) => ({ id, title, url, description, icon, enabled })),
    products: products.map(toProductView),
  };
});

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await sessionUserId();
  if (!userId) return null;
  const services = await getServices();
  const creator = await services.creators.getByUserId(userId);
  return { userId, hasCreator: creator !== undefined, slug: creator?.slug ?? null };
});

// Service failures are returned as a small error code the UI can show; the
// message never includes internals.
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Server function payloads must be serializable, so domain rows (with Date
// columns) are mapped to plain shapes before they cross the boundary.
type LinkView = { id: string; title: string; url: string; description: string | null; icon: string | null; enabled: boolean };
function toLinkView(link: { id: string; title: string; url: string; description: string | null; icon: string | null; enabled: boolean }): LinkView {
  return { id: link.id, title: link.title, url: link.url, description: link.description, icon: link.icon, enabled: link.enabled };
}

function toProductView(product: {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  priceIdr: number;
  status: string;
}): ProductView {
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    priceIdr: product.priceIdr,
    status: product.status,
  };
}

function unwrapProduct(result: { ok: true; value: Parameters<typeof toProductView>[0] } | { ok: false; error: string }): ActionResult<ProductView> {
  return result.ok ? { ok: true, data: toProductView(result.value) } : { ok: false, error: result.error };
}

function unwrapLink(result: { ok: true; value: Parameters<typeof toLinkView>[0] } | { ok: false; error: string }): ActionResult<LinkView> {
  return result.ok ? { ok: true, data: toLinkView(result.value) } : { ok: false, error: result.error };
}

const onboardingSchema = z.object({
  slug: creatorSlugSchema,
  displayName: displayNameSchema,
  bio: bioSchema.nullish(),
});

export const createCreator = createServerFn({ method: "POST" })
  .validator(onboardingSchema)
  .handler(async ({ data }) => {
    const userId = await sessionUserId();
    if (!userId) return { ok: false as const, error: "unauthorized" };
    const services = await getServices();
    const result = await services.creators.getOrCreate({
      userId,
      slug: data.slug,
      displayName: data.displayName,
      bio: data.bio ?? null,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    await services.pages.ensurePage(result.value.id);
    return { ok: true as const, data: { slug: result.value.slug } };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .validator(z.object({ displayName: displayNameSchema.optional(), bio: bioSchema.nullish() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.creators.updateProfile({
      creatorId: creator.id,
      displayName: data.displayName,
      bio: data.bio ?? undefined,
    });
    return result.ok ? { ok: true as const, data: { displayName: result.value.displayName } } : { ok: false as const, error: result.error };
  });

export const updatePage = createServerFn({ method: "POST" })
  .validator(z.object({ title: z.string().trim().min(1).max(120).optional(), theme: pageThemeSchema.optional() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    await services.pages.ensurePage(creator.id);
    const result = await services.pages.update({ creatorId: creator.id, title: data.title, theme: data.theme });
    return result.ok ? { ok: true as const, data: { title: result.value.title, status: result.value.status } } : { ok: false as const, error: result.error };
  });

export const setPageStatus = createServerFn({ method: "POST" })
  .validator(z.object({ status: pageStatusSchema }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    await services.pages.ensurePage(creator.id);
    const result = await services.pages.setStatus(creator.id, data.status);
    return result.ok ? { ok: true as const, data: { title: result.value.title, status: result.value.status } } : { ok: false as const, error: result.error };
  });

export const createLink = createServerFn({ method: "POST" })
  .validator(createLinkSchema)
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.links.create({ creatorId: creator.id, ...data });
    return unwrapLink(result);
  });

export const updateLink = createServerFn({ method: "POST" })
  .validator(
    z.object({
      linkId: z.uuid(),
      title: linkTitleSchema.optional(),
      url: linkUrlSchema.optional(),
      description: linkDescriptionSchema.nullish(),
      icon: linkIconSchema.nullish(),
      enabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.links.update({
      creatorId: creator.id,
      linkId: data.linkId,
      title: data.title,
      url: data.url,
      description: data.description,
      icon: data.icon,
      enabled: data.enabled,
    });
    return unwrapLink(result);
  });

export const deleteLink = createServerFn({ method: "POST" })
  .validator(z.object({ linkId: z.uuid() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.links.remove(creator.id, data.linkId);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

export const reorderLinks = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(z.uuid()).min(1).max(200) }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.links.reorder(creator.id, data.ids);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

export const createProduct = createServerFn({ method: "POST" })
  .validator(createProductSchema)
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.products.create({ creatorId: creator.id, ...data });
    return unwrapProduct(result);
  });

export const updateProduct = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productId: z.uuid(),
      title: productTitleSchema.optional(),
      description: productDescriptionSchema.nullish(),
      priceIdr: productPriceSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.products.update({
      creatorId: creator.id,
      productId: data.productId,
      title: data.title,
      description: data.description,
      priceIdr: data.priceIdr,
    });
    return unwrapProduct(result);
  });

export const setProductStatus = createServerFn({ method: "POST" })
  .validator(z.object({ productId: z.uuid(), status: productStatusSchema }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.products.setStatus(creator.id, data.productId, data.status);
    return unwrapProduct(result);
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .validator(z.object({ productId: z.uuid() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.products.remove(creator.id, data.productId);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

export const reorderProducts = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(z.uuid()).min(1).max(200) }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.products.reorder(creator.id, data.ids);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });
