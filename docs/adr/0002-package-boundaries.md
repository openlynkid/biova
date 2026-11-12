# ADR-0002: Package boundaries

- Status: Accepted
- Date: 2026-11-12

## Rules

- `apps/*` may depend on `packages/*` and `plugins/*`.
- `packages/*` must not import from `apps/*`.
- `packages/plugin-sdk` is the public contract; plugin packages may depend on it but the SDK must not depend on concrete plugins.
- `packages/plugin-registry` may depend on the SDK but not on app route modules.
- Domain modules own their tables, repositories and service APIs.
- Cross-domain communication occurs through exported service interfaces or domain events.
- UI packages may depend on shared design tokens, not on database/server packages.
- Plugin UI components must not import server secrets, database clients or internal app modules.
