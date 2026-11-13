import { pluginRegistry } from "./plugins";
import type { PluginSettings } from "@biova/shared/plugin";

// A block row names a plugin and a block type, not a component. The host is the
// only place that maps the two, so a stored config can never choose which code
// runs: an unknown plugin or type simply renders nothing.
export function PluginBlocks({ blocks }: { blocks: { id: string; pluginId: string; blockType: string; config: PluginSettings }[] }) {
  if (blocks.length === 0) return null;
  return (
    <section className="block-list" aria-label="Page blocks">
      {blocks.map((block) => {
        const definition = pluginRegistry.pageBlocks(block.pluginId).find((item) => item.type === block.blockType);
        if (!definition) return null;
        // Validate before render: a config written by an older plugin version may
        // not match the current shape, and the page must not throw for it.
        const config = definition.validateConfig ? safeValidate(definition.validateConfig, block.config) : block.config;
        if (config === undefined) return null;
        const Component = definition.component;
        return <Component key={block.id} config={config} />;
      })}
    </section>
  );
}

function safeValidate<T>(validate: (value: unknown) => T, value: unknown): T | undefined {
  try {
    return validate(value);
  } catch {
    return undefined;
  }
}
