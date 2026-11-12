import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { getPublicPage, type BiovaServices } from "@biova/core";
import type { RateLimiter } from "@biova/shared";

export interface SessionUser {
  id: string;
}

export interface AppDeps {
  getServices: () => Promise<BiovaServices>;
  getSessionUser: (headers: Headers) => Promise<SessionUser | null>;
  allowedOrigins: string[];
  rateLimiter?: RateLimiter;
}

// Domain error codes are stable strings; map them to HTTP statuses once here so
// route handlers stay free of branching on error names.
const STATUS_BY_ERROR: Record<string, number> = {
  invalid_input: 422,
  not_found: 404,
  slug_taken: 409,
  already_exists: 409,
  invalid_transition: 409,
  not_publishable: 422,
};

function errorResponse(set: { status?: number | string }, error: string) {
  set.status = STATUS_BY_ERROR[error] ?? 400;
  return { error };
}

export function createApp(deps: AppDeps) {
  const app = new Elysia()
    .use(
      cors({
        origin: deps.allowedOrigins,
        credentials: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      }),
    )
    .onError(({ code, error, set }) => {
      // Never leak internals: unexpected failures are logged and reported as 500.
      if (code === "VALIDATION" || code === "PARSE") {
        set.status = 422;
        return { error: "invalid_input" };
      }
      console.error("[api] unhandled error", error);
      set.status = 500;
      return { error: "internal_error" };
    });

  async function requireCreatorId(request: Request, set: { status?: number | string }) {
    const user = await deps.getSessionUser(request.headers);
    if (!user) {
      set.status = 401;
      return null;
    }
    const services = await deps.getServices();
    const creator = await services.creators.getByUserId(user.id);
    return { services, creator };
  }

  app
    .get("/health", () => ({ status: "ok", service: "biova-api", runtime: "bun" }))
    .get("/v1", () => ({ name: "Biova API", version: "0.1.0" }))
    .get("/v1/session", async ({ request, set }) => {
      const user = await deps.getSessionUser(request.headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      return { user };
    });

  // Authenticated writes are rate limited per creator to blunt abuse and
  // accidental request storms from the dashboard.
  app.onBeforeHandle(async ({ request, set }) => {
    if (!deps.rateLimiter) return;
    const user = await deps.getSessionUser(request.headers);
    if (!user) return;

    const result = deps.rateLimiter.consume(`user:${user.id}`);
    set.headers["x-ratelimit-remaining"] = String(result.remaining);
    if (!result.allowed) {
      set.status = 429;
      set.headers["retry-after"] = String(Math.ceil(result.retryAfterMs / 1000));
      return { error: "rate_limited" };
    }
  });

  app
    // Creator onboarding and profile. Requires a session.
    .post("/v1/creator", async ({ request, body, set }) => {
      const user = await deps.getSessionUser(request.headers);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const services = await deps.getServices();
      const payload = (body ?? {}) as { slug?: unknown; displayName?: unknown; bio?: unknown };
      const result = await services.creators.getOrCreate({
        userId: user.id,
        slug: String(payload.slug ?? ""),
        displayName: String(payload.displayName ?? ""),
        bio: payload.bio == null ? null : String(payload.bio),
      });
      if (!result.ok) return errorResponse(set, result.error);

      // Every creator gets their page up front so the dashboard has something to edit.
      const page = await services.pages.ensurePage(result.value.id);
      set.status = 201;
      return { creator: result.value, page };
    })
    .get("/v1/creator", async ({ request, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const page = await auth.services.pages.ensurePage(auth.creator.id);
      return { creator: auth.creator, page };
    })
    .patch("/v1/creator", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as { displayName?: unknown; bio?: unknown };
      const result = await auth.services.creators.updateProfile({
        creatorId: auth.creator.id,
        displayName: payload.displayName == null ? undefined : String(payload.displayName),
        bio: payload.bio == null ? undefined : String(payload.bio),
      });
      if (!result.ok) return errorResponse(set, result.error);
      return { creator: result.value };
    })

    .patch("/v1/page", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      await auth.services.pages.ensurePage(auth.creator.id);
      const payload = (body ?? {}) as { title?: unknown; theme?: unknown };
      const result = await auth.services.pages.update({
        creatorId: auth.creator.id,
        title: payload.title == null ? undefined : String(payload.title),
        theme: payload.theme && typeof payload.theme === "object" ? (payload.theme as Record<string, unknown>) : undefined,
      });
      if (!result.ok) return errorResponse(set, result.error);
      return { page: result.value };
    })
    .put("/v1/page/status", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      await auth.services.pages.ensurePage(auth.creator.id);
      const payload = (body ?? {}) as { status?: unknown };
      const result = await auth.services.pages.setStatus(auth.creator.id, String(payload.status ?? ""));
      if (!result.ok) return errorResponse(set, result.error);
      return { page: result.value };
    })

    .get("/v1/links", async ({ request, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      return { links: await auth.services.links.list(auth.creator.id) };
    })
    .post("/v1/links", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await auth.services.links.create({
        creatorId: auth.creator.id,
        title: String(payload.title ?? ""),
        url: String(payload.url ?? ""),
        description: payload.description == null ? null : String(payload.description),
        icon: payload.icon == null ? null : String(payload.icon),
        enabled: payload.enabled === undefined ? undefined : Boolean(payload.enabled),
      });
      if (!result.ok) return errorResponse(set, result.error);
      set.status = 201;
      return { link: result.value };
    })
    .patch("/v1/links/:id", async ({ request, params, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await auth.services.links.update({
        creatorId: auth.creator.id,
        linkId: params.id,
        title: payload.title == null ? undefined : String(payload.title),
        url: payload.url == null ? undefined : String(payload.url),
        description: payload.description == null ? undefined : String(payload.description),
        icon: payload.icon == null ? undefined : String(payload.icon),
        enabled: payload.enabled === undefined ? undefined : Boolean(payload.enabled),
      });
      if (!result.ok) return errorResponse(set, result.error);
      return { link: result.value };
    })
    .delete("/v1/links/:id", async ({ request, params, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const result = await auth.services.links.remove(auth.creator.id, params.id);
      if (!result.ok) return errorResponse(set, result.error);
      return { id: result.value.id };
    })
    .put("/v1/links/reorder", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as { ids?: unknown };
      const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
      const result = await auth.services.links.reorder(auth.creator.id, ids);
      if (!result.ok) return errorResponse(set, result.error);
      return { ids: result.value.ids };
    })

    // Public read model. No session required; only published pages are returned.
    .get("/v1/public/:slug", async ({ params, set }) => {
      const services = await deps.getServices();
      const page = await getPublicPage(services, params.slug);
      if (!page) {
        set.status = 404;
        return { error: "not_found" };
      }
      return page;
    });

  return app;
}
