import { z } from "zod";

// What a notification is about. Kept as a closed set so the outbox cannot be
// used to store an arbitrary kind, and so a new kind is an explicit addition
// with a matching template.
export const notificationKindSchema = z.enum([
  // To the buyer: payment settled and their files are ready.
  "order_paid",
  // To the creator: someone bought one of their products.
  "sale",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

// Where a notification is in its life. `pending` is queued, `sent` means the
// provider accepted it, and `failed` records a permanent give-up so the row is
// not retried forever.
export const notificationStatusSchema = z.enum(["pending", "sent", "failed"]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

// Escapes a value for interpolation into an HTML email body. Buyer names and
// product titles are creator- or buyer-supplied, so a `<` in one of them must
// not become a tag in the recipient's mail client.
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

export interface NotificationRecipient {
  email: string;
  name: string | null;
}

// The variables a template renders. Deliberately a small, closed shape rather
// than free-form data: the template is code, and the values it interpolates are
// validated strings and numbers, so a hostile buyer name cannot inject markup.
export interface NotificationContext {
  orderReference: string;
  creatorSlug: string;
  creatorName: string;
  buyerName: string;
  totalIdr: number;
  currency: string;
  // Product titles in the order, in the order they were added.
  items: string[];
  // Where the recipient should go next. For a buyer this is the order receipt;
  // for a creator it is the dashboard.
  actionUrl: string;
}
