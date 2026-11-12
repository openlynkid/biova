import { describe, expect, test } from "bun:test";
import { createPluginRegistry } from "./index";
import type { OpenlynkPlugin } from "@openlynk/plugin-sdk";

const plugin: OpenlynkPlugin = { manifest: { id: "sample", name: "Sample", version: "1.0.0", description: "test", compatibility: { sdk: "^0.1.0", core: "^0.1.0" }, permissions: [], extensions: {} } };

describe("plugin registry", () => {
  test("registers and resolves only enabled creator installations", () => {
    const registry = createPluginRegistry([plugin]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.resolveEnabled("creator-a", [{ creatorId: "creator-a", pluginId: "sample", installed: true, enabled: true, grantedPermissions: [] }])).toHaveLength(1);
    expect(registry.resolveEnabled("creator-b", [])).toHaveLength(0);
  });
  test("rejects duplicate plugin identifiers", () => {
    expect(() => createPluginRegistry([plugin, plugin])).toThrow("Duplicate plugin id");
  });
});
