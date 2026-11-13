import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { getServices } from "./services";
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
  formatBytes,
  analyticsRangeSchema,
  pluginIdSchema,
  pluginPermissionSchema,
  pluginSettingsSchema,
  type AnalyticsRange,
  type AssetView,
  type PageTheme,
  type PluginManifest,
  type PluginPermission,
  type PluginSettings,
} from "@biova/shared";

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

export interface OrderView {
  reference: string;
  status: string;
  totalIdr: number;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
  items: { title: string; unitPriceIdr: number }[];
}

export interface AnalyticsView {
  range: AnalyticsRange;
  pageViews: number;
  uniqueVisitors: number;
  linkClicks: number;
  clickThroughRate: number;
  productViews: number;
  orders: number;
  revenueIdr: number;
  averageOrderValueIdr: number;
  conversionRate: number;
  links: { linkId: string; title: string; clicks: number }[];
  products: {
    productId: string;
    title: string;
    views: number;
    orders: number;
    revenueIdr: number;
    conversionRate: number;
  }[];
}

export interface AnalyticsDayView {
  date: string;
  pageViews: number;
  linkClicks: number;
  productViews: number;
  orders: number;
  revenueIdr: number;
}

export interface PluginPanelView {
  manifest: PluginManifest;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
  settings: PluginSettings;
}

export interface BlockView {
  id: string;
  pluginId: string;
  blockType: string;
  config: PluginSettings;
  enabled: boolean;
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
  orders: OrderView[];
  analytics: AnalyticsView;
  analyticsDays: AnalyticsDayView[];
  plugins: PluginPanelView[];
  blocks: BlockView[];
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
  const orders = await services.orders.listByCreator(creator.id);
  const [analytics, timeseries, plugins, blocks] = await Promise.all([
    services.analytics.summary(creator.id, "30d"),
    services.analytics.timeseries(creator.id, "30d"),
    services.plugins.listForCreator(creator.id),
    services.plugins.listBlocks(creator.id, page.id),
  ]);

  return {
    creator: { id: creator.id, slug: creator.slug, displayName: creator.displayName, bio: creator.bio },
    page: { title: page.title, status: page.status, theme: pageThemeSchema.safeParse(page.theme).data ?? {} },
    links: links.map(({ id, title, url, description, icon, enabled }) => ({ id, title, url, description, icon, enabled })),
    products: products.map(toProductView),
    orders: orders.map(({ order, items }) => ({
      reference: order.reference,
      status: order.status,
      totalIdr: order.totalIdr,
      currency: order.currency,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      createdAt: order.createdAt.toISOString(),
      items: items.map((item) => ({ title: item.title, unitPriceIdr: item.unitPriceIdr })),
    })),
    analytics,
    analyticsDays: timeseries.days,
    plugins: plugins.map(toPluginView),
    blocks: blocks.ok ? blocks.value.map(toBlockView) : [],
  };
});

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await sessionUserId();
  if (!userId) return null;
  const services = await getServices();
  const creator = await services.creators.getByUserId(userId);
  return { userId, hasCreator: creator !== undefined, slug: creator?.slug ?? null };
});

export interface AnalyticsDetail {
  summary: AnalyticsView;
  days: AnalyticsDayView[];
}

// The range control re-reads both the totals and the daily chart for the chosen
// window in one call, so the numbers and the bars never describe two periods.
export const getAnalytics = createServerFn({ method: "GET" })
  .validator((range: unknown) => analyticsRangeSchema.parse(range ?? "30d"))
  .handler(async ({ data: range }): Promise<AnalyticsDetail | null> => {
    const userId = await sessionUserId();
    if (!userId) return null;
    const services = await getServices();
    const creator = await services.creators.getByUserId(userId);
    if (!creator) return null;
    const [summary, timeseries] = await Promise.all([
      services.analytics.summary(creator.id, range),
      services.analytics.timeseries(creator.id, range),
    ]);
    return { summary, days: timeseries.days };
  });

function toPluginView(plugin: {
  manifest: PluginManifest;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
  settings: PluginSettings;
}): PluginPanelView {
  return {
    manifest: plugin.manifest,
    installed: plugin.installed,
    enabled: plugin.enabled,
    grantedPermissions: plugin.grantedPermissions,
    settings: plugin.settings,
  };
}

function toBlockView(block: {
  id: string;
  pluginId: string;
  blockType: string;
  config: Record<string, unknown>;
  enabled: boolean;
}): BlockView {
  return {
    id: block.id,
    pluginId: block.pluginId,
    blockType: block.blockType,
    // Stored JSON is written through the settings schema, so it is the
    // serializable subset by construction.
    config: block.config as PluginSettings,
    enabled: block.enabled,
  };
}

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

// --- Product assets -------------------------------------------------------

export const listProductAssets = createServerFn({ method: "GET" })
  .validator(z.object({ productId: z.uuid() }))
  .handler(async ({ data }): Promise<{ ok: true; data: AssetView[] } | { ok: false; error: string }> => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false, error: "not_found" };
    const result = await services.assets.list(creator.id, data.productId);
    return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
  });

// Uploads are multipart: the browser sends a FormData carrying the product id
// and the file. The bytes are handed to the storage service, which decides where
// they live, so no client-supplied path is ever used.
export const uploadProductAsset = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }): Promise<{ ok: true; data: AssetView } | { ok: false; error: string }> => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false, error: "not_found" };

    const productId = String(data.get("productId") ?? "");
    const file = data.get("file");
    if (!(file instanceof File)) return { ok: false, error: "invalid_input" };

    const result = await services.assets.add({
      creatorId: creator.id,
      productId,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
  });

export const deleteProductAsset = createServerFn({ method: "POST" })
  .validator(z.object({ assetId: z.uuid() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.assets.remove(creator.id, data.assetId);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

export const reorderProductAssets = createServerFn({ method: "POST" })
  .validator(z.object({ productId: z.uuid(), ids: z.array(z.uuid()).min(1).max(100) }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.assets.reorder(creator.id, data.productId, data.ids);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

// Human-readable size for the upload list.
export const assetSizeLabel = formatBytes;

// --- Plugins and page blocks ----------------------------------------------

export const installPlugin = createServerFn({ method: "POST" })
  .validator(z.object({ pluginId: pluginIdSchema }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.plugins.install(creator.id, data.pluginId);
    return result.ok ? { ok: true as const, data: toPluginView(result.value) } : { ok: false as const, error: result.error };
  });

export const uninstallPlugin = createServerFn({ method: "POST" })
  .validator(z.object({ pluginId: pluginIdSchema }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.plugins.uninstall(creator.id, data.pluginId);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

export const setPluginEnabled = createServerFn({ method: "POST" })
  .validator(z.object({ pluginId: pluginIdSchema, enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.plugins.setEnabled(creator.id, data.pluginId, data.enabled);
    return result.ok ? { ok: true as const, data: toPluginView(result.value) } : { ok: false as const, error: result.error };
  });

export const setPluginPermission = createServerFn({ method: "POST" })
  .validator(z.object({ pluginId: pluginIdSchema, permission: pluginPermissionSchema, granted: z.boolean() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = data.granted
      ? await services.plugins.grantPermission(creator.id, data.pluginId, data.permission)
      : await services.plugins.revokePermission(creator.id, data.pluginId, data.permission);
    return result.ok ? { ok: true as const, data: toPluginView(result.value) } : { ok: false as const, error: result.error };
  });

export const updatePluginSettings = createServerFn({ method: "POST" })
  .validator(z.object({ pluginId: pluginIdSchema, settings: pluginSettingsSchema }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.plugins.updateSettings(creator.id, data.pluginId, data.settings);
    return result.ok ? { ok: true as const, data: toPluginView(result.value) } : { ok: false as const, error: result.error };
  });

export const addBlock = createServerFn({ method: "POST" })
  .validator(z.object({ pluginId: pluginIdSchema, blockType: z.string().trim().min(1).max(100), config: pluginSettingsSchema.optional() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const page = await services.pages.ensurePage(creator.id);
    const result = await services.plugins.addBlock({
      creatorId: creator.id,
      pageId: page.id,
      pluginId: data.pluginId,
      blockType: data.blockType,
      config: data.config,
    });
    return result.ok ? { ok: true as const, data: toBlockView(result.value) } : { ok: false as const, error: result.error };
  });

export const updateBlock = createServerFn({ method: "POST" })
  .validator(z.object({ blockId: z.uuid(), config: pluginSettingsSchema.optional(), enabled: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.plugins.updateBlock({
      creatorId: creator.id,
      blockId: data.blockId,
      config: data.config,
      enabled: data.enabled,
    });
    return result.ok ? { ok: true as const, data: toBlockView(result.value) } : { ok: false as const, error: result.error };
  });

export const removeBlock = createServerFn({ method: "POST" })
  .validator(z.object({ blockId: z.uuid() }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const result = await services.plugins.removeBlock(creator.id, data.blockId);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });

export const reorderBlocks = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
  .handler(async ({ data }) => {
    const { services, creator } = await requireCreator();
    if (!creator) return { ok: false as const, error: "not_found" };
    const page = await services.pages.ensurePage(creator.id);
    const result = await services.plugins.reorderBlocks(creator.id, page.id, data.ids);
    return result.ok ? { ok: true as const, data: result.value } : { ok: false as const, error: result.error };
  });
