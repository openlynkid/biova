# ADR-0014: Hybrid plugin system

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 5 (Plugin Ecosystem) lists five deliverables: a plugin SDK, first-party
plugins, runtime activation, permission management and an external plugin
isolation architecture. PRD 9 splits the work the same way: a build-time half
(allowlist, SDK, registry of manifests and capabilities) and a runtime half
(per-creator activation, stored configuration and permissions, and a registry
that checks both before a capability runs).

Before this change the pieces disagreed. `@biova/plugin-sdk` and
`@biova/plugin-registry` each defined their own manifest shape, the web app held
a hardcoded plugin list, and nothing read the `plugins`,
`plugin_installations`, `plugin_settings` or `page_blocks` tables that already
existed in the schema. A plugin could not be installed, enabled, granted a
permission or asked to render anything.

The security rules in PRD 9 are the reason the naive "just import the plugin
package everywhere" version is wrong:

- Plugin UI must not reach the database or a secret.
- A plugin must not bypass a domain service.
- An external marketplace plugin must not run arbitrary code in the main Bun
  process; it needs a sandbox or an isolated service.
- Permissions must be explicit, minimal and revocable.

## Decision

### One contract, owned by `@biova/shared`

`PluginManifest`, `PluginPermission` and `PluginExtensions` are zod schemas in
`packages/shared/src/plugin.ts`, exported as `@biova/shared/plugin`. The SDK
re-exports those types and adds only what needs React: the block component and
the plugin's executable shape. The registry validates every manifest against the
same schema. There is now one definition of "what a plugin is" and the host, the
API and every plugin import it from the same place.

Settings and block configs are typed as a JSON value union rather than
`unknown`. That is not cosmetic: the values cross the server-function boundary,
and the serializable subset is what keeps a plugin from storing something the
transport cannot carry.

### The catalog is a port, not a dependency

The plugin domain (`@biova/plugins`) never imports a plugin package or a UI
framework. It reads the build-time allowlist through a `PluginCatalog` port
(`get`, `list`). The web app builds the real registry in
`apps/web/src/plugins.ts` and passes it to `createServices`; the API and tests
pass a catalog of manifests or nothing at all. This is what keeps the domain
buildable in the API process, where importing React would be wrong.

The allowlist is a build-time decision. Adding a plugin is a new import and a new
deployment, never a runtime download.

### Runtime state is per creator, and off by default

Installation lives in `plugin_installations` (unique on creator + plugin). An
install creates the row with `installed = true`, `enabled = false` and
`grantedPermissions = []`. Enabling and granting are separate, explicit calls.
That ordering is deliberate: installing a plugin must never change a live page,
and a plugin must never receive a capability it did not declare. A grant can
narrow the manifest's request but never widen it — asking for a permission the
manifest does not list is rejected with `permission_not_declared`.

### Blocks are data, and the host decides what runs

A page block is a row (`plugin_id`, `block_type`, `config`, `sort_order`,
`enabled`). The stored row names a plugin and a block type, never a component.
The host maps that pair to code through the registry
(`apps/web/src/plugin-blocks.tsx`); an unknown plugin or type renders nothing, so
a stored config can never choose which code executes. The config is validated
against the block's own `validateConfig` before render, so a config written by an
older plugin version degrades to "not rendered" instead of throwing.

The public read model (`listPublicBlocks`) is filtered in SQL to blocks whose
plugin the creator has installed *and* enabled. Disabling a plugin takes its
blocks off the page without deleting them.

### Isolation boundaries, enforced and reserved

- The `PluginContext` a running plugin receives carries only `pluginId`,
  `creatorId` and the granted permission set. No database handle, no secret, no
  HTTP client. Platform data is reachable only through the host, and only with
  the matching permission.
- Block components render for anonymous visitors and are handed no creator
  identity, so a block cannot use the public page to read creator-scoped data.
- Every block operation is scoped by the creator id from the session, and
  reordering only accepts ids the creator can already see.
- First-party plugins are reviewed and shipped in the allowlist. External
  plugins are **not** loaded into the Bun process. `ExternalPluginHost` in
  `@biova/plugin-sdk` records the intended shape — a signed artifact run in a
  sandbox or isolated service that talks back over capability-scoped calls — as
  an interface with no in-process implementation. The default is to refuse to
  run an external plugin rather than to run it in-process.

## Consequences

- The API gains `/v1/plugins*` and `/v1/blocks*` endpoints; the dashboard gains a
  plugins panel and a page-block editor; the public page renders enabled blocks.
- `@biova/plugins` is a domain package with a repository and service returning
  `Result`, matching the other domains. `BiovaServices` exposes `plugins`.
- No migration is needed: `plugins`, `plugin_installations`, `plugin_settings`
  and `page_blocks` already existed.
- External plugin execution stays out of scope until the isolation service
  exists. The interface and the rule are recorded here so the next phase does
  not accidentally run untrusted code in-process.
