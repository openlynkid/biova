import { createPluginRegistry } from "@biova/plugin-registry";
import { socialLinksPlugin } from "@biova/plugin-social-links";
import { testimonialsPlugin } from "@biova/plugin-testimonials";

// Build-time allowlist: adding a package here requires a new build and
// deployment. The registry is the single source of the catalog for the whole
// web process, so the public page and the dashboard agree on what exists.
export const pluginRegistry = createPluginRegistry([socialLinksPlugin, testimonialsPlugin]);
