import { createAuthClient } from "better-auth/react";

// Same-origin client: the auth routes are mounted at /api/auth on this app, so
// no absolute base URL is needed and the session cookie stays first-party.
export const authClient = createAuthClient();
