import type { BiovaPlugin, PageBlockProps } from "@biova/plugin-sdk";
import { socialLinksManifest } from "./manifest";

type SocialLink = { label: string; url: string };

function SocialLinksBlock({ config }: PageBlockProps<{ links: SocialLink[] }>) {
  return (
    <div className="social-links-block">
      {config.links.map((link) => (
        <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer nofollow">
          {link.label} ↗
        </a>
      ))}
    </div>
  );
}

export const socialLinksPlugin: BiovaPlugin = {
  manifest: socialLinksManifest,
  pageBlocks: [
    {
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
    },
  ],
};
