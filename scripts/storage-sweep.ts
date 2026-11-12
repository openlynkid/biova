// Reconciles the blob store against the rows that are supposed to own the
// bytes. Deleting a product or a creator cascades `product_assets` rows but
// leaves the files behind, so over time the store accumulates blobs nothing can
// reach. This reports them, and with --delete removes them.
//
// Run with: bun run storage:sweep [--delete]
//
// Dry-run is the default on purpose: a destructive reconciliation should be
// asked for, not assumed.
import { closeDatabase, db } from "@biova/database";
import { createAssetRepository, sweepOrphanedAssets } from "@biova/products";
import { createBlobStorage, resolveStorageRoot } from "@biova/core";
import { readEnv } from "@biova/shared";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: bun run storage:sweep [--delete]\n\n  Reports blobs no product_assets row references. Pass --delete to remove them.");
    return;
  }

  const root = resolveStorageRoot(readEnv("STORAGE_DIR") ?? ".storage");
  const result = await sweepOrphanedAssets(createBlobStorage(), createAssetRepository(db), {
    delete: args.includes("--delete"),
  });

  console.log(`storage root: ${root}`);
  console.log(`objects: ${result.objects}   referenced: ${result.referenced}   orphaned: ${result.orphans.length}`);

  if (result.orphans.length === 0) {
    console.log("nothing to do.");
    return;
  }

  for (const key of result.orphans) console.log(result.removed > 0 ? `  removed ${key}` : `  orphan  ${key}`);
  if (result.removed === 0) console.log("\ndry run: re-run with --delete to remove these files.");
}

try {
  await main();
} finally {
  await closeDatabase();
}
