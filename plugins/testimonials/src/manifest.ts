import type { PluginManifest } from "@biova/shared/plugin";

// Kept apart from the component so a host that only needs the catalog (the API)
// can read the manifest without importing React.
export const testimonialsManifest: PluginManifest = {
  id: "testimonials",
  name: "Testimonials",
  version: "0.1.0",
  description: "Show a short set of quotes from customers or collaborators.",
  icon: "❝",
  compatibility: { sdk: "^0.1.0", core: "^0.1.0" },
  permissions: ["page:read", "page:write"],
  extensions: { pageBlocks: true, dashboard: true, api: false, events: false },
};
