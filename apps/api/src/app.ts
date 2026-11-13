import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { getPublicPage, resolvePublishedCreatorId, type BiovaServices } from "@biova/core";
import { analyticsRangeSchema, type RateLimiter } from "@biova/shared";

export interface SessionUser {
  id: string;
}

export interface AppDeps {
  getServices: () => Promise<BiovaServices>;
  getSessionUser: (headers: Headers) => Promise<SessionUser | null>;
  allowedOrigins: string[];
  rateLimiter?: RateLimiter;
  // Webhook deliveries carry no session, so the per-user limiter never sees
  // them; this separate limiter caps them per client address instead.
  webhookRateLimiter?: RateLimiter;
  // Public analytics ingest has no session either; this caps event writes per
  // client address so the public endpoint cannot be used to flood the tables.
  analyticsRateLimiter?: RateLimiter;
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
  amount_mismatch: 409,
  invalid_signature: 401,
  payment_unavailable: 502,
  too_large: 413,
  storage_unavailable: 503,
  invalid_token: 401,
  unavailable: 404,
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

    // Products. Same isolation rule as links: the creator comes from the
    // session, never from the request body.
    .get("/v1/products", async ({ request, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      return { products: await auth.services.products.list(auth.creator.id) };
    })
    .post("/v1/products", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await auth.services.products.create({
        creatorId: auth.creator.id,
        title: String(payload.title ?? ""),
        slug: String(payload.slug ?? ""),
        description: payload.description == null ? null : String(payload.description),
        priceIdr: Number(payload.priceIdr),
      });
      if (!result.ok) return errorResponse(set, result.error);
      set.status = 201;
      return { product: result.value };
    })
    .patch("/v1/products/:id", async ({ request, params, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await auth.services.products.update({
        creatorId: auth.creator.id,
        productId: params.id,
        title: payload.title == null ? undefined : String(payload.title),
        description: payload.description == null ? undefined : String(payload.description),
        priceIdr: payload.priceIdr == null ? undefined : Number(payload.priceIdr),
      });
      if (!result.ok) return errorResponse(set, result.error);
      return { product: result.value };
    })
    .put("/v1/products/:id/status", async ({ request, params, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as { status?: unknown };
      const result = await auth.services.products.setStatus(auth.creator.id, params.id, String(payload.status ?? ""));
      if (!result.ok) return errorResponse(set, result.error);
      return { product: result.value };
    })
    .delete("/v1/products/:id", async ({ request, params, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const result = await auth.services.products.remove(auth.creator.id, params.id);
      if (!result.ok) return errorResponse(set, result.error);
      return { id: result.value.id };
    })
    .put("/v1/products/reorder", async ({ request, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as { ids?: unknown };
      const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
      const result = await auth.services.products.reorder(auth.creator.id, ids);
      if (!result.ok) return errorResponse(set, result.error);
      return { ids: result.value.ids };
    })

    // Product assets. Uploads are multipart; the file bytes are buffered here and
    // handed to the storage service, which writes them under a server-generated
    // key. The route never trusts a client path.
    .post("/v1/products/:id/assets", async ({ request, params, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return errorResponse(set, "invalid_input");
      }
      const file = form.get("file");
      if (!(file instanceof File)) return errorResponse(set, "invalid_input");

      const result = await auth.services.assets.add({
        creatorId: auth.creator.id,
        productId: params.id,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        data: new Uint8Array(await file.arrayBuffer()),
      });
      if (!result.ok) return errorResponse(set, result.error);
      set.status = 201;
      return { asset: result.value };
    })
    .get("/v1/products/:id/assets", async ({ request, params, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const result = await auth.services.assets.list(auth.creator.id, params.id);
      if (!result.ok) return errorResponse(set, result.error);
      return { assets: result.value };
    })
    .delete("/v1/products/assets/:assetId", async ({ request, params, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const result = await auth.services.assets.remove(auth.creator.id, params.assetId);
      if (!result.ok) return errorResponse(set, result.error);
      return { id: result.value.id };
    })
    .put("/v1/products/:id/assets/reorder", async ({ request, params, body, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = (body ?? {}) as { ids?: unknown };
      const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
      const result = await auth.services.assets.reorder(auth.creator.id, params.id, ids);
      if (!result.ok) return errorResponse(set, result.error);
      return { ids: result.value.ids };
    })
    // Buyer delivery listing. The order reference is the bearer credential, and
    // the service returns nothing unless the order is paid and has entitlements.
    .get("/v1/orders/:reference/downloads", async ({ params, set }) => {
      const services = await deps.getServices();
      const result = await services.delivery.listForOrder(params.reference);
      if (!result.ok) return errorResponse(set, result.error);
      return { items: result.value };
    })
    // Signed download. The token is the only credential; the service checks the
    // signature, the entitlement, and that the asset belongs to the product.
    .get("/v1/downloads/:token", async ({ params, set }) => {
      const services = await deps.getServices();
      const result = await services.delivery.openDownload(params.token);
      if (!result.ok) return errorResponse(set, result.error);
      // Copy into a fresh ArrayBuffer so the body is a plain BlobPart.
      const bytes = new Uint8Array(result.value.data.byteLength);
      bytes.set(result.value.data);
      return new Response(new Blob([bytes]), {
        headers: {
          "content-type": result.value.contentType,
          "content-disposition": `attachment; filename="${encodeURIComponent(result.value.fileName)}"`,
        },
      });
    })

    // Checkout is public: a visitor who is not signed in must be able to buy.
    // The price is read server-side from the published row, so a client cannot
    // influence the amount.
    .post("/v1/checkout", async ({ body, set }) => {
      const payload = (body ?? {}) as Record<string, unknown>;
      const services = await deps.getServices();
      const result = await services.orders.checkout({
        creatorSlug: String(payload.creatorSlug ?? ""),
        productSlug: String(payload.productSlug ?? ""),
        buyerName: String(payload.buyerName ?? ""),
        buyerEmail: String(payload.buyerEmail ?? ""),
        buyerPhone: payload.buyerPhone == null ? null : String(payload.buyerPhone),
      });
      if (!result.ok) return errorResponse(set, result.error);
      set.status = 201;
      return {
        order: {
          reference: result.value.order.reference,
          status: result.value.order.status,
          totalIdr: result.value.order.totalIdr,
          currency: result.value.order.currency,
        },
        redirectUrl: result.value.redirectUrl,
      };
    })
    // Creator order list. Requires a session; returns only the creator's orders.
    .get("/v1/orders", async ({ request, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const rows = await auth.services.orders.listByCreator(auth.creator.id);
      return {
        orders: rows.map(({ order, items }) => ({
          reference: order.reference,
          status: order.status,
          totalIdr: order.totalIdr,
          currency: order.currency,
          buyerName: order.buyerName,
          buyerEmail: order.buyerEmail,
          createdAt: order.createdAt,
          items: items.map((item) => ({ title: item.title, unitPriceIdr: item.unitPriceIdr })),
        })),
      };
    })
    // Buyer order lookup. The random reference is the bearer credential; it is
    // not derivable from the creator or product slug.
    .get("/v1/orders/:reference", async ({ params, set }) => {
      const services = await deps.getServices();
      const found = await services.orders.getByReference(params.reference);
      if (!found) {
        set.status = 404;
        return { error: "not_found" };
      }
      return {
        order: {
          reference: found.order.reference,
          status: found.order.status,
          totalIdr: found.order.totalIdr,
          currency: found.order.currency,
          buyerEmail: found.order.buyerEmail,
          paidAt: found.order.paidAt,
        },
        items: found.items.map((item) => ({ title: item.title, unitPriceIdr: item.unitPriceIdr })),
      };
    })

    // Provider webhook. Public by necessity (the gateway cannot sign in), so it
    // is protected by the provider signature check inside the orders service,
    // plus a separate per-address rate limit. A forged body is rejected without
    // recording an event, so it cannot burn an idempotency key.
    .post("/v1/webhooks/:provider", async ({ request, params, body, set }) => {
      if (deps.webhookRateLimiter) {
        const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const limited = deps.webhookRateLimiter.consume(`webhook:${params.provider}:${address}`);
        if (!limited.allowed) {
          set.status = 429;
          set.headers["retry-after"] = String(Math.ceil(limited.retryAfterMs / 1000));
          return { error: "rate_limited" };
        }
      }
      const services = await deps.getServices();
      const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const result = await services.orders.handleWebhook(payload);
      if (!result.ok) return errorResponse(set, result.error);
      // Gateways retry on any non-2xx, so a duplicate or ignored delivery is
      // still acknowledged as accepted.
      return { outcome: result.value.outcome };
    })

    // Public analytics ingest. No session: the visitor is anonymous by design.
    // The creator is resolved from the published slug, so a caller cannot write
    // events against an arbitrary creator id, and the per-address limiter caps
    // how fast a client can write. The service rejects an event whose link or
    // product does not belong to that creator.
    .post("/v1/public/:slug/events", async ({ request, params, body, set }) => {
      if (deps.analyticsRateLimiter) {
        const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
        const limited = deps.analyticsRateLimiter.consume(`analytics:${address}`);
        if (!limited.allowed) {
          set.status = 429;
          set.headers["retry-after"] = String(Math.ceil(limited.retryAfterMs / 1000));
          return { error: "rate_limited" };
        }
      }
      const services = await deps.getServices();
      const creatorId = await resolvePublishedCreatorId(services, params.slug);
      if (!creatorId) {
        set.status = 404;
        return { error: "not_found" };
      }
      const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const result = await services.analytics.track({
        creatorId,
        type: String(payload.type ?? ""),
        visitorId: String(payload.visitorId ?? ""),
        path: payload.path === undefined ? undefined : String(payload.path),
        linkId: payload.linkId === undefined ? undefined : String(payload.linkId),
        productId: payload.productId === undefined ? undefined : String(payload.productId),
      });
      if (!result.ok) return errorResponse(set, result.error);
      set.status = 202;
      return { recorded: true };
    })

    // Creator analytics summary. Session-scoped: a creator only ever reads their
    // own metrics, and the range is validated by the shared schema.
    .get("/v1/analytics/summary", async ({ request, query, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const range = analyticsRangeSchema.safeParse((query as { range?: unknown }).range ?? "30d");
      if (!range.success) return errorResponse(set, "invalid_input");
      const summary = await auth.services.analytics.summary(auth.creator.id, range.data);
      return { summary };
    })

    // The same metrics split by UTC calendar day, for the dashboard trend chart.
    .get("/v1/analytics/timeseries", async ({ request, query, set }) => {
      const auth = await requireCreatorId(request, set);
      if (!auth) return { error: "unauthorized" };
      if (!auth.creator) {
        set.status = 404;
        return { error: "not_found" };
      }
      const range = analyticsRangeSchema.safeParse((query as { range?: unknown }).range ?? "30d");
      if (!range.success) return errorResponse(set, "invalid_input");
      const timeseries = await auth.services.analytics.timeseries(auth.creator.id, range.data);
      return { timeseries };
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
