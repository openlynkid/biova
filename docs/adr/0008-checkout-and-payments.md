# ADR-0008: Checkout, orders and payment webhooks

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 3 adds the money path: a visitor buys a digital product from a creator
page, pays through a gateway, and gets access to the product. This brings in
things the earlier domains did not have — an unauthenticated buyer, a third-party
callback that must be trusted carefully, and a hard requirement that money and
entitlements never disagree.

The gateway is Midtrans (QRIS, e-wallet, VA, cards), which is the common choice
for Indonesian creators.

## Decision

### Provider abstraction

- `packages/payments` defines `PaymentProvider`: `createPayment` and
  `parseNotification`. The orders domain depends on this interface, not on
  Midtrans. A second gateway is an adapter, not a domain change.
- The Midtrans adapter verifies the notification signature
  (`sha512(order_id + status_code + gross_amount + serverKey)`) before returning
  a notification, using a constant-time comparison. `parseNotification` returns
  `null` for a bad signature, an unknown `transaction_status`, or a missing
  field, so an unrecognised state is never treated as paid.
- The provider is selected in `core` from the environment: Midtrans when
  `MIDTRANS_SERVER_KEY` is set, otherwise a fake provider. The fake provider
  still requires a shared secret, so a local or test deployment cannot be driven
  by an unauthenticated caller.

### Orders domain

- `packages/orders` owns the repository and the service. The service enforces
  the order state machine (`canTransitionOrder`) and returns `Result` like the
  other domains.
- The price is resolved server-side: `checkout` looks up a published product
  owned by the creator whose slug was requested and snapshots the price into the
  order and the order item. The request body never carries an amount.
- `applyStatus` changes the order status and grants entitlements in one
  transaction, and only when the row is still in the expected `from_status`. The
  order and its entitlements cannot drift, and two concurrent webhooks cannot
  both win.
- The order reference is 20 characters from a 32-symbol alphabet (~100 bits),
  which is not derivable from the creator or product slug. It is the bearer
  credential for the buyer's receipt page.

### Webhooks

- `POST /v1/webhooks/:provider` is public by necessity. It is protected by the
  provider signature check plus a separate per-address rate limiter, because the
  per-user limiter never sees a sessionless request.
- Ordering inside `handleWebhook` matters. Signature check first (a forged body
  is rejected and never recorded). Then order lookup and the amount/currency
  check against the stored order. Only then is the event recorded, using the
  unique `(provider, event_id)` index as the idempotency gate.
  Recording before the amount check would let a signed-but-wrong delivery burn
  the idempotency key and block the legitimate settlement that follows.
- A duplicate or ignored delivery returns 200, because gateways retry on any
  non-2xx.
- Free products (`price_idr = 0`) skip the gateway: the order is marked paid and
  entitlements are granted immediately.

## Consequences

- Money-affecting rules live in one place and are covered by PGlite tests: price
  snapshotting, idempotency, forged signatures, amount mismatch, invalid
  transitions, and creator isolation.
- Adding a gateway means implementing `PaymentProvider` and one env switch.
- The webhook path is the only unauthenticated write. Its safety rests on the
  signature check and the amount check against stored state, both enforced in the
  service, not in the route.
- Settlement reconciliation for abandoned pending orders is not implemented yet;
  pending orders that are never settled stay pending until a cleanup job exists.
