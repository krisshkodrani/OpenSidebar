import { useState, useEffect } from "react";

/**
 * Procurement List fixture — a "docs list" page that tells the agent
 * what to buy and from which store page. The agent must open each store
 * in a new tab, add the item to cart, then come back and check it off.
 *
 * Each store page is a minimal self-contained shop (inline on this route
 * via query-param ?store=<id>) so we don't need external sites.
 */

/* ── Procurement items ─────────────────────────────────────────────── */

interface ProcurementItem {
  id: string;
  name: string;
  store: string;       // human-readable store name
  storeSlug: string;   // used in ?store= param
  quantity: number;
  maxPrice: number;     // budget ceiling
}

const ITEMS: ProcurementItem[] = [
  {
    id: "item-1",
    name: "Ergonomic Keyboard",
    store: "TechDirect",
    storeSlug: "techdirect",
    quantity: 2,
    maxPrice: 89,
  },
  {
    id: "item-2",
    name: "Standing Desk Mat",
    store: "OfficeHub",
    storeSlug: "officehub",
    quantity: 1,
    maxPrice: 45,
  },
  {
    id: "item-3",
    name: "USB-C Monitor Cable",
    store: "TechDirect",
    storeSlug: "techdirect",
    quantity: 5,
    maxPrice: 15,
  },
];

/* ── Mini store catalog (rendered when ?store= is present) ─────────── */

interface StoreProduct {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
}

const STORE_CATALOGS: Record<string, { name: string; products: StoreProduct[] }> = {
  techdirect: {
    name: "TechDirect",
    products: [
      { id: "td-kb-1", name: "Ergonomic Keyboard", price: 79.99, inStock: true },
      { id: "td-kb-2", name: "Mechanical Keyboard", price: 129.99, inStock: true },
      { id: "td-cable-1", name: "USB-C Monitor Cable", price: 12.99, inStock: true },
      { id: "td-cable-2", name: "HDMI Cable 6ft", price: 9.99, inStock: true },
      { id: "td-mouse-1", name: "Wireless Mouse", price: 34.99, inStock: false },
    ],
  },
  officehub: {
    name: "OfficeHub",
    products: [
      { id: "oh-mat-1", name: "Standing Desk Mat", price: 39.99, inStock: true },
      { id: "oh-chair-1", name: "Lumbar Support Cushion", price: 29.99, inStock: true },
      { id: "oh-org-1", name: "Desk Organizer", price: 19.99, inStock: true },
    ],
  },
};

/* ── Mini Store Component ──────────────────────────────────────────── */

function MiniStore({ slug }: { slug: string }) {
  const catalog = STORE_CATALOGS[slug];
  const [cart, setCart] = useState<{ productId: string; name: string; qty: number; price: number }[]>([]);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");

  // Expose cart for test verification
  useEffect(() => {
    (window as any).__storeCart = cart;
    (window as any).__storeOrderPlaced = orderPlaced;
    (window as any).__storeOrderNumber = orderNumber;
  }, [cart, orderPlaced, orderNumber]);

  if (!catalog) {
    return (
      <div className="fixture-static" style={{ padding: "2rem" }}>
        <h1>Store not found</h1>
        <p>Unknown store: {slug}</p>
      </div>
    );
  }

  const addToCart = (product: StoreProduct, qty: number) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === product.id);
      if (existing) {
        return prev.map((c) =>
          c.productId === product.id ? { ...c, qty: c.qty + qty } : c,
        );
      }
      return [...prev, { productId: product.id, name: product.name, qty, price: product.price }];
    });
  };

  const placeOrder = () => {
    const num = `ORD-${Date.now().toString(36).toUpperCase()}`;
    setOrderNumber(num);
    setOrderPlaced(true);
  };

  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

  if (orderPlaced) {
    return (
      <div className="fixture-static" style={{ padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
        <h1>{catalog.name}</h1>
        <div
          data-testid="order-confirmation"
          style={{
            background: "#ecfdf5",
            border: "1px solid #6ee7b7",
            borderRadius: 8,
            padding: "1.5rem",
            marginTop: "1rem",
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#059669" }}>Order Confirmed!</h2>
          <p>
            Order number: <strong data-testid="order-number">{orderNumber}</strong>
          </p>
          <p>Items: {cart.map((c) => `${c.name} x${c.qty}`).join(", ")}</p>
          <p>Total: ${total.toFixed(2)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixture-static" style={{ padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
      <h1>{catalog.name}</h1>
      <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
        Browse our products and add items to your cart.
      </p>

      {/* Product list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {catalog.products.map((product) => (
          <div
            key={product.id}
            data-testid={`product-${product.id}`}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "1rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>{product.name}</strong>
              <div style={{ color: "#6b7280", fontSize: 14 }}>
                ${product.price.toFixed(2)}
                {!product.inStock && (
                  <span style={{ color: "#ef4444", marginLeft: 8 }}>Out of stock</span>
                )}
              </div>
            </div>
            {product.inStock && (
              <button
                aria-label={`Add ${product.name} to cart`}
                onClick={() => addToCart(product, 1)}
                style={{
                  background: "#2563eb",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  padding: "0.5rem 1rem",
                  cursor: "pointer",
                }}
              >
                Add to Cart
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Cart summary */}
      {cart.length > 0 && (
        <div
          data-testid="cart-summary"
          style={{
            marginTop: "2rem",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "1rem",
          }}
        >
          <h2>Cart ({cart.reduce((s, c) => s + c.qty, 0)} items)</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0" }}>
            {cart.map((c) => (
              <li key={c.productId} style={{ padding: "0.25rem 0" }}>
                {c.name} × {c.qty} — ${(c.price * c.qty).toFixed(2)}
              </li>
            ))}
          </ul>
          <p style={{ fontWeight: "bold" }}>Total: ${total.toFixed(2)}</p>
          <button
            aria-label="Place Order"
            onClick={placeOrder}
            style={{
              marginTop: "0.5rem",
              background: "#059669",
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "0.75rem 1.5rem",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            Place Order
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Procurement List (main view) ──────────────────────────────────── */

export default function ProcurementList() {
  // Check if we're rendering a store view
  const params = new URLSearchParams(window.location.search);
  const storeSlug = params.get("store");

  if (storeSlug) {
    return <MiniStore slug={storeSlug} />;
  }

  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  // Expose state for test verification
  useEffect(() => {
    (window as any).__procurementChecked = [...checkedItems];
  }, [checkedItems]);

  const toggleItem = (itemId: string) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const allDone = checkedItems.size === ITEMS.length;

  return (
    <div className="fixture-static" style={{ padding: "2rem", maxWidth: 800, margin: "0 auto" }}>
      <h1>Procurement List</h1>
      <p style={{ color: "#6b7280", marginBottom: "0.5rem" }}>
        Open each store in a <strong>new tab</strong>, purchase the listed items,
        then come back here and check them off. Use the store links below.
      </p>
      <p style={{ color: "#9ca3af", fontSize: 14, marginBottom: "1.5rem" }}>
        {checkedItems.size} of {ITEMS.length} items completed
      </p>

      <table
        data-testid="procurement-table"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
        }}
      >
        <thead>
          <tr style={{ background: "#f9fafb", textAlign: "left" }}>
            <th style={{ padding: "0.75rem", width: 40 }}>Done</th>
            <th style={{ padding: "0.75rem" }}>Item</th>
            <th style={{ padding: "0.75rem" }}>Store</th>
            <th style={{ padding: "0.75rem", textAlign: "center" }}>Qty</th>
            <th style={{ padding: "0.75rem", textAlign: "right" }}>Budget</th>
          </tr>
        </thead>
        <tbody>
          {ITEMS.map((item) => {
            const checked = checkedItems.has(item.id);
            const storeUrl = `${window.location.pathname}?store=${item.storeSlug}`;
            return (
              <tr
                key={item.id}
                data-testid={`row-${item.id}`}
                style={{
                  borderTop: "1px solid #e5e7eb",
                  background: checked ? "#f0fdf4" : "white",
                  opacity: checked ? 0.7 : 1,
                }}
              >
                <td style={{ padding: "0.75rem", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    aria-label={`Mark ${item.name} as done`}
                    checked={checked}
                    onChange={() => toggleItem(item.id)}
                  />
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <span style={{ textDecoration: checked ? "line-through" : "none" }}>
                    {item.name}
                  </span>
                </td>
                <td style={{ padding: "0.75rem" }}>
                  <a
                    href={storeUrl}
                    target="_blank"
                    rel="noopener"
                    aria-label={`Open ${item.store}`}
                    style={{ color: "#2563eb", textDecoration: "underline" }}
                  >
                    {item.store}
                  </a>
                </td>
                <td style={{ padding: "0.75rem", textAlign: "center" }}>{item.quantity}</td>
                <td style={{ padding: "0.75rem", textAlign: "right" }}>
                  ${item.maxPrice.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {allDone && (
        <div
          data-testid="all-done-banner"
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "#ecfdf5",
            border: "1px solid #6ee7b7",
            borderRadius: 8,
            textAlign: "center",
            fontWeight: "bold",
            color: "#059669",
          }}
        >
          All items procured!
        </div>
      )}
    </div>
  );
}
