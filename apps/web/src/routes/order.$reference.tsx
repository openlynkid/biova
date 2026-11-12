import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { formatPriceIdr } from "@biova/shared/product";
import { formatBytes } from "@biova/shared/asset";
import { getOrder } from "../server/checkout";

const STATUS_LABEL: Record<string, string> = {
  pending: "AWAITING PAYMENT",
  paid: "PAID",
  failed: "PAYMENT FAILED",
  expired: "EXPIRED",
  refunded: "REFUNDED",
};

export const Route = createFileRoute("/order/$reference")({
  loader: async ({ params }) => {
    const order = await getOrder({ data: { reference: params.reference } });
    if (!order) throw notFound();
    return order;
  },
  head: () => ({ meta: [{ title: "Your order · Biova" }] }),
  component: OrderPage,
  notFoundComponent: NotFound,
});

function OrderPage() {
  const order = Route.useLoaderData();
  const paid = order.status === "paid";

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" to="/">biova<span>·</span></Link>
        <span className="nav-label">ORDER {order.reference}</span>
      </nav>
      <header className="profile">
        <div className="eyebrow">{STATUS_LABEL[order.status] ?? order.status.toUpperCase()}</div>
        <h1>{paid ? "You're in." : order.status === "pending" ? "Almost there." : "Order closed."}</h1>
        <p className="intro">
          {paid
            ? "Payment received. Your access is ready below."
            : order.status === "pending"
              ? "We have not received a payment confirmation yet. This page updates once the payment settles."
              : "This order is no longer active. Contact the creator if you think this is a mistake."}
        </p>
      </header>
      <section className="panel">
        <div className="eyebrow">ITEMS</div>
        <ul className="rows">
          {order.items.map((item, index) => (
            <li className="row" key={`${item.title}-${index}`}>
              <span className="row-icon">◫</span>
              <div className="row-body"><strong>{item.title}</strong></div>
              <span className="product-price">{formatPriceIdr(item.unitPriceIdr)}</span>
            </li>
          ))}
        </ul>
        <div className="order-summary">
          <div className="order-line"><span>Total</span><span>{formatPriceIdr(order.totalIdr)}</span></div>
          <div className="order-line"><span>Buyer</span><span>{order.buyerEmail}</span></div>
          <div className="order-line"><span>Reference</span><span>{order.reference}</span></div>
        </div>
        {paid ? (
          <div className="access-panel">
            <strong>Your download</strong>
            {order.downloads.length === 0 ? (
              <p className="intro">The creator has not attached files to this product yet. Keep this page and check back.</p>
            ) : (
              order.downloads.map((item) => (
                <div className="download-group" key={item.title}>
                  <div className="eyebrow">{item.title}</div>
                  <ul className="rows">
                    {item.assets.map((asset) => (
                      <li className="row" key={asset.downloadPath}>
                        <span className="row-icon">⤓</span>
                        <div className="row-body">
                          <strong>{asset.fileName}</strong>
                          <small>{formatBytes(asset.sizeBytes)}</small>
                        </div>
                        <a className="button primary" href={asset.downloadPath}>Download</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            <p className="intro">These links expire shortly. Reopen this page to get fresh ones.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function NotFound() {
  return (
    <main className="shell">
      <nav className="nav"><Link className="brand" to="/">biova<span>·</span></Link></nav>
      <section className="hero">
        <div className="eyebrow"><span className="pulse" /> NOT FOUND</div>
        <h1>No order<br /><em>here.</em></h1>
        <p className="intro">Check the link from your confirmation email.</p>
      </section>
    </main>
  );
}
