import { createFileRoute } from "@tanstack/react-router";
import type { BiovaServices } from "@biova/core";

// One service graph per server process, built lazily so the browser bundle never
// pulls in the database driver.
let servicesPromise: Promise<BiovaServices> | undefined;
function getServices(): Promise<BiovaServices> {
  servicesPromise ??= import("@biova/database").then(({ db }) =>
    import("@biova/core").then(({ createServices }) => createServices(db)),
  );
  return servicesPromise;
}

// Signed download endpoint. The token is the only credential: it names the
// entitlement and asset and carries an HMAC, so the route needs no session and
// the underlying storage key never appears in the URL.
export const Route = createFileRoute("/download/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const services = await getServices();
        const result = await services.delivery.openDownload(params.token);
        if (!result.ok) {
          const status = result.error === "invalid_token" ? 401 : 404;
          return new Response(JSON.stringify({ error: result.error }), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
        const bytes = new Uint8Array(result.value.data.byteLength);
        bytes.set(result.value.data);
        return new Response(new Blob([bytes]), {
          headers: {
            "content-type": result.value.contentType,
            "content-disposition": `attachment; filename="${encodeURIComponent(result.value.fileName)}"`,
          },
        });
      },
    },
  },
});
