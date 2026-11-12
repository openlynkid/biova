import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creators = pgTable("creators", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 48 }).notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  bio: varchar("bio", { length: 500 }),
  ...timestamps(),
}, (table) => [uniqueIndex("creators_slug_uq").on(table.slug), index("creators_user_id_idx").on(table.userId)]);

export const pages = pgTable("pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps(),
}, (table) => [index("pages_creator_id_idx").on(table.creatorId)]);

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
  pluginId: varchar("plugin_id", { length: 100 }).notNull(),
  blockType: varchar("block_type", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps(),
}, (table) => [index("page_blocks_page_sort_idx").on(table.pageId, table.sortOrder)]);
