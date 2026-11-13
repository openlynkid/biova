import { describe, expect, test } from "bun:test";
import { createPluginContext, createPluginRegistry } from "./index";
import type { BiovaPlugin } from "@biova/plugin-sdk";

const sample: BiovaPlugin = {
  manifest: {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    description: "test",
    compatibility: { sdk: "^0.1.0", core: "^0.1.0" },
    permissions: ["page:read"],
    extensions: {},
  },
};

const installation = (overrides: Partial<{ pluginId: string; creatorId: string; enabled: boolean }> = {}) => ({
  creatorId: overrides.creatorId ?? "creator-a",
  pluginId: overrides.pluginId ?? "sample",
  installed: true,
  enabled: overrides.enabled ?? true,
  grantedPermissions: ["page:read" as const],
});

describe("plugin registry", () => {
  test("registers, lists manifests and resolves only enabled creator installations", () => {
    const registry = createPluginRegistry([sample]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("sample")?.name).toBe("Sample");
    expect(registry.resolveEnabled("creator-a", [installation()])).toHaveLength(1);
    expect(registry.resolveEnabled("creator-b", [])).toHaveLength(0);
    expect(registry.resolveEnabled("creator-a", [installation({ enabled: false })])).toHaveLength(0);
  });

  test("rejects duplicate plugin identifiers", () => {
    expect(() => createPluginRegistry([sample, sample])).toThrow("Duplicate plugin id");
  });

  test("rejects a manifest that does not satisfy the shared schema", () => {
    const broken = { ...sample, manifest: { ...sample.manifest, version: "not-a-version" } } as BiovaPlugin;
    expect(() => createPluginRegistry([broken])).toThrow("Invalid manifest");
  });

  test("a context exposes only the granted permissions", () => {
    const context = createPluginContext({ pluginId: "sample", creatorId: "creator-a", grantedPermissions: ["page:read"] });
    expect(context.hasPermission("page:read")).toBe(true);
    expect(context.hasPermission("commerce:write")).toBe(false);
  });

  test("exposes page blocks per plugin", () => {
    const withBlock: BiovaPlugin = { ...sample, pageBlocks: [{ type: "sample", title: "S", description: "d", component: () => null }] };
    const registry = createPluginRegistry([withBlock]);
    expect(registry.pageBlocks("sample")).toHaveLength(1);
    expect(registry.pageBlocks("missing")).toHaveLength(0);
  });
});
