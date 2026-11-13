import type { ComponentType } from "react";
import type { PluginExtensions, PluginManifest, PluginPermission } from "@biova/shared/plugin";

// The manifest and permission types are owned by @biova/shared, so the host, the
// API and every plugin agree on one definition. This module adds only the pieces
// that need React: the block component and the plugin's executable shape.
export type { PluginExtensions, PluginManifest, PluginPermission };

export interface PageBlockProps<TConfig = unknown> {
  // Public blocks render for anonymous visitors, so they are handed no creator
  // identity: a block that needs creator-scoped data must go through the host.
  creatorId?: string;
  config: TConfig;
  preview?: boolean;
}

export interface PageBlockDefinition<TConfig = unknown> {
  type: string;
  title: string;
  description: string;
  component: ComponentType<PageBlockProps<TConfig>>;
  validateConfig?: (value: unknown) => TConfig;
}

// The registry stores blocks from many plugins together, so each definition's
// config type is erased here. Authors keep the concrete type via the generic
// above; the erasure boundary is where `any` is justified.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErasedPageBlockDefinition = PageBlockDefinition<any>;

// What a running plugin is handed. It carries no database handle, no secret and
// no HTTP client: a plugin reaches platform data only through the host, and only
// when it holds the matching permission. See ADR-0014.
export interface PluginContext {
  readonly pluginId: string;
  readonly creatorId: string;
  readonly grantedPermissions: ReadonlySet<PluginPermission>;
  hasPermission(permission: PluginPermission): boolean;
}

export interface BiovaPlugin {
  manifest: PluginManifest;
  pageBlocks?: ErasedPageBlockDefinition[];
  activate?(context: PluginContext): Promise<void> | void;
  deactivate?(context: PluginContext): Promise<void> | void;
}

// Reserved for the external marketplace. An external plugin is not an in-process
// module: it is a signed artifact the host runs in a sandbox or an isolated
// service and reaches only through capability-scoped calls. There is no
// in-process implementation on purpose — the host must refuse to run an external
// plugin rather than fall back to importing its code. See ADR-0014.
export interface ExternalPluginHost {
  readonly kind: "sandbox" | "isolated-service";
  load(pluginId: string, context: PluginContext): Promise<void>;
  unload(pluginId: string): Promise<void>;
}
