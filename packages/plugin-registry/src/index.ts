import { pluginManifestSchema, type PluginCatalog, type PluginManifest, type PluginPermission } from "@biova/shared/plugin";
import type { BiovaPlugin, ErasedPageBlockDefinition, PluginContext } from "@biova/plugin-sdk";

export interface PluginInstallationState {
  creatorId: string;
  pluginId: string;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
}

export interface PluginRegistry extends PluginCatalog {
  // The executable plugins, keyed by id. Only the host uses these: they carry
  // React components and lifecycle hooks that must never cross a server-function
  // boundary or reach the database directly.
  getPlugin(pluginId: string): BiovaPlugin | undefined;
  listPlugins(): BiovaPlugin[];
  pageBlocks(pluginId: string): ErasedPageBlockDefinition[];
  // The plugins a creator has installed and enabled. Kept as a pure function of
  // the installations passed in, so the registry stays free of database access.
  resolveEnabled(creatorId: string, installations: PluginInstallationState[]): BiovaPlugin[];
  // A running plugin's context: only the capabilities the creator actually
  // granted, never everything the manifest asked for.
  contextFor(creatorId: string, installation: PluginInstallationState): PluginContext;
}

// The registry is built once per process from the build-time allowlist. Every
// manifest is validated against the shared schema, so a malformed plugin fails
// at startup instead of at the first request.
export function createPluginRegistry(plugins: BiovaPlugin[]): PluginRegistry {
  const byId = new Map<string, BiovaPlugin>();
  const manifests = new Map<string, PluginManifest>();

  for (const plugin of plugins) {
    const parsed = pluginManifestSchema.safeParse(plugin.manifest);
    if (!parsed.success) {
      throw new Error(`Invalid manifest for plugin "${plugin.manifest?.id ?? "unknown"}": ${parsed.error.message}`);
    }
    if (byId.has(parsed.data.id)) throw new Error(`Duplicate plugin id: ${parsed.data.id}`);
    byId.set(parsed.data.id, plugin);
    manifests.set(parsed.data.id, parsed.data);
  }

  return {
    get(pluginId) { return manifests.get(pluginId); },
    list() { return [...manifests.values()]; },
    getPlugin(pluginId) { return byId.get(pluginId); },
    listPlugins() { return [...byId.values()]; },
    pageBlocks(pluginId) { return byId.get(pluginId)?.pageBlocks ?? []; },
    resolveEnabled(creatorId, installations) {
      const states = new Map(
        installations.filter((item) => item.creatorId === creatorId).map((item) => [item.pluginId, item]),
      );
      return [...byId.values()].filter((plugin) => {
        const state = states.get(plugin.manifest.id);
        return state?.installed === true && state.enabled === true;
      });
    },
    contextFor(creatorId, installation) {
      return createPluginContext({
        pluginId: installation.pluginId,
        creatorId,
        grantedPermissions: installation.grantedPermissions,
      });
    },
  };
}

export function createPluginContext(input: {
  pluginId: string;
  creatorId: string;
  grantedPermissions: PluginPermission[];
}): PluginContext {
  const permissions = new Set(input.grantedPermissions);
  return {
    pluginId: input.pluginId,
    creatorId: input.creatorId,
    grantedPermissions: permissions as ReadonlySet<PluginPermission>,
    hasPermission: (permission: PluginPermission) => permissions.has(permission),
  };
}
