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
import { createLocalStorage, type BlobStorage } from "@biova/storage";
import { DOWNLOAD_TOKEN_TTL_SECONDS, MAX_ASSET_BYTES, pageThemeSchema, readEnv, type PageTheme } from "@biova/shared";

export interface BiovaServices {
  creators: CreatorService;
  pages: PageService;
  links: LinkService;
  products: ProductService;
  assets: AssetService;
  orders: OrderService;
  delivery: DeliveryService;
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

  return { creators, pages, links, products, assets, orders, delivery };
}

export interface PublicProduct {
  slug: string;
  title: string;
  description: string | null;
  priceIdr: number;
}

export interface PublicPage {
  creator: Pick<Creator, "slug" | "displayName" | "bio">;
  page: { title: string; theme: PageTheme; publishedAt: Date | null };
  links: Pick<Link, "id" | "title" | "url" | "description" | "icon">[];
  // Only published products are exposed; drafts and archived items never leak.
  products: PublicProduct[];
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

  // Stored theme may predate the current schema; ignore unknown keys rather than
  // failing the page, and only expose the values the renderer understands.
  const theme = pageThemeSchema.safeParse(page.theme);

  return {
    creator: { slug: creator.slug, displayName: creator.displayName, bio: creator.bio },
    page: { title: page.title, theme: theme.success ? theme.data : {}, publishedAt: page.publishedAt },
    links: links
      .filter((link) => link.enabled)
      .map(({ id, title, url, description, icon }) => ({ id, title, url, description, icon })),
    products: products.map(({ slug, title, description, priceIdr }) => ({ slug, title, description, priceIdr })),
  };
}
