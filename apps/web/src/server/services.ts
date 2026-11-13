import { createServices, type BiovaServices } from "@biova/core";

// One service graph per server process, built lazily so the browser bundle never
// pulls in the database driver.
let servicesPromise: Promise<BiovaServices> | undefined;

export function getServices(): Promise<BiovaServices> {
  servicesPromise ??= import("@biova/database").then(({ db }) => createServices(db));
  return servicesPromise;
}
