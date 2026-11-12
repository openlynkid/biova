import type { ComponentType } from "react";

export type PluginPermission =
  | "page:read" | "page:write"
  | "profile:read" | "profile:write"
  | "commerce:read" | "commerce:write"
  | "analytics:read";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  compatibility: { sdk: string; core: string };
  permissions: PluginPermission[];
  extensions: { pageBlocks?: boolean; dashboard?: boolean; api?: boolean; events?: boolean };
}

export interface PageBlockProps<TConfig = unknown> {
  creatorId: string;
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

export interface PluginContext {
  readonly pluginId: string;
  readonly creatorId: string;
  readonly grantedPermissions: ReadonlySet<PluginPermission>;
  hasPermission(permission: PluginPermission): boolean;
}

export interface OpenlynkPlugin {
  manifest: PluginManifest;
  pageBlocks?: ErasedPageBlockDefinition[];
  activate?(context: PluginContext): Promise<void> | void;
  deactivate?(context: PluginContext): Promise<void> | void;
}
