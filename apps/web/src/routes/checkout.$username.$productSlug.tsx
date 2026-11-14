import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { formatPriceIdr } from "@biova/shared/product";
import { getCheckoutProduct, startCheckout } from "../server/checkout";

export const Route = createFileRoute("/checkout/$username/$productSlug")({
  loader: async ({ params }) => {
    const product = await getCheckoutProduct({
      data: { creatorSlug: params.username, productSlug: params.productSlug },
    });
    if (!product) throw notFound();
    return product;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `Buy ${loaderData.title} · Biova` : "Not found · Biova" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CheckoutPage,
  notFoundComponent: NotFound,
});

function CheckoutPage() {
  const product = Route.useLoaderData();
  const router = useRouter();
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isFree = product.priceIdr === 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await startCheckout({
      data: {
        creatorSlug: product.creatorSlug,
        productSlug: product.slug,
        buyerName,
        buyerEmail,
        buyerPhone: buyerPhone || null,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(
        result.error === "not_found"
          ? "This product is no longer available."
          : result.error === "payment_unavailable"
            ? "Payment is temporarily unavailable. Please try again."
            : "Please check your details and try again.",
      );
      return;
    }
    // A free product is fulfilled immediately; otherwise hand off to the
    // provider's hosted payment page, then the buyer returns to the receipt.
    if (result.data.redirectUrl) {
      window.location.href = result.data.redirectUrl;
      return;
    }
    await router.navigate({ to: "/order/$reference", params: { reference: result.data.reference } });
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" to="/">biova<span>·</span></Link>
        <span className="nav-label">CHECKOUT</span>
      </nav>
      <header className="profile">
        <div className="eyebrow">FROM @{product.creatorSlug}</div>
        {product.thumbnailUrl ? <img className="checkout-thumb" src={product.thumbnailUrl} alt="" /> : null}
        <h1>{product.title}</h1>
        {product.description ? <p className="intro">{product.description}</p> : null}
      </header>
      <section className="panel">
        <div className="order-summary">
          <div className="order-line"><span>Subtotal</span><span>{formatPriceIdr(product.priceIdr)}</span></div>
          <div className="order-line total"><span>Total</span><span>{formatPriceIdr(product.priceIdr)}</span></div>
        </div>
        <form className="form" onSubmit={submit}>
          <label>Name<input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required autoComplete="name" /></label>
          <label>Email<input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required autoComplete="email" /></label>
          <label>Phone (optional)<input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} autoComplete="tel" placeholder="+62 812 3456 7890" /></label>
          {error ? <p className="error">{error}</p> : null}
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Working…" : isFree ? "Get it free" : `Pay ${formatPriceIdr(product.priceIdr)}`}
          </button>
        </form>
        <p className="intro">By continuing you agree to receive the order confirmation at the email above.</p>
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
        <h1>Product<br /><em>unavailable.</em></h1>
        <p className="intro">This product is not on sale right now.</p>
      </section>
    </main>
  );
}
