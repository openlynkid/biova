import type { OpenlynkPlugin, PluginPermission } from "@openlynk/plugin-sdk";

export interface PluginInstallationState {
  creatorId: string;
  pluginId: string;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: PluginPermission[];
}

export function createPluginRegistry(plugins: OpenlynkPlugin[]) {
  const byId = new Map<string, OpenlynkPlugin>();
  for (const plugin of plugins) {
    if (byId.has(plugin.manifest.id)) throw new Error(`Duplicate plugin id: ${plugin.manifest.id}`);
    byId.set(plugin.manifest.id, plugin);
  }

  return {
    get(pluginId: string) { return byId.get(pluginId); },
    list() { return [...byId.values()]; },
    resolveEnabled(creatorId: string, installations: PluginInstallationState[]) {
      const states = new Map(installations.filter((item) => item.creatorId === creatorId).map((item) => [item.pluginId, item]));
      return [...byId.values()].filter((plugin) => {
        const state = states.get(plugin.manifest.id);
        return state?.installed === true && state.enabled === true;
      });
    },
  };
}

export function createPluginContext(input: {
  pluginId: string;
  creatorId: string;
  grantedPermissions: PluginPermission[];
}) {
  const permissions = new Set(input.grantedPermissions);
  return {
    pluginId: input.pluginId,
    creatorId: input.creatorId,
    grantedPermissions: permissions as ReadonlySet<PluginPermission>,
    hasPermission: (permission: PluginPermission) => permissions.has(permission),
  };
}
