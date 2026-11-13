import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage, findOrphanKeys, type BlobStorage } from "./index";
import { sweepOrphans } from "./sweep";

let root: string;
let storage: BlobStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "biova-storage-"));
  storage = createLocalStorage({ root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe("local storage", () => {
  test("stores bytes under a generated key and reads them back", async () => {
    const stored = await storage.put({ data: bytes("hello biova"), contentType: "text/plain", fileName: "notes.txt" });
    expect(stored.key).toMatch(/^[a-z0-9]{2}\/[a-f0-9]{32}\.txt$/);
    expect(stored.sizeBytes).toBe(11);

    const data = await storage.get(stored.key);
    expect(data).toBeDefined();
    expect(new TextDecoder().decode(data)).toBe("hello biova");
  });

  test("keeps the extension but never the original name", async () => {
    const stored = await storage.put({ data: bytes("x"), contentType: "application/pdf", fileName: "../../etc/passwd.pdf" });
    expect(stored.key).not.toContain("passwd");
    expect(stored.key.endsWith(".pdf")).toBe(true);
  });

  test("writes the object inside the storage root", async () => {
    const stored = await storage.put({ data: bytes("payload"), contentType: "text/plain", fileName: "a.txt" });
    const onDisk = await readFile(join(root, stored.key));
    expect(new TextDecoder().decode(onDisk)).toBe("payload");
  });

  test("rejects a key that tries to escape the root", async () => {
    expect(await storage.get("../secrets.txt")).toBeUndefined();
    expect(await storage.get("/etc/passwd")).toBeUndefined();
    expect(await storage.get("aa/../../etc/passwd")).toBeUndefined();
  });

  test("refuses a write above the configured cap", async () => {
    const small = createLocalStorage({ root, maxBytes: 4 });
    await expect(small.put({ data: bytes("12345"), contentType: "text/plain", fileName: "big.txt" })).rejects.toThrow("asset_too_large");
  });

  test("remove deletes the object and is idempotent", async () => {
    const stored = await storage.put({ data: bytes("bye"), contentType: "text/plain", fileName: "b.txt" });
    await storage.remove(stored.key);
    expect(await storage.get(stored.key)).toBeUndefined();
    await storage.remove(stored.key);
  });

  test("lists the keys it holds", async () => {
    expect(await storage.list()).toEqual([]);
    const a = await storage.put({ data: bytes("a"), contentType: "text/plain", fileName: "a.txt" });
    const b = await storage.put({ data: bytes("b"), contentType: "text/plain", fileName: "b.pdf" });
    expect((await storage.list()).sort()).toEqual([a.key, b.key].sort());
  });

  test("list ignores files that are not valid keys", async () => {
    const stored = await storage.put({ data: bytes("x"), contentType: "text/plain", fileName: "x.txt" });
    await writeFile(join(root, "stray.txt"), "not a key");
    expect(await storage.list()).toEqual([stored.key]);
  });
});

describe("findOrphanKeys", () => {
  test("returns store keys no row references, sorted", () => {
    const store = ["bb/22222222222222222222222222222222.txt", "aa/11111111111111111111111111111111.txt"];
    expect(findOrphanKeys(store, [store[0]])).toEqual([store[1]]);
  });

  test("returns nothing when every stored key is referenced", () => {
    const store = ["aa/11111111111111111111111111111111.txt"];
    expect(findOrphanKeys(store, store)).toEqual([]);
  });

  test("returns nothing for an empty store", () => {
    expect(findOrphanKeys([], ["aa/11111111111111111111111111111111.txt"])).toEqual([]);
  });
});

describe("sweepOrphans", () => {
  test("reports orphans without deleting by default", async () => {
    const kept = await storage.put({ data: bytes("kept"), contentType: "text/plain", fileName: "k.txt" });
    await storage.put({ data: bytes("orphan"), contentType: "text/plain", fileName: "o.txt" });
    const result = await sweepOrphans(storage, [kept.key]);
    expect(result.orphans).toHaveLength(1);
    expect(result.removed).toBe(0);
    expect(await storage.list()).toHaveLength(2);
  });

  test("removes orphans when delete is set", async () => {
    const kept = await storage.put({ data: bytes("kept"), contentType: "text/plain", fileName: "k.txt" });
    const orphan = await storage.put({ data: bytes("orphan"), contentType: "text/plain", fileName: "o.txt" });
    const result = await sweepOrphans(storage, [kept.key], { delete: true });
    expect(result.orphans).toEqual([orphan.key]);
    expect(result.removed).toBe(1);
    expect(await storage.list()).toEqual([kept.key]);
  });
});
