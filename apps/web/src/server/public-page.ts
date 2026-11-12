import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServices, getPublicPage as readPublicPage, type BiovaServices } from "@biova/core";

// Loaded lazily so the client bundle never pulls in the database driver.
let servicesPromise: Promise<BiovaServices> | undefined;
function getServices(): Promise<BiovaServices> {
  servicesPromise ??= import("@biova/database").then(({ db }) => createServices(db));
  return servicesPromise;
}

// Server function: the public page loader runs on the server during SSR and via
// this function on client-side navigation, so it never imports the DB in the browser.
export const getPublicPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1).max(48) }))
  .handler(async ({ data }) => readPublicPage(await getServices(), data.slug));
