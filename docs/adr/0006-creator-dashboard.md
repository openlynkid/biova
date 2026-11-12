# ADR-0006: Creator dashboard and theming

- Status: Accepted
- Date: 2026-11-12

## Context

The public page and the domain services existed, but a creator had no way to sign
in, claim a username or manage their page without calling the API by hand. This
adds the first creator-facing UI and the theming it needs.

## Decision

- The dashboard is a TanStack Start route (`apps/web/src/routes/dashboard.tsx`).
  Its loader resolves the session and the dashboard data on the server, so the
  first paint is already authenticated.
- All mutations are TanStack server functions in `apps/web/src/server/dashboard.ts`.
  They resolve the user from the request cookies with
  `auth.api.getSession({ headers: getRequestHeaders() })`, then call the same
  domain services the API uses. The browser never talks to the database and the
  creator id is never taken from the client.
- The Better Auth client (`better-auth/react`) is same-origin, so the session
  cookie stays first-party and no absolute auth base URL is needed in the client.
- Better Auth uses a dynamic `baseURL` with `allowedHosts`. In development the
  dev tunnel forwards its own Host header, so the allowlist includes
  `*.all-hands.dev`; production sets `BETTER_AUTH_ALLOWED_HOSTS`. This keeps the
  cookie prefix (`__Secure-`) and `trustedOrigins` correct behind a proxy.
- Page theme values (`accent`, `background`, `textColor`, `buttonStyle`) are
  stored as a closed schema and rendered as inline CSS variables
  (`--page-accent`, `--page-bg`, `--page-text`) on the public page.
- Theme colours must match `#rgb`/`#rrggbb` (`themeColorSchema`). They are
  interpolated into inline styles, so a looser schema would let a creator inject
  CSS or a `url(...)` value.

## Consequences

- The dashboard and the public API share one set of domain rules through
  `@biova/core`; there is no second write path to keep in sync.
- Server functions that need the creator throw `unauthorized`; `getDashboard`
  returns `null` for anonymous visitors so the page can render the sign-in panel
  instead of an error.
- Local development must load `.env`. The root `dev`, `db:migrate` and `db:seed`
  scripts pass `--env-file=.env` because the web dev server runs under Node,
  where Bun's automatic `.env` loading does not apply.
