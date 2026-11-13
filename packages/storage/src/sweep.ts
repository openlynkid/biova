import { findOrphanKeys, type BlobStorage } from "./index";

export interface SweepResult {
  objects: number;
  referenced: number;
  orphans: string[];
  removed: number;
}

// Reconciles the store against every storage key any row still references.
// Callers pass the union of their repositories' keys, so a blob is only an
// orphan when nothing at all owns it. Reports by default; `delete: true` is the
// destructive form.
export async function sweepOrphans(
  storage: BlobStorage,
  referencedKeys: string[],
  options?: { delete?: boolean },
): Promise<SweepResult> {
  const storeKeys = await storage.list();
  const orphans = findOrphanKeys(storeKeys, referencedKeys);
  const result: SweepResult = {
    objects: storeKeys.length,
    referenced: referencedKeys.length,
    orphans,
    removed: 0,
  };
  if (!options?.delete) return result;
  for (const key of orphans) {
    await storage.remove(key);
    result.removed += 1;
  }
  return result;
}
