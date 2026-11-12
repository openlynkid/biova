import { describe, expect, test } from "bun:test";
import { createFakeProvider, createMidtransProvider, midtransSignature } from "./index";

const serverKey = "SB-Mid-server-TESTKEY";

function midtransPayload(overrides: Record<string, unknown> = {}) {
  const orderId = "ORDREF123456";
  const statusCode = "200";
  const grossAmount = "75000.00";
  return {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    transaction_status: "settlement",
    transaction_id: "tx-1",
    currency: "IDR",
    signature_key: midtransSignature(orderId, statusCode, grossAmount, serverKey),
    ...overrides,
  };
}

describe("midtrans provider", () => {
  test("accepts a correctly signed notification and normalises the amount", () => {
    const provider = createMidtransProvider({ serverKey, isProduction: false });
    const parsed = provider.parseNotification(midtransPayload());
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe("settlement");
    expect(parsed?.amountIdr).toBe(75_000);
    expect(parsed?.orderReference).toBe("ORDREF123456");
    expect(parsed?.providerReference).toBe("tx-1");
  });

  test("rejects a notification whose signature does not match", () => {
    const provider = createMidtransProvider({ serverKey, isProduction: false });
    expect(provider.parseNotification(midtransPayload({ signature_key: "deadbeef" }))).toBeNull();
    // A tampered amount invalidates the signature even with the original key.
    expect(provider.parseNotification(midtransPayload({ gross_amount: "1.00" }))).toBeNull();
  });

  test("rejects unknown transaction states instead of treating them as paid", () => {
    const provider = createMidtransProvider({ serverKey, isProduction: false });
    const payload = midtransPayload({ transaction_status: "mystery" });
    // Recompute the signature over the changed status so only the state is wrong.
    payload.signature_key = midtransSignature("ORDREF123456", "200", "75000.00", serverKey);
    expect(provider.parseNotification(payload)).toBeNull();
  });

  test("rejects a payload with missing fields", () => {
    const provider = createMidtransProvider({ serverKey, isProduction: false });
    expect(provider.parseNotification({ order_id: "x" })).toBeNull();
  });

  test("maps card capture and refund states", () => {
    const provider = createMidtransProvider({ serverKey, isProduction: false });
    const capture = midtransPayload({ transaction_status: "capture" });
    expect(provider.parseNotification(capture)?.status).toBe("capture");

    const refund = midtransPayload({ transaction_status: "partial_refund" });
    expect(provider.parseNotification(refund)?.status).toBe("refund");
  });
});

describe("fake provider", () => {
  test("only parses notifications carrying the shared secret", () => {
    const provider = createFakeProvider({ secret: "s3cret" });
    const base = { order_id: "ORDREF123456", transaction_status: "settlement", gross_amount: "1000" };
    expect(provider.parseNotification(base)).toBeNull();
    expect(provider.parseNotification({ ...base, signature: "wrong" })).toBeNull();

    const parsed = provider.parseNotification({ ...base, signature: "s3cret" });
    expect(parsed?.status).toBe("settlement");
    expect(parsed?.amountIdr).toBe(1000);
  });
});
