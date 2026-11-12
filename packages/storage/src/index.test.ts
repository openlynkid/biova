import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage, type BlobStorage } from "./index";

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
});
