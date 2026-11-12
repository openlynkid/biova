import { createPluginRegistry, type PluginInstallationState } from "@openlynk/plugin-registry";
import { socialLinksPlugin } from "@openlynk/plugin-social-links";

// Build-time allowlist: adding a package here requires a new build/deployment.
export const pluginRegistry = createPluginRegistry([socialLinksPlugin]);

// Demo-only runtime state. Replace with a server-side database query scoped to
// the authenticated creator. Never trust a creatorId supplied by the browser.
const demoInstallations: PluginInstallationState[] = [
  {
    creatorId: "demo-creator",
    pluginId: "social-links",
    installed: true,
    enabled: true,
    grantedPermissions: ["page:read", "page:write"],
  },
];

export function getEnabledPlugins(creatorId: string) {
  return pluginRegistry.resolveEnabled(creatorId, demoInstallations);
}
