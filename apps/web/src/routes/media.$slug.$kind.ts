import { createFileRoute } from "@tanstack/react-router";
import { resolvePublishedCreatorId } from "@biova/core";
import { mediaKindSchema } from "@biova/shared";
import { getServices } from "../server/services";

// Public branding images (avatar, cover). Only served for a creator whose page
// is published, so a draft page's branding never leaks. The bytes are public by
// design, so the response is cached hard; the URL carries a version so replacing
// the image changes the URL and the cache entry.
export const Route = createFileRoute("/media/$slug/$kind")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const kind = mediaKindSchema.safeParse(params.kind);
        if (!kind.success) return new Response(null, { status: 404 });

        const services = await getServices();
        const creatorId = await resolvePublishedCreatorId(services, params.slug);
        if (!creatorId) return new Response(null, { status: 404 });

        const asset = await services.media.open(creatorId, kind.data);
        if (!asset) return new Response(null, { status: 404 });

        const bytes = new Uint8Array(asset.data.byteLength);
        bytes.set(asset.data);
        return new Response(new Blob([bytes]), {
          headers: {
            "content-type": asset.contentType,
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
