import type { Database } from "@biova/database/types";
import {
  createCreatorRepository,
  createCreatorService,
  type Creator,
  type CreatorService,
} from "@biova/creator";
import { createLinkRepository, createLinkService, type Link, type LinkService } from "@biova/links";
import { createPageRepository, createPageService, type PageService } from "@biova/page";
import { pageThemeSchema, type PageTheme } from "@biova/shared";

export interface BiovaServices {
  creators: CreatorService;
  pages: PageService;
  links: LinkService;
}

// Composition root: the web app and the API both build their services here so
// they share one set of domain rules. Only this module knows how the domains
// are wired together.
export function createServices(db: Database): BiovaServices {
  const creatorRepository = createCreatorRepository(db);
  const linkRepository = createLinkRepository(db);
  const pageRepository = createPageRepository(db);

  const links = createLinkService(linkRepository);
  const pages = createPageService(pageRepository, (creatorId) => links.hasEnabledLink(creatorId));
  const creators = createCreatorService(creatorRepository);

  return { creators, pages, links };
}

export interface PublicPage {
  creator: Pick<Creator, "slug" | "displayName" | "bio">;
  page: { title: string; theme: PageTheme; publishedAt: Date | null };
  links: Pick<Link, "id" | "title" | "url" | "description" | "icon">[];
}

// Read model for the public page. Returns undefined unless the creator exists
// and their page is published, so drafts never leak to visitors.
export async function getPublicPage(services: BiovaServices, slug: string): Promise<PublicPage | undefined> {
  const creator = await services.creators.getBySlug(slug);
  if (!creator) return undefined;

  const page = await services.pages.getByCreatorId(creator.id);
  if (!page || page.status !== "published") return undefined;

  const links = await services.links.list(creator.id);

  // Stored theme may predate the current schema; ignore unknown keys rather than
  // failing the page, and only expose the values the renderer understands.
  const theme = pageThemeSchema.safeParse(page.theme);

  return {
    creator: { slug: creator.slug, displayName: creator.displayName, bio: creator.bio },
    page: { title: page.title, theme: theme.success ? theme.data : {}, publishedAt: page.publishedAt },
    links: links
      .filter((link) => link.enabled)
      .map(({ id, title, url, description, icon }) => ({ id, title, url, description, icon })),
  };
}
