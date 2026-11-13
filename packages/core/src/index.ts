import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Database } from "@biova/database/types";
import {
  createCreatorRepository,
  createCreatorService,
  type Creator,
  type CreatorService,
} from "@biova/creator";
import { createLinkRepository, createLinkService, type Link, type LinkService } from "@biova/links";
import { createPageRepository, createPageService, type PageService } from "@biova/page";
import {
  createAssetRepository,
  createAssetService,
  createProductRepository,
  createProductService,
  type AssetService,
  type ProductService,
} from "@biova/products";
import { createOrderRepository, createOrderService, type OrderService } from "@biova/orders";
import { createFakeProvider, createMidtransProvider, type PaymentProvider } from "@biova/payments";
import { createDeliveryService, type DeliveryService } from "@biova/delivery";
import { createAnalyticsRepository, createAnalyticsService, type AnalyticsService } from "@biova/analytics";
import { createPluginRepository, createPluginService, type PluginService } from "@biova/plugins";
import { createMediaRepository, createMediaService, type MediaService } from "@biova/media";
import type { PluginCatalog, PluginSettings } from "@biova/shared";
import {
  createNotificationRepository,
  createNotificationService,
  createRecordingProvider,
  type NotificationProvider,
  type NotificationService,
} from "@biova/notifications";
import { createLocalStorage, type BlobStorage } from "@biova/storage";
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  MAX_ASSET_BYTES,
  MAX_MEDIA_BYTES,
  pageThemeSchema,
  readEnv,
  type PageTheme,
} from "@biova/shared";

// The catalog a process gets when no allowlist is supplied. A deployment passes
// the real registry; tests and the API may build services without one.
const EMPTY_PLUGIN_CATALOG: PluginCatalog = {
  get: () => undefined,
  list: () => [],
};

export interface BiovaServices {
  creators: CreatorService;
  pages: PageService;
  links: LinkService;
  products: ProductService;
  assets: AssetService;
  orders: OrderService;
  delivery: DeliveryService;
  analytics: AnalyticsService;
  notifications: NotificationService;
  plugins: PluginService;
  media: MediaService;
}

// Where a notification links back to. Read from configuration (never from a
// request host) so an email sent from a preview deploy still points at the real
// site. The web app owns this value; the API only ever sends from it.
export function createNotificationProvider(env: (key: string) => string | undefined = readEnv): NotificationProvider {
  // No transactional email driver is wired yet, so the default records messages
  // in memory instead of sending them. A deployment sets a real provider here.
  void env;
  return createRecordingProvider();
}

// Pick the payment provider from the environment. Midtrans is used when a
// server key is configured; otherwise a local fake provider keeps development
// and tests working without gateway credentials. The fake provider still
// requires a shared secret, so it cannot be driven by an unauthenticated caller.
export function createPaymentProvider(env: (key: string) => string | undefined = readEnv): PaymentProvider {
  const serverKey = env("MIDTRANS_SERVER_KEY");
  if (serverKey) {
    return createMidtransProvider({ serverKey, isProduction: env("MIDTRANS_IS_PRODUCTION") === "true" });
  }
  return createFakeProvider({ secret: env("PAYMENT_FAKE_SECRET") ?? "local-dev-fake-secret" });
}

// A relative storage path must mean the same directory no matter which app
// started the process: in this monorepo the API and the web server run with
// different working directories (apps/api, apps/web), so a plain ".storage"
// would resolve to two different folders and a file uploaded through one app
// would be invisible to the other. Anchoring it at the workspace root keeps a
// single store. An absolute path is used as given.
export function resolveStorageRoot(dir: string, cwd: string = process.cwd()): string {
  if (isAbsolute(dir)) return dir;
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, "turbo.json"))) return join(current, dir);
    const parent = dirname(current);
    if (parent === current) return resolve(cwd, dir);
    current = parent;
  }
}

// Where uploaded product files are stored. The default keeps local development
// working with no configuration; a deployment points STORAGE_DIR at a volume.
export function createBlobStorage(env: (key: string) => string | undefined = readEnv): BlobStorage {
  return createLocalStorage({
    root: resolveStorageRoot(env("STORAGE_DIR") ?? ".storage"),
    maxBytes: Number(env("MAX_ASSET_BYTES") ?? MAX_ASSET_BYTES),
  });
}

// Composition root: the web app and the API both build their services here so
// they share one set of domain rules. Only this module knows how the domains
// are wired together.
export interface CreateServicesOptions {
  paymentProvider?: PaymentProvider;
  storage?: BlobStorage;
  downloadTokenSecret?: string;
  notificationProvider?: NotificationProvider;
  // Public site origin used in notification links. Defaults to APP_URL.
  siteUrl?: string;
  // The build-time plugin allowlist. The web app passes the real registry; other
  // callers (tests, the API) may pass a catalog, or nothing for an empty one.
  pluginCatalog?: PluginCatalog;
}

export function createServices(db: Database, options: CreateServicesOptions = {}): BiovaServices {
  const creatorRepository = createCreatorRepository(db);
  const linkRepository = createLinkRepository(db);
  const pageRepository = createPageRepository(db);
  const productRepository = createProductRepository(db);
  const orderRepository = createOrderRepository(db);
  const assetRepository = createAssetRepository(db);

  const links = createLinkService(linkRepository);
  const products = createProductService(productRepository);
  const pages = createPageService(pageRepository, (creatorId) => links.hasEnabledLink(creatorId));
  const creators = createCreatorService(creatorRepository);

  const storage = options.storage ?? createBlobStorage();
  const assets = createAssetService(assetRepository, storage, {
    isOwnedProduct: (creatorId, productId) => products.ownsProduct(creatorId, productId),
  });

  // Notifications reach the creator contact through an injected function, so the
  // domain never imports the creator domain. The service swallows its own send
  // failures, so wiring it into the order path cannot fail a settled payment.
  const notifications = createNotificationService(
    createNotificationRepository(db),
    options.notificationProvider ?? createNotificationProvider(),
    {
      async findCreatorContact(creatorId) {
        const contact = await creators.getContactById(creatorId);
        if (!contact) return undefined;
        return { email: contact.email, displayName: contact.displayName, slug: contact.slug };
      },
      siteUrl: options.siteUrl ?? readEnv("APP_URL") ?? "http://localhost:3000",
    },
  );

  // The plugin domain reads the build-time allowlist through the catalog port.
  // It owns installations, settings and page blocks; it never imports a plugin
  // package or a UI framework, so it is safe to build in the API process too.
  const plugins = createPluginService(
    createPluginRepository(db),
    options.pluginCatalog ?? EMPTY_PLUGIN_CATALOG,
  );

  // Branding images (avatar, cover). Owns `creator_media`; the bytes go through
  // the same BlobStorage port as product assets, but the read model is a public
  // URL rather than a signed download.
  const media = createMediaService(createMediaRepository(db), storage, Number(readEnv("MAX_MEDIA_BYTES") ?? MAX_MEDIA_BYTES));

  // Checkout resolves the product through this function, so the price always
  // comes from a published row owned by the creator whose slug was requested.
  const orders = createOrderService(
    orderRepository,
    {
      async findSellableProduct(creatorSlug, productSlug) {
        const creator = await creators.getBySlug(creatorSlug);
        if (!creator) return undefined;
        const list = await products.listPublished(creator.id);
        const product = list.find((row) => row.slug === productSlug);
        if (!product) return undefined;
        return {
          creatorId: creator.id,
          productId: product.id,
          slug: product.slug,
          title: product.title,
          priceIdr: product.priceIdr,
        };
      },
      onOrderPaid: (input) => notifications.notifyOrderPaid(input),
    },
    options.paymentProvider ?? createPaymentProvider(),
  );

  // Delivery reads orders, entitlements and assets through injected functions,
  // so it never imports those domains directly.
  const delivery = createDeliveryService(
    {
      async findOrderByReference(reference) {
        const found = await orders.getByReference(reference);
        return found ? { id: found.order.id } : undefined;
      },
      async listOrderItems(orderId) {
        const order = await orderRepository.findById(orderId);
        if (!order) return [];
        const items = await orderRepository.listItems(order.id);
        return items.map((item) => ({ productId: item.productId, title: item.title }));
      },
      listEntitlementsByOrder: (orderId) => orderRepository.listEntitlements(orderId),
      findEntitlement: (entitlementId) => orderRepository.findEntitlementById(entitlementId),
      listAssetsByProduct: (productId) => assetRepository.listByProduct(productId),
      findAsset: (assetId) => assetRepository.findByIdUnscoped(assetId),
    },
    storage,
    {
      secret: options.downloadTokenSecret ?? readEnv("DOWNLOAD_TOKEN_SECRET") ?? "local-dev-download-secret",
      ttlSeconds: Number(readEnv("DOWNLOAD_TOKEN_TTL_SECONDS") ?? DOWNLOAD_TOKEN_TTL_SECONDS),
    },
  );

  // Analytics reads links, products and paid-order totals through injected
  // functions, so the domain owns only its event tables and never imports the
  // domains it reports on.
  const analytics = createAnalyticsService(
    createAnalyticsRepository(db),
    {
      async listLinks(creatorId) {
        const rows = await links.list(creatorId);
        return rows.map(({ id, title }) => ({ id, title }));
      },
      async listProducts(creatorId) {
        const rows = await products.list(creatorId);
        return rows.map(({ id, title }) => ({ id, title }));
      },
      paidOrders: (creatorId, since) => orders.paidTotalsSince(creatorId, since),
      paidRevenueByDay: (creatorId, since) => orders.paidRevenueByDay(creatorId, since),
      paidRevenueByProduct: (creatorId, since) => orders.paidRevenueByProduct(creatorId, since),
    },
  );

  return { creators, pages, links, products, assets, orders, delivery, analytics, notifications, plugins, media };
}

// Resolves the creator behind a published public page. Analytics ingest needs
// the creator id but must never trust one from the client, so both the API route
// and the web server function go through here.
export async function resolvePublishedCreatorId(services: BiovaServices, slug: string): Promise<string | undefined> {
  const creator = await services.creators.getBySlug(slug);
  if (!creator) return undefined;
  const page = await services.pages.getByCreatorId(creator.id);
  if (!page || page.status !== "published") return undefined;
  return creator.id;
}

export interface SitemapPage {
  slug: string;
  lastModified: Date;
}

// Every published page, for the sitemap. Only published pages are listed, so a
// draft or archived page is never advertised to a crawler.
export function listPublishedPages(services: BiovaServices): Promise<SitemapPage[]> {
  return services.pages.listPublishedWithCreator();
}

export interface PublicProduct {
  // Exposed so the public page can report a product_view event against the
  // right row; it is a random uuid and reveals nothing about the product.
  id: string;
  slug: string;
  title: string;
  description: string | null;
  priceIdr: number;
}

export interface PublicPage {
  creator: Pick<Creator, "slug" | "displayName" | "bio">;
  // Public branding image URLs, keyed by slot. A slot the creator has not
  // uploaded is absent rather than empty, so the page renders a placeholder.
  branding: Partial<Record<"avatar" | "cover", string>>;
  page: { title: string; theme: PageTheme; publishedAt: Date | null };
  links: Pick<Link, "id" | "title" | "url" | "description" | "icon">[];
  // Only published products are exposed; drafts and archived items never leak.
  products: PublicProduct[];
  // Page blocks contributed by installed and enabled plugins, in page order.
  // Already filtered by the plugin domain, so the renderer trusts this list.
  blocks: { id: string; pluginId: string; blockType: string; config: PluginSettings }[];
}

// Read model for the public page. Returns undefined unless the creator exists
// and their page is published, so drafts never leak to visitors.
export async function getPublicPage(services: BiovaServices, slug: string): Promise<PublicPage | undefined> {
  const creator = await services.creators.getBySlug(slug);
  if (!creator) return undefined;

  const page = await services.pages.getByCreatorId(creator.id);
  if (!page || page.status !== "published") return undefined;

  const links = await services.links.list(creator.id);
  const products = await services.products.listPublished(creator.id);
  const blocks = await services.plugins.listPublicBlocks(creator.id, page.id);
  const branding = await services.media.publicUrls(creator.slug, creator.id);

  // Stored theme may predate the current schema; ignore unknown keys rather than
  // failing the page, and only expose the values the renderer understands.
  const theme = pageThemeSchema.safeParse(page.theme);

  return {
    creator: { slug: creator.slug, displayName: creator.displayName, bio: creator.bio },
    branding,
    page: { title: page.title, theme: theme.success ? theme.data : {}, publishedAt: page.publishedAt },
    links: links
      .filter((link) => link.enabled)
      .map(({ id, title, url, description, icon }) => ({ id, title, url, description, icon })),
    products: products.map(({ id, slug, title, description, priceIdr }) => ({ id, slug, title, description, priceIdr })),
    blocks,
  };
}
