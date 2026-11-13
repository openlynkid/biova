import { escapeHtml, type NotificationContext, type NotificationKind } from "@biova/shared";
import { formatPriceIdr } from "@biova/shared/product";

// A rendered message: what the provider is asked to deliver. Plain text is
// always present as a fallback, so a client that refuses HTML still shows the
// whole message.
export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
}

// The message for each kind. Templates are code, not stored data: the shape of
// the context is fixed by `NotificationContext`, and every interpolated value is
// either a number or escaped, so a hostile buyer name or product title cannot
// break the markup.
export function renderNotification(kind: NotificationKind, context: NotificationContext): RenderedNotification {
  return kind === "sale" ? renderSale(context) : renderOrderPaid(context);
}

function renderOrderPaid(context: NotificationContext): RenderedNotification {
  const total = formatPriceIdr(context.totalIdr);
  const lines = context.items.map((title) => `• ${title}`).join("\n");

  return {
    subject: `Your ${context.creatorName} order is ready`,
    text: [
      `Hi ${context.buyerName},`,
      "",
      `Your payment of ${total} was received. Here is what you bought:`,
      lines,
      "",
      `Open your downloads: ${context.actionUrl}`,
      "",
      `Order reference: ${context.orderReference}`,
      "",
      `${context.creatorName} · powered by Biova`,
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(context.buyerName)},</p>`,
      `<p>Your payment of <strong>${escapeHtml(total)}</strong> was received. Here is what you bought:</p>`,
      `<ul>${context.items.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`,
      `<p><a href="${escapeHtml(context.actionUrl)}">Open your downloads</a></p>`,
      `<p>Order reference: ${escapeHtml(context.orderReference)}</p>`,
      `<p>${escapeHtml(context.creatorName)} · powered by Biova</p>`,
    ].join("\n"),
  };
}

function renderSale(context: NotificationContext): RenderedNotification {
  const total = formatPriceIdr(context.totalIdr);
  const lines = context.items.map((title) => `• ${title}`).join("\n");

  return {
    subject: `You made a sale: ${total}`,
    text: [
      "You made a sale.",
      "",
      `${context.buyerName} bought:`,
      lines,
      "",
      `Total: ${total}`,
      `Order reference: ${context.orderReference}`,
      "",
      `See it in your dashboard: ${context.actionUrl}`,
    ].join("\n"),
    html: [
      "<p>You made a sale.</p>",
      `<p>${escapeHtml(context.buyerName)} bought:</p>`,
      `<ul>${context.items.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`,
      `<p>Total: <strong>${escapeHtml(total)}</strong></p>`,
      `<p>Order reference: ${escapeHtml(context.orderReference)}</p>`,
      `<p><a href="${escapeHtml(context.actionUrl)}">See it in your dashboard</a></p>`,
    ].join("\n"),
  };
}
