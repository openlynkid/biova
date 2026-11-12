import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { MAX_ASSET_BYTES } from "@biova/shared";

// Where a stored file lives. `key` is opaque to callers: they receive it from
// `put` and hand it back to `get`/`remove`. The driver decides what the key
// means, so a future S3 driver can key on the object name instead of a path.
export interface StoredObject {
  key: string;
  sizeBytes: number;
}

export interface PutObjectInput {
  data: Uint8Array;
  contentType: string;
  // Only the extension is taken from this; the name itself is never a path.
  fileName: string;
}

export interface BlobStorage {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | undefined>;
  remove(key: string): Promise<void>;
  // Every key the store holds, used by the orphan sweep to compare the store
  // against the rows that are supposed to own the bytes.
  list(): Promise<string[]>;
}

export type StorageError = "too_large" | "invalid_input";

// Local filesystem driver. Every key is generated here as
// `<shard>/<random><ext>`, so a caller can never choose the path. Keys are
// validated on the way in and resolved against the root on the way out, which
// keeps `..` and absolute paths from escaping the storage directory.
export function createLocalStorage(options: { root: string; maxBytes?: number }): BlobStorage {
  const root = resolve(options.root);
  const maxBytes = options.maxBytes ?? MAX_ASSET_BYTES;

  function resolveKey(key: string): string | null {
    // Reject anything that is not a plain relative key, then confirm the
    // resolved path is still inside the root.
    if (!/^[a-z0-9]{2}\/[a-f0-9]{32}(?:\.[a-z0-9]{1,8})?$/.test(key)) return null;
    const full = resolve(root, key);
    if (full !== root && !full.startsWith(root + sep)) return null;
    return full;
  }

  return {
    async put(input) {
      // Defence in depth: the service checks the size first, but the driver
      // refuses an oversized write too, so a direct caller cannot bypass it.
      if (input.data.byteLength > maxBytes) throw new Error("asset_too_large");
      const extension = extensionOf(input.fileName);
      const shard = randomBytes(1).toString("hex");
      const key = `${shard}/${randomBytes(16).toString("hex")}${extension}`;
      const full = join(root, key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, input.data);
      return { key, sizeBytes: input.data.byteLength };
    },

    async get(key) {
      const full = resolveKey(key);
      if (!full) return undefined;
      try {
        return await readFile(full);
      } catch {
        return undefined;
      }
    },

    async remove(key) {
      const full = resolveKey(key);
      if (!full) return;
      await rm(full, { force: true });
    },

    async list() {
      // The store holds exactly one level of shard directories. Anything that
      // does not match the key shape is ignored rather than reported, so a stray
      // editor backup or .DS_Store is never handed to the sweep as a key.
      let shards;
      try {
        shards = await readdir(root, { withFileTypes: true });
      } catch {
        return [];
      }
      const keys: string[] = [];
      for (const shard of shards) {
        if (!shard.isDirectory()) continue;
        const entries = await readdir(join(root, shard.name), { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const key = `${shard.name}/${entry.name}`;
          if (resolveKey(key)) keys.push(key);
        }
      }
      return keys;
    },
  };
}

// Keep a short, safe extension so a downloaded file still opens with the right
// application, while everything else about the name is discarded.
function extensionOf(fileName: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName.trim());
  return match ? `.${match[1].toLowerCase()}` : "";
}

// Keys the store holds that no row references. Pure so the sweep's decision can
// be tested without a filesystem or a database: the caller supplies both sides.
export function findOrphanKeys(storeKeys: string[], referencedKeys: Iterable<string>): string[] {
  const referenced = new Set(referencedKeys);
  return storeKeys.filter((key) => !referenced.has(key)).sort();
}
