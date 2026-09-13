import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  loadTargetRun,
  submitTargetAction,
  type TargetRun,
} from "./target-api";
import "./target.css";
import "./target-message.css";

function TargetApp() {
  const [run, setRun] = useState<TargetRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState("US 10");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void loadTargetRun()
        .then((next) => {
          if (active) {
            setRun(next);
            setError(null);
          }
        })
        .catch(
          () =>
            active &&
            setError("This Playground target session is no longer available."),
        );
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  if (error)
    return (
      <main className="target-message">
        <p className="disclosure">OpenSidebar Playground · simulated website</p>
        <h1>That session has ended.</h1>
        <p>{error}</p>
        <a
          className="return-to-playground"
          href="https://opensidebar.com/playground"
        >
          Return to Playground
        </a>
      </main>
    );
  if (!run)
    return (
      <main className="target-message" aria-busy="true">
        <p>Loading simulated store…</p>
      </main>
    );
  if (run.scenarioId !== "restock-alert")
    return (
      <main className="target-message">
        <h1>Scenario unavailable</h1>
        <p>This first Lightsail slice supports Restock.</p>
      </main>
    );
  const state = run.state;
  const inventory = Number(state.inventory ?? 0);
  const inStock = state.availability === "in_stock" && inventory > 0;
  const maxQuantity = Math.max(1, Math.min(5, inventory));
  const add = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      setRun(await submitTargetAction("restock.addToCart", { size, quantity }));
      setFeedback(`${quantity} pair added to the demo cart.`);
    } catch (cause) {
      setFeedback(
        cause instanceof Error ? cause.message : "Could not update the cart.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="store">
      <header className="store-nav">
        <b>Peak Outfitters</b>
        <small>OpenSidebar Playground · simulated store</small>
      </header>
      <section className="product">
        <div className="product-image" aria-hidden="true">
          👟
        </div>
        <div>
          <p className="crumb">Running / Shoes / Daily trainers</p>
          <h1>{String(state.product)}</h1>
          <p className="price">
            ${(Number(state.priceCents) / 100).toFixed(2)}
          </p>
          <div className={`availability ${inStock ? "in" : "out"}`}>
            {inStock ? `${inventory} in stock` : "Out of stock"}
          </div>
          <div className="product-options">
            <label>
              Size
              <select
                value={size}
                disabled={!inStock}
                onChange={(event) => setSize(event.target.value)}
              >
                {[7, 8, 9, 10, 11, 12].map((value) => (
                  <option key={value}>US {value}</option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <select
                value={quantity}
                disabled={!inStock}
                onChange={(event) => setQuantity(Number(event.target.value))}
              >
                {Array.from(
                  { length: maxQuantity },
                  (_, index) => index + 1,
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          {Number(state.cartQuantity) > 0 && (
            <div className="cart-summary">
              <strong>Demo cart · {String(state.cartQuantity)}</strong>
              <span>{String(state.cartSize)}</span>
            </div>
          )}
          {feedback && (
            <p className="target-feedback" role="status">
              {feedback}
            </p>
          )}
          <button
            className="add"
            disabled={!inStock || busy}
            onClick={() => void add()}
          >
            {busy ? "Adding…" : "Add to cart"}
          </button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<TargetApp />);
