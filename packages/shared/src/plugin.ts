import { z } from "zod";

// Capabilities a plugin may ask for. A closed set, so a manifest cannot invent a
// permission the host does not understand, and a grant can be checked by name.
export const PLUGIN_PERMISSIONS = [
  "page:read",
  "page:write",
  "profile:read",
  "profile:write",
  "commerce:read",
  "commerce:write",
  "analytics:read",
] as const;

export const pluginPermissionSchema = z.enum(PLUGIN_PERMISSIONS);
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;

// Which surfaces a plugin extends. A plugin with no extension is inert, so the
// host can skip loading it entirely.
export const pluginExtensionsSchema = z.object({
  pageBlocks: z.boolean().optional(),
  dashboard: z.boolean().optional(),
  api: z.boolean().optional(),
  events: z.boolean().optional(),
});
export type PluginExtensions = z.infer<typeof pluginExtensionsSchema>;

// Plugin ids appear in URLs and in database rows, so they use the same character
// set as a slug and are never derived from a display name.
export const pluginIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "use lowercase letters, numbers and single hyphens");

// The serializable half of a plugin: everything the host can reason about
// without importing the plugin's code. React components live in the plugin
// package, not here, so the API and the domain never pull a UI framework in.
export const pluginManifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(120),
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "use a semantic version like 1.2.3"),
  description: z.string().trim().min(1).max(500),
  icon: z.string().trim().min(1).max(32).optional(),
  // Version ranges the plugin is built against, checked against the host.
  compatibility: z.object({
    sdk: z.string().trim().min(1).max(40),
    core: z.string().trim().min(1).max(40),
  }),
  permissions: z.array(pluginPermissionSchema).max(PLUGIN_PERMISSIONS.length),
  extensions: pluginExtensionsSchema,
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

// Per-creator state for one plugin. `grantedPermissions` is the subset of the
// manifest's requested permissions the creator has actually approved, so a
// plugin never receives a capability it did not declare.
export interface PluginInstallation {
  creatorId: string;
  pluginId: string;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
}

// Settings and block configs are opaque JSON, but they cross the server-function
// boundary, so the type is the serializable JSON subset rather than `unknown`.
// That keeps a plugin from storing a value the transport cannot carry.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type PluginSettings = { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

// The host's read-only view of the plugins it is allowed to run. Built at
// build-time from the allowlist (ADR-0014); the domain depends on this port, not
// on the plugin packages themselves.
export interface PluginCatalog {
  get(pluginId: string): PluginManifest | undefined;
  list(): PluginManifest[];
}

export const pluginSettingsSchema = z.record(z.string(), jsonValueSchema);

export const installPluginSchema = z.object({ pluginId: pluginIdSchema });
export const setPluginEnabledSchema = z.object({ pluginId: pluginIdSchema, enabled: z.boolean() });
export const setPluginPermissionSchema = z.object({ pluginId: pluginIdSchema, permission: pluginPermissionSchema });
