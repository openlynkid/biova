import { createHash, timingSafeEqual } from "node:crypto";
import type { PaymentIntent, PaymentNotification, PaymentStatus } from "@biova/shared";

// A payment provider turns an order into a payable intent and turns a webhook
// body into a trusted notification. The domain depends on this interface only,
// so swapping Midtrans for another gateway is an adapter, not a domain change.
export interface CreatePaymentArgs {
  orderReference: string;
  amountIdr: number;
  buyer: { name: string; email: string; phone: string | null };
  items: { title: string; quantity: number; unitPriceIdr: number }[];
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(args: CreatePaymentArgs): Promise<PaymentIntent>;
  // Returns null when the payload is not authentic. Implementations MUST verify
  // the provider signature before returning a notification; callers trust the
  // result without re-checking.
  parseNotification(payload: Record<string, unknown>): PaymentNotification | null;
}

// Midtrans reports its own transaction states. Anything unknown is rejected so a
// new provider value cannot silently be treated as a paid order.
const MIDTRANS_STATUS: Record<string, PaymentStatus> = {
  pending: "pending",
  settlement: "settlement",
  capture: "capture",
  deny: "deny",
  cancel: "cancel",
  expire: "expire",
  refund: "refund",
  partial_refund: "refund",
};

export interface MidtransConfig {
  serverKey: string;
  // Snap has separate sandbox and production hosts; pick with the env flag.
  isProduction: boolean;
  // Injectable for tests; defaults to global fetch.
  fetchImpl?: typeof fetch;
}

// Signature is sha512(order_id + status_code + gross_amount + serverKey). The
// server key never leaves the server, so a forged payload cannot produce it.
export function midtransSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string): string {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function createMidtransProvider(config: MidtransConfig): PaymentProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";

  return {
    name: "midtrans",

    async createPayment(args) {
      // Snap expects gross_amount as a decimal string; IDR has no decimals.
      const grossAmount = String(args.amountIdr);
      const body = {
        transaction_details: { order_id: args.orderReference, gross_amount: args.amountIdr },
        item_details: args.items.map((item) => ({
          id: item.title,
          name: item.title,
          price: item.unitPriceIdr,
          quantity: item.quantity,
        })),
        customer_details: {
          first_name: args.buyer.name,
          email: args.buyer.email,
          phone: args.buyer.phone ?? undefined,
        },
      };

      const response = await doFetch(`${baseUrl}/snap/v1/transactions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${config.serverKey}:`).toString("base64")}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`midtrans charge failed with status ${response.status}`);
      }

      const data = (await response.json()) as { token?: string; redirect_url?: string };
      return {
        provider: "midtrans",
        providerReference: args.orderReference,
        redirectUrl: data.redirect_url ?? null,
        raw: { token: data.token, redirectUrl: data.redirect_url, grossAmount },
      };
    },

    parseNotification(payload) {
      const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
      const statusCode = typeof payload.status_code === "string" ? payload.status_code : null;
      const grossAmount = typeof payload.gross_amount === "string" ? payload.gross_amount : null;
      const signature = typeof payload.signature_key === "string" ? payload.signature_key : null;
      const transactionStatus = typeof payload.transaction_status === "string" ? payload.transaction_status : null;
      const currency = typeof payload.currency === "string" ? payload.currency : "IDR";
      const providerReference =
        typeof payload.transaction_id === "string" ? payload.transaction_id : orderId;

      if (!orderId || !statusCode || !grossAmount || !signature || !transactionStatus || !providerReference) return null;

      const expected = midtransSignature(orderId, statusCode, grossAmount, config.serverKey);
      if (!safeEqualHex(expected, signature)) return null;

      const status = MIDTRANS_STATUS[transactionStatus];
      if (!status) return null;

      // gross_amount can arrive as "75000.00"; round to whole rupiah.
      const amountIdr = Math.round(Number(grossAmount));
      if (!Number.isFinite(amountIdr)) return null;

      return {
        provider: "midtrans",
        orderReference: orderId,
        providerReference,
        status,
        amountIdr,
        currency,
        signature,
        raw: payload,
      };
    },
  };
}

// Deterministic provider used by tests and local development when no gateway
// keys are configured. It never calls the network and its notification parser
// requires a shared secret, so it cannot be driven by an unauthenticated caller.
export interface FakeProviderConfig {
  secret: string;
}

export function createFakeProvider(config: FakeProviderConfig): PaymentProvider {
  return {
    name: "fake",

    async createPayment(args) {
      return {
        provider: "fake",
        providerReference: `fake_${args.orderReference}`,
        redirectUrl: `https://example.test/pay/${args.orderReference}`,
        raw: { amountIdr: args.amountIdr },
      };
    },

    parseNotification(payload) {
      if (payload.signature !== config.secret) return null;
      const orderReference = typeof payload.order_id === "string" ? payload.order_id : null;
      const status = typeof payload.transaction_status === "string" ? (MIDTRANS_STATUS[payload.transaction_status] ?? null) : null;
      if (!orderReference || !status) return null;
      const amountIdr = Math.round(Number(payload.gross_amount));
      if (!Number.isFinite(amountIdr)) return null;
      return {
        provider: "fake",
        orderReference,
        providerReference: `fake_${orderReference}`,
        status,
        amountIdr,
        currency: "IDR",
        signature: config.secret,
        raw: payload,
      };
    },
  };
}
