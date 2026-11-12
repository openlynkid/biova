import type { BiovaPlugin, PageBlockProps } from "@biova/plugin-sdk";

type SocialLink = { label: string; url: string };
function SocialLinksBlock({ config }: PageBlockProps<{ links: SocialLink[] }>) {
  return <div className="social-links-block">{config.links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>)}</div>;
}

export const socialLinksPlugin: BiovaPlugin = {
  manifest: {
    id: "social-links",
    name: "Social Links",
    version: "0.1.0",
    description: "Add a clean collection of social and destination links to a creator page.",
    icon: "↗",
    compatibility: { sdk: "^0.1.0", core: "^0.1.0" },
    permissions: ["page:read", "page:write"],
    extensions: { pageBlocks: true, dashboard: true, api: false, events: false },
  },
  pageBlocks: [{
    type: "social-links",
    title: "Social links",
    description: "A list of external destinations.",
    component: SocialLinksBlock,
    validateConfig(value) {
      if (!value || typeof value !== "object" || !Array.isArray((value as { links?: unknown }).links)) {
        throw new Error("Social Links config must contain a links array");
      }
      return value as { links: SocialLink[] };
    },
  }],
};
