import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Values mirror pageStatusSchema in @biova/shared. Transitions are enforced in
// the page domain service; the enum only rejects unknown states at the boundary.
export const pageStatus = pgEnum("page_status", ["draft", "published", "archived"]);

// Values mirror productStatusSchema in @biova/shared. Transitions are enforced
// in the products domain service; the enum only rejects unknown states.
export const productStatus = pgEnum("product_status", ["draft", "published", "archived"]);

// Values mirror orderStatusSchema in @biova/shared. Transitions are enforced in
// the orders domain service; the enum only rejects unknown states.
export const orderStatus = pgEnum("order_status", ["pending", "paid", "failed", "expired", "refunded"]);

// Raw provider states. The orders service maps them onto the order status.
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "settlement",
  "capture",
  "deny",
  "cancel",
  "expire",
  "refund",
]);

export const creators = pgTable("creators", {
  id: uuid("id").defaultRandom().primaryKey(),
  // One creator profile per auth user.
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 48 }).notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  bio: varchar("bio", { length: 500 }),
  ...timestamps(),
}, (table) => [uniqueIndex("creators_slug_uq").on(table.slug)]);

export const pages = pgTable("pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  // MVP is one public page per creator, so this is unique. Relax to a
  // (creatorId, slug) unique index when multi-page accounts arrive.
  creatorId: uuid("creator_id").notNull().unique().references(() => creators.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  status: pageStatus("status").notNull().default("draft"),
  theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps(),
}, (table) => [index("pages_status_idx").on(table.status)]);

export const links = pgTable("links", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  url: text("url").notNull(),
  description: varchar("description", { length: 240 }),
  icon: varchar("icon", { length: 32 }),
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps(),
}, (table) => [index("links_creator_sort_idx").on(table.creatorId, table.sortOrder)]);

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  // Unique per creator, not globally: two creators may both sell "preset-pack".
  slug: varchar("slug", { length: 48 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description"),
  // Whole rupiah. Rupiah has no minor unit, so an integer is exact.
  priceIdr: integer("price_idr").notNull(),
  status: productStatus("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps(),
}, (table) => [
  uniqueIndex("products_creator_slug_uq").on(table.creatorId, table.slug),
  index("products_creator_sort_idx").on(table.creatorId, table.sortOrder),
  index("products_status_idx").on(table.status),
]);

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  // Short random public reference. Buyers open their confirmation page with it,
  // so it must not be derivable from the creator slug or the product slug.
  reference: varchar("reference", { length: 32 }).notNull(),
  status: orderStatus("status").notNull().default("pending"),
  buyerName: varchar("buyer_name", { length: 120 }).notNull(),
  buyerEmail: varchar("buyer_email", { length: 254 }).notNull(),
  buyerPhone: varchar("buyer_phone", { length: 32 }),
  // Amounts are stored on the order so a later price change never rewrites
  // history. Rupiah has no minor unit, so these are whole integers.
  subtotalIdr: integer("subtotal_idr").notNull(),
  totalIdr: integer("total_idr").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("IDR"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  ...timestamps(),
}, (table) => [
  uniqueIndex("orders_reference_uq").on(table.reference),
  index("orders_creator_created_idx").on(table.creatorId, table.createdAt),
  index("orders_buyer_email_idx").on(table.buyerEmail),
  index("orders_status_idx").on(table.status),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  // Snapshot of the product at purchase time: title and price are copied so the
  // order stays readable even if the product is later edited or deleted.
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  productSlug: varchar("product_slug", { length: 48 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceIdr: integer("unit_price_idr").notNull(),
  totalPriceIdr: integer("total_price_idr").notNull(),
  ...timestamps(),
}, (table) => [index("order_items_order_idx").on(table.orderId)]);

export const paymentTransactions = pgTable("payment_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  // Provider-side id (Midtrans transaction_id / order_id). Unique per provider
  // so a replayed webhook updates one row instead of inserting a duplicate.
  providerReference: varchar("provider_reference", { length: 128 }).notNull(),
  status: paymentStatus("status").notNull().default("pending"),
  amountIdr: integer("amount_idr").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("IDR"),
  redirectUrl: text("redirect_url"),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
}, (table) => [
  uniqueIndex("payment_transactions_provider_ref_uq").on(table.provider, table.providerReference),
  index("payment_transactions_order_idx").on(table.orderId),
]);

// One row per webhook delivery we accept, keyed by the provider event id. The
// unique index is what makes webhook handling idempotent: a replay inserts
// nothing and is treated as already processed.
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 32 }).notNull(),
  eventId: varchar("event_id", { length: 160 }).notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
}, (table) => [uniqueIndex("payment_webhook_events_provider_event_uq").on(table.provider, table.eventId)]);

// A buyer's right to a product. Created only after a verified payment. Delivery
// (the signed download) reads this row; a public URL alone grants nothing.
export const productEntitlements = pgTable("product_entitlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  buyerEmail: varchar("buyer_email", { length: 254 }).notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps(),
}, (table) => [
  // One entitlement per (order, product): a replayed webhook cannot grant twice.
  uniqueIndex("product_entitlements_order_product_uq").on(table.orderId, table.productId),
  index("product_entitlements_buyer_idx").on(table.buyerEmail),
]);

// A file a creator attaches to a product. `storage_key` is an opaque,
// server-generated identifier for the bytes in the storage backend; the original
// file name is kept only for display and is never used as a path, so a crafted
// name cannot escape the storage root.
export const productAssets = pgTable("product_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  contentType: varchar("content_type", { length: 128 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: varchar("storage_key", { length: 200 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps(),
}, (table) => [
  uniqueIndex("product_assets_storage_key_uq").on(table.storageKey),
  index("product_assets_product_sort_idx").on(table.productId, table.sortOrder),
]);

export const plugins = pgTable("plugins", {
  id: varchar("id", { length: 100 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description").notNull(),
  currentVersion: varchar("current_version", { length: 32 }).notNull(),
  source: varchar("source", { length: 20 }).notNull().default("first-party"),
  published: boolean("published").notNull().default(false),
  ...timestamps(),
});

export const pluginInstallations = pgTable("plugin_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  pluginId: varchar("plugin_id", { length: 100 }).notNull().references(() => plugins.id),
  version: varchar("version", { length: 32 }).notNull(),
  installed: boolean("installed").notNull().default(true),
  enabled: boolean("enabled").notNull().default(false),
  grantedPermissions: jsonb("granted_permissions").$type<string[]>().notNull().default([]),
  ...timestamps(),
}, (table) => [uniqueIndex("plugin_installations_creator_plugin_uq").on(table.creatorId, table.pluginId), index("plugin_installations_creator_idx").on(table.creatorId)]);

export const pluginSettings = pgTable("plugin_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  installationId: uuid("installation_id").notNull().references(() => pluginInstallations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
}, (table) => [uniqueIndex("plugin_settings_installation_uq").on(table.installationId)]);

export const pageBlocks = pgTable("page_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  pluginId: varchar("plugin_id", { length: 100 }).notNull().references(() => plugins.id),
  blockType: varchar("block_type", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps(),
}, (table) => [index("page_blocks_page_sort_idx").on(table.pageId, table.sortOrder)]);
