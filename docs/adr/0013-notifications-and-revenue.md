# ADR-0013: Notifications and the revenue dashboard

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 4 (Growth and Analytics) still owed three of its five bullets: a revenue
dashboard, notifications, and conversion improvements. Analytics had a summary
and a daily trend, but a creator could not see which product earned the money,
and nothing told a buyer or a creator that an order had been paid. PRD 5 lists
"email notifications" under P1, and PRD 4.7 lists revenue as an MVP metric.

Two things made the naive version wrong. First, a notification sent from inside
the webhook handler competes with the payment it reports: a mail outage must not
turn a settled order into a failure. Second, a per-product revenue number read
from a second query will not agree with the totals shown beside it if the two
are computed from different filters.

## Decision

### The outbox pattern, keyed by the order

`notification_outbox` (migration `0006`) stores one row per message with a
`dedupe_key` unique index. `enqueue` inserts with `onConflictDoNothing` and
returns the row only when this call created it, so the idempotency gate is the
same shape as `payment_webhook_events`: a replayed webhook finds the row already
present and sends nothing. Keys are `order_paid:<reference>` and
`sale:<reference>`, so one receipt and one sale alert exist per order regardless
of how many times the gateway retries.

Each row tracks `status` (`pending`/`sent`/`failed`), an `attempts` counter
bumped in SQL (so two concurrent sends cannot lose a count) and the last error.
A `failed` row is a record, not a retry loop; a later sweep can read the outbox.

### Notifications never fail the payment

`createNotificationService` is injected into the orders domain as `onOrderPaid`.
The orders service calls it only after the order is durably `paid` — the free
path after `applyStatus` returns `paid`, the webhook path after the status
transition succeeds and only for a transition *into* `paid`. The hook is wrapped
in a try/catch that logs and swallows, and the service itself catches provider
failures and marks the row failed rather than rethrowing. A broken mail provider
therefore cannot roll back or fail an order that has already settled.

The orders domain hands over plain values (`orderReference`, buyer details,
totals, item titles) and never a database row, so notifications imports neither
the orders tables nor the creator domain. The creator contact (email, name, slug)
arrives through an injected `findCreatorContact`, the same pattern analytics uses
for its link and product titles.

### Templates are code, and every interpolation is escaped

`@biova/notifications` renders two kinds, `order_paid` (buyer receipt) and `sale`
(creator alert), from one closed `NotificationContext`. Each message carries a
plain-text body as well as HTML, so a client that refuses HTML still shows the
whole message. Every interpolated value is a number or passed through
`escapeHtml`, because a buyer name or product title is attacker- or
creator-controlled and must not become markup in the recipient's mail client.

### The transport is a port, and the default records

`NotificationProvider` is transport only: it is handed a finished subject and
bodies and is expected to throw on a failure it cannot retry. No transactional
email driver is wired yet, so the default `createNotificationProvider` returns a
recording provider that keeps messages in memory; tests inject it to assert what
would have been sent. A deployment swaps in an SMTP or API-backed driver without
touching the service.

### Revenue is one breakdown, computed once

`paidRevenueByProduct(creatorId, since)` groups paid orders by the product
snapshot on the order item, counting distinct orders (two items of the same
product on one order are one order). The analytics `summary` reads it together
with the order totals in the same `Promise.all` and the same window, so the
per-product revenue always sums to the revenue shown beside it. An item whose
product was deleted (`order_items.product_id` is nullable, set to null on
delete) is excluded from the breakdown — there is no product to attribute it to —
but its revenue still counts in the order totals.

The summary also derives two conversion numbers from the same rows:
`averageOrderValueIdr` (revenue over orders) and `conversionRate` (orders over
product views). Both are pure helpers in `@biova/shared/analytics` with a
zero-denominator guard, and each product carries its own `conversionRate`. The
dashboard shows a product with no activity at zero rather than omitting it, so a
creator can always see every product they sell.

### Conversion is surfaced, not just measured

The dashboard's `OrdersPanel` became `RevenuePanel`: revenue, paid orders,
average order value and conversion in one row, a daily revenue chart, a
revenue-by-product list (sold, views, convert %), and the order list. The public
product card gained an explicit `Buy now` affordance so the click target is
obvious. The traffic `AnalyticsPanel` keeps only traffic metrics; the money
metrics moved to `RevenuePanel` so each panel answers one question.

## Consequences

- A settled payment and its notification are decoupled; the order path cannot be
  taken down by the mail path, at the cost of a mail failure being visible only
  in the outbox, not to the buyer.
- The dedupe key makes notification exactly-once per order, matching the
  webhook's exactly-once status change.
- Per-product revenue and the totals cannot disagree, because they come from one
  read in one window.
- The default provider sends nothing. Until a real driver is configured, a
  deployment records messages in memory and delivers no mail; wiring the driver
  is the remaining production step and needs no change to the service or the
  orders domain.
- Conversion is orders over product views, so a product sold through a link
  without a view (or a free product) reads as a rate the creator may need to
  interpret. A future per-surface attribution would refine this.
