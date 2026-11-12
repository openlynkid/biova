import { z } from "zod";

// Order lifecycle. An order is created pending and only becomes paid after a
// server-verified payment; there is no client path that can mark it paid.
export const orderStatusSchema = z.enum(["pending", "paid", "failed", "expired", "refunded"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

// Payment attempt lifecycle as reported by the provider. `pending` is created
// before the provider call; the provider webhook moves it to a terminal state.
export const paymentStatusSchema = z.enum(["pending", "settlement", "capture", "deny", "cancel", "expire", "refund"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

// Provider states that mean the money is actually in. Midtrans uses both
// `settlement` (e.g. bank transfer) and `capture` (e.g. card) for success.
export const PAID_PAYMENT_STATUSES: readonly PaymentStatus[] = ["settlement", "capture"];
export const FAILED_PAYMENT_STATUSES: readonly PaymentStatus[] = ["deny", "cancel", "expire"];

export function isPaymentPaid(status: PaymentStatus): boolean {
  return PAID_PAYMENT_STATUSES.includes(status);
}

export function isPaymentFailed(status: PaymentStatus): boolean {
  return FAILED_PAYMENT_STATUSES.includes(status);
}

// Order transitions. Paid is terminal except for a refund; failures never
// return to pending, so a replayed webhook cannot resurrect a dead order.
export const allowedOrderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "failed", "expired"],
  paid: ["refunded"],
  failed: [],
  expired: [],
  refunded: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || allowedOrderTransitions[from].includes(to);
}

// Buyer details collected at checkout. Email is required so a receipt and an
// order access link can be delivered; the name is used on the confirmation.
export const buyerNameSchema = z.string().trim().min(1).max(120);
export const buyerEmailSchema = z.email().max(254);
export const buyerPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{6,20}$/, "use an international phone number");

export const createOrderSchema = z.object({
  productSlug: z.string().trim().min(1).max(48),
  buyerName: buyerNameSchema,
  buyerEmail: buyerEmailSchema,
  buyerPhone: buyerPhoneSchema.nullish(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// Short, URL-safe public reference for an order. Buyers open their confirmation
// page with it; it is random so it cannot be guessed from the creator's slug.
export const orderReferenceSchema = z.string().regex(/^[A-Za-z0-9]{10,32}$/);

// A provider-agnostic view of a payment attempt. The Midtrans adapter maps the
// provider payload onto this shape so the domain never sees provider-specific
// fields, and a future provider is an adapter, not a domain change.
export interface PaymentIntent {
  provider: string;
  providerReference: string;
  redirectUrl: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentNotification {
  provider: string;
  // Provider-side order id (the order reference we sent).
  orderReference: string;
  providerReference: string;
  status: PaymentStatus;
  amountIdr: number;
  // The currency the provider reports, used to reject a mismatched amount.
  currency: string;
  signature: string;
  raw: Record<string, unknown>;
}
