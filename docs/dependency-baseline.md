# Dependency baseline (2026-11-12)

| Package | Pinned baseline | Notes |
|---|---:|---|
| Bun | 1.4.4 | Runtime + package manager |
| @tanstack/react-start | 1.169.5 | TanStack Start stable line |
| @tanstack/react-router | 1.170.46 | Pinned to the version `@tanstack/react-start` 1.169.5 depends on; `1.169.5` was never published for this package |
| Elysia | 1.4.30 | Stable 1.x; do not adopt 2.x beta/RC in foundation |
| React / React DOM | 19.3.0 | Stable React line |
| TypeScript | 5.9.3 | Conservative ecosystem compatibility; evaluate TS 7 separately |
| Vite | 8.3.8 | Paired with `@vitejs/plugin-react` 6.x |
| Tailwind CSS | 4.3.5 | Tailwind v4 |
| Drizzle ORM | 0.45.4 | Stable line, avoid RC for production foundation |
| drizzle-kit | 0.31.11 | Migration tooling |
| postgres | 3.4.7 | postgres.js driver |
| Better Auth | 1.7.20 | Installed with the Drizzle adapter (`pg`); auth schema in `packages/database`, instance in `packages/auth` |
| @better-auth/drizzle-adapter | 1.7.20 | Installed transitively by `better-auth`; use `better-auth/adapters/drizzle` |
| Zod | 4.6.7 | Shared validation |
| Turborepo | 2.11.11 | Task orchestration |

The TanStack Start, Vite and React plugin peer dependency matrix must be verified with `bun install` and the first production build. Do not blindly update all dependencies together.
