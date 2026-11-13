import type { PluginManifest } from "@biova/shared/plugin";

// Kept apart from the component so a host that only needs the catalog (the API)
// can read the manifest without importing React.
export const socialLinksManifest: PluginManifest = {
  id: "social-links",
  name: "Social Links",
  version: "0.1.0",
  description: "Add a clean collection of social and destination links to a creator page.",
  icon: "↗",
  compatibility: { sdk: "^0.1.0", core: "^0.1.0" },
  permissions: ["page:read", "page:write"],
  extensions: { pageBlocks: true, dashboard: true, api: false, events: false },
};
