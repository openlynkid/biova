// Reconciles the blob store against the rows that are supposed to own the
// bytes. Deleting a product or a creator cascades the rows that reference a blob
// but leaves the file behind, so over time the store accumulates blobs nothing
// can reach. This reports them, and with --delete removes them.
//
// Run with: bun run storage:sweep [--delete]
//
// Dry-run is the default on purpose: a destructive reconciliation should be
// asked for, not assumed.
import { closeDatabase, db } from "@biova/database";
import { createAssetRepository, createThumbnailRepository } from "@biova/products";
import { createMediaRepository } from "@biova/media";
import { createBlobStorage, resolveStorageRoot } from "@biova/core";
import { sweepOrphans } from "@biova/storage";
import { readEnv } from "@biova/shared";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: bun run storage:sweep [--delete]\n\n  Reports blobs no row references. Pass --delete to remove them.");
    return;
  }

  const root = resolveStorageRoot(readEnv("STORAGE_DIR") ?? ".storage");
  // Every key any row still references: product assets, product thumbnails and
  // creator branding. A blob is only an orphan when nothing at all owns it.
  const referenced = [
    ...(await createAssetRepository(db).listStorageKeys()),
    ...(await createThumbnailRepository(db).listStorageKeys()),
    ...(await createMediaRepository(db).listStorageKeys()),
  ];
  const result = await sweepOrphans(createBlobStorage(), referenced, {
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
