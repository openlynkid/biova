# ADR-0001: Openlynk platform architecture

- Status: Accepted
- Date: 2026-11-12

## Context

Openlynk is a creator link-in-bio and commerce platform. Creators compose a public mini-site from platform primitives and optional plugins. The platform must support first-party plugins initially and a reviewed third-party ecosystem later. The selected runtime is Bun, not Node.js.

## Decisions

1. **Runtime/toolchain:** Bun 1.4.4 is the application runtime and package manager. TypeScript is the implementation language. Node.js is not the intended production runtime.
2. **Web framework:** TanStack Start 1.0+ with React for SSR, routing and creator-facing web experiences.
3. **API framework:** Elysia 1.4.x for HTTP APIs. It is an adapter/transport layer; business logic lives in framework-independent domain packages.
4. **Backend shape:** Modular monolith. Domain modules have explicit public interfaces. No cross-module database table access from application modules.
5. **Monorepo:** Bun workspaces plus Turborepo for task orchestration and caching.
6. **Persistence:** PostgreSQL with Drizzle ORM and postgres.js. Tenant-owned rows carry `creatorId`/tenant scope and are authorized in server-side services.
7. **Plugin execution:** Hybrid. Approved first-party plugins are imported at build time. Per-creator installation, activation, settings and permissions are resolved at runtime from persistent state.
8. **Third-party plugins:** Future external plugins must not execute arbitrary code in the host process. They require review, signed artifacts, sandbox/isolated execution, capability-scoped APIs, quotas and audit trails.

## Consequences

- Runtime activation can turn already-built plugin capabilities on/off without rebuilding the application.
- Adding a new plugin package or its server-side code requires a build and deployment.
- The public page renderer must use a stable block manifest and gracefully handle unknown/disabled blocks.
- Plugin migrations require explicit versioning, compatibility checks and rollback strategy.
- Elysia can be split into a separate service or colocated with the web app without changing domain services.
- Bun compatibility must be verified for every dependency and deployment target.

## Rejected alternatives

- **Next.js as the primary framework:** rejected for this Bun-only requirement because the project wants a Bun-native framework/runtime path rather than relying on Node.js as the supported production server runtime.
- **Microservices from day one:** rejected due to operational overhead and premature distributed-systems complexity.
- **Runtime loading arbitrary plugin bundles:** rejected due to code execution, supply-chain and isolation risks.
