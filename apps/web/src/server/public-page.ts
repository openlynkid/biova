import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getPublicPage as readPublicPage, resolvePublishedCreatorId } from "@biova/core";
import { analyticsEventTypeSchema, visitorIdSchema } from "@biova/shared";
import { getServices } from "./services";
import { getSiteUrl } from "./site";

// Server function: the public page loader runs on the server during SSR and via
// this function on client-side navigation, so it never imports the DB in the browser.
// The site origin is attached here so the head tags can build absolute canonical
// and Open Graph URLs without the client having to read server-only env.
export const getPublicPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1).max(48) }))
  .handler(async ({ data }) => {
    const page = await readPublicPage(await getServices(), data.slug);
    return page ? { ...page, siteUrl: getSiteUrl() } : undefined;
  });

// Records one public analytics event. The creator is resolved from the published
// slug on the server, so the browser never sends a creator id; the payload is
// validated here and again in the analytics service. Always resolves, so a
// tracking failure never breaks the visitor's page.
export const trackPublicEvent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      slug: z.string().min(1).max(48),
      type: analyticsEventTypeSchema,
      visitorId: visitorIdSchema,
      path: z.string().trim().min(1).max(255).optional(),
      linkId: z.uuid().optional(),
      productId: z.uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const services = await getServices();
    const creatorId = await resolvePublishedCreatorId(services, data.slug);
    if (!creatorId) return { ok: false as const };
    const result = await services.analytics.track({
      creatorId,
      type: data.type,
      visitorId: data.visitorId,
      path: data.path,
      linkId: data.linkId,
      productId: data.productId,
    });
    return result.ok ? { ok: true as const } : { ok: false as const };
  });
