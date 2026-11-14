import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolvePublishedCreatorId } from "@biova/core";
import { getServices } from "../server/services";

// Public product thumbnail. Served only when the creator's page is published
// AND the product itself is published and owned by that creator, so a draft
// product's image never leaks. The path carries a static `product` segment so it
// cannot collide with a branding slot (`/media/:slug/:kind`). The bytes are
// public by design, so the response is cached hard; the URL carries a version
// so replacing the image changes the URL and the cache entry.
const productIdSchema = z.uuid();

export const Route = createFileRoute("/media/$slug/product/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = productIdSchema.safeParse(params.id);
        if (!id.success) return new Response(null, { status: 404 });

        const services = await getServices();
        const creatorId = await resolvePublishedCreatorId(services, params.slug);
        if (!creatorId) return new Response(null, { status: 404 });

        const product = await services.products.findPublished(creatorId, id.data);
        if (!product) return new Response(null, { status: 404 });

        const thumbnail = await services.thumbnails.open(creatorId, id.data);
        if (!thumbnail) return new Response(null, { status: 404 });

        const bytes = new Uint8Array(thumbnail.data.byteLength);
        bytes.set(thumbnail.data);
        return new Response(new Blob([bytes]), {
          headers: {
            "content-type": thumbnail.contentType,
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
