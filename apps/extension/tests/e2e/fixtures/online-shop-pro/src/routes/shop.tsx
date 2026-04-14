import { useState, useEffect } from "react";

const UNSPLASH = "https://images.unsplash.com";
const img = (id, w = 400, h = 260) =>
  `${UNSPLASH}/${id}?w=${w}&h=${h}&fit=crop&auto=format&q=80`;

const products = [
  {
    id: "pegasus-41",
    name: "Air Zoom Pegasus 41",
    category: "road",
    price: 149,
    rating: 4.8,
    brand: "Nike",
    sizes: [8, 9, 10, 11, 12],
    colors: ["black", "white", "volt"],
    image: img("photo-1542291026-7eec264c27ff"),
    tag: "Best Seller",
    tagClass: "tag-bestseller",
  },
  {
    id: "novablast-4",
    name: "Novablast 4",
    category: "road",
    price: 140,
    rating: 4.6,
    brand: "ASICS",
    sizes: [8, 9, 10, 11],
    colors: ["blue", "black"],
    image: img("photo-1606107557195-0e29a4b5b4aa"),
    tag: null,
    tagClass: "",
  },
  {
    id: "trabuco-max",
    name: "Trabuco Max 3",
    category: "trail",
    price: 170,
    rating: 4.5,
    brand: "ASICS",
    sizes: [8, 9, 10, 11],
    colors: ["green", "black"],
    image: img("photo-1539185441755-769473a23570"),
    tag: "Trail Pick",
    tagClass: "tag-trail",
  },
  {
    id: "cloudstrike-8",
    name: "CloudStrike 8",
    category: "road",
    price: 165,
    rating: 4.7,
    brand: "Hoka",
    sizes: [8, 9, 10, 11, 12],
    colors: ["black", "gray", "white"],
    image: img("photo-1491553895911-0055eca6402d"),
    tag: "New",
    tagClass: "tag-new",
  },
  {
    id: "summit-mesh",
    name: "Summit Mesh GTX",
    category: "trail",
    price: 145,
    rating: 4.4,
    brand: "Salomon",
    sizes: [8, 9, 10, 11],
    colors: ["gray", "black", "lime"],
    image: img("photo-1562183241-b937e95585b6"),
    tag: null,
    tagClass: "",
  },
  {
    id: "tempo-shorts",
    name: "Tempo 2-in-1 Shorts",
    category: "apparel",
    price: 58,
    rating: 4.1,
    brand: "Northstar",
    sizes: ["S", "M", "L", "XL"],
    colors: ["black", "navy"],
    image: null,
    fallbackGradient:
      "linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%)",
    fallbackIcon: "👳",
    tag: null,
    tagClass: "",
  },
  {
    id: "endurance-watch",
    name: "Endurance GPS Watch",
    category: "accessories",
    price: 229,
    rating: 4.3,
    brand: "Northstar",
    sizes: ["One Size"],
    colors: ["white", "black"],
    image: img("photo-1523275335684-37898b6baf30"),
    tag: null,
    tagClass: "",
  },
  {
    id: "run-pack",
    name: "Commuter Run Pack",
    category: "accessories",
    price: 89,
    rating: 4.2,
    brand: "Northstar",
    sizes: ["One Size"],
    colors: ["black", "navy"],
    image: img("photo-1553062407-98eeb64c6a62"),
    tag: null,
    tagClass: "",
  },
];

const money = (v) => `$${v.toFixed(2)}`;
const renderStars = (rating) => {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  return "★".repeat(full) + (half ? "½" : "") + ` ${rating}`;
};

export default function App() {
  const [view, setView] = useState("catalog"); // catalog, cart, product, orders, confirmation
  const [filters, setFilters] = useState({
    search: "",
    category: "all",
    sort: "featured",
    maxPrice: 300,
  });
  const [cart, setCart] = useState([]);
  const [coupon, setCoupon] = useState(null);
  const [shippingMethod, setShippingMethod] = useState("standard");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [pdpSize, setPdpSize] = useState("");
  const [pdpColor, setPdpColor] = useState("");
  const [pdpQty, setPdpQty] = useState(1);
  const [couponInput, setCouponInput] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [couponMessageType, setCouponMessageType] = useState(""); // "ok" | "error"
  const [checkoutName, setCheckoutName] = useState("");
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [orderError, setOrderError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);
  const [previousOrders, setPreviousOrders] = useState([]);
  const [orderCounter, setOrderCounter] = useState(1000);

  // Expose state globally for testing
  useEffect(() => {
    window.cart = cart;
    window.lastOrder = lastOrder;
    window.previousOrders = previousOrders;
    window.__shopState = {
      cart,
      lastOrder,
      previousOrders,
      filters,
      coupon,
      shippingMethod,
    };
  }, [cart, lastOrder, previousOrders, filters, coupon, shippingMethod]);

  const getFiltered = () => {
    let list = products.filter((p) => {
      if (filters.category !== "all" && p.category !== filters.category)
        return false;
      if (p.price > filters.maxPrice) return false;
      if (filters.search) {
        if (
          !`${p.name} ${p.brand}`
            .toLowerCase()
            .includes(filters.search.toLowerCase())
        )
          return false;
      }
      return true;
    });
    if (filters.sort === "price-asc")
      list = [...list].sort((a, b) => a.price - b.price);
    if (filters.sort === "price-desc")
      list = [...list].sort((a, b) => b.price - a.price);
    if (filters.sort === "rating")
      list = [...list].sort((a, b) => b.rating - a.rating);
    return list;
  };

  const computeSummary = () => {
    const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const discount = coupon === "SAVE10" ? subtotal * 0.1 : 0;
    const shipping = shippingMethod === "express" ? 15 : 0;
    return {
      subtotal,
      discount,
      shipping,
      total: Math.max(0, subtotal - discount + shipping),
    };
  };

  const addLine = (product, size, color, qty) => {
    const key = `${product.id}::${size}::${color}`;
    const existing = cart.find((item) => item.key === key);
    if (existing) {
      setCart(
        cart.map((item) =>
          item.key === key ? { ...item, qty: item.qty + qty } : item,
        ),
      );
    } else {
      setCart([
        ...cart,
        {
          key,
          id: product.id,
          name: product.name,
          unitPrice: product.price,
          qty,
          size,
          color,
        },
      ]);
    }
  };

  const quickAdd = (product) => {
    const size = product.sizes.includes(10) ? 10 : product.sizes[0];
    const color = product.colors.includes("black")
      ? "black"
      : product.colors[0];
    addLine(product, String(size), color, 1);
    setView("cart");
  };

  const updateQty = (key, delta) => {
    setCart(
      cart.map((item) => {
        if (item.key === key) {
          return { ...item, qty: Math.max(1, item.qty + delta) };
        }
        return item;
      }),
    );
  };

  const removeItem = (key) => {
    setCart(cart.filter((item) => item.key !== key));
  };

  const placeOrder = async () => {
    setOrderError("");
    if (cart.length === 0) {
      setOrderError("Add at least one item.");
      return;
    }
    if (!checkoutName.trim() || !checkoutEmail.trim()) {
      setOrderError("Please complete all checkout fields.");
      return;
    }

    setIsProcessing(true);
    await new Promise((r) => setTimeout(r, 800));

    const s = computeSummary();
    const newOrderId = `NS-${String(orderCounter + 1).padStart(5, "0")}`;
    const newOrder = {
      orderId: newOrderId,
      email: checkoutEmail,
      name: checkoutName,
      total: s.total,
      subtotal: s.subtotal,
      discount: s.discount,
      shipping: s.shipping,
      shippingMethod,
      coupon,
      items: cart.map((l) => ({ ...l })),
      timestamp: new Date().toISOString(),
      status: "confirmed",
    };

    setLastOrder(newOrder);
    setPreviousOrders([newOrder, ...previousOrders]);
    setOrderCounter(orderCounter + 1);
    setCart([]);
    setCoupon(null);
    setShippingMethod("standard");
    setCheckoutName("");
    setCheckoutEmail("");
    setIsProcessing(false);
    setView("confirmation");
  };

  const continueShopping = () => {
    setView("catalog");
    setLastOrder(null);
  };

  const cartItemCount = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <>
      <header className="topbar">
        <div className="logo">Northstar Outfitters</div>
        <div className="topbar-right">
          <button
            className="cart-button"
            style={{
              background: view === "orders" ? "#334155" : "transparent",
              border: "1px solid #334155",
            }}
            onClick={() => setView(view === "orders" ? "catalog" : "orders")}
          >
            My Orders
            {previousOrders.length > 0 && (
              <span
                style={{
                  background: "#ef4444",
                  color: "white",
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "10px",
                  marginLeft: "6px",
                }}
              >
                {previousOrders.length}
              </span>
            )}
          </button>
          <span>
            Cart: <strong>{cartItemCount}</strong>
          </span>
          <button
            className="cart-button"
            onClick={() => setView(view === "cart" ? "catalog" : "cart")}
          >
            {view === "cart" ? "Close Cart" : "Open Cart"}
          </button>
        </div>
      </header>

      {view !== "orders" && view !== "confirmation" && (
        <section className="hero">
          <h1>Performance Running Collection</h1>
          <p>
            Field-tested shoes, gear, and essentials for race-day comfort.
            Engineered for the miles ahead.
          </p>
          <div className="hero-badges">
            <span className="hero-badge">Free Returns</span>
            <span className="hero-badge">Fast Shipping</span>
            <span className="hero-badge">Use code SAVE10 for 10% off</span>
          </div>
        </section>
      )}

      {view === "catalog" && (
        <main className="content">
          <aside className="panel">
            <h2>Find Your Gear</h2>
            <div className="field">
              <label>Search products</label>
              <input
                placeholder="e.g. Pegasus"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={filters.category}
                onChange={(e) =>
                  setFilters({ ...filters, category: e.target.value })
                }
              >
                <option value="all">All</option>
                <option value="road">Road Running</option>
                <option value="trail">Trail</option>
                <option value="apparel">Apparel</option>
                <option value="accessories">Accessories</option>
              </select>
              <div className="quick-filters">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFilters({ ...filters, category: "road" })}
                >
                  Road Running
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFilters({ ...filters, category: "all" })}
                >
                  All Categories
                </button>
              </div>
            </div>
            <div className="field">
              <label>Sort by</label>
              <select
                value={filters.sort}
                onChange={(e) =>
                  setFilters({ ...filters, sort: e.target.value })
                }
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="rating">Rating</option>
              </select>
            </div>
            <div className="field">
              <label>Max price ($)</label>
              <input
                type="number"
                value={filters.maxPrice}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    maxPrice: Number(e.target.value) || 300,
                  })
                }
              />
            </div>
          </aside>

          <section className="catalog">
            <div className="catalog-header">
              <h2>Catalog</h2>
              <p className="meta">{getFiltered().length} items</p>
            </div>
            <div className="catalog-grid">
              {getFiltered().map((p) => (
                <article key={p.id} className="product">
                  <div className="visual">
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.nextSibling.style.display = "flex";
                        }}
                      />
                    ) : null}
                    <span
                      className="fallback-icon"
                      style={{
                        display: p.image ? "none" : "flex",
                        background: p.fallbackGradient || "#f1f5f9",
                      }}
                    >
                      {p.fallbackIcon || "👟"}
                    </span>
                    {p.tag && (
                      <span className={`promo-tag ${p.tagClass}`}>{p.tag}</span>
                    )}
                  </div>
                  <div className="body">
                    <span className="badge">{p.brand}</span>
                    <div className="name">{p.name}</div>
                    <div className="stars">{renderStars(p.rating)}</div>
                    <div className="meta">
                      {p.category.charAt(0).toUpperCase() + p.category.slice(1)}
                    </div>
                    <div className="price-row">
                      <span className="price">{money(p.price)}</span>
                      <div className="product-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          aria-label={`View ${p.name}`}
                          onClick={() => {
                            setSelectedProduct(p);
                            setPdpSize(String(p.sizes[0]));
                            setPdpColor(p.colors[0]);
                            setPdpQty(1);
                            setView("product");
                          }}
                        >
                          View
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          aria-label={`Add ${p.name} to cart`}
                          onClick={() => quickAdd(p)}
                        >
                          Add to cart
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

      {view === "product" && selectedProduct && (
        <section className="section-block">
          <button
            className="btn btn-ghost"
            style={{ marginBottom: 16 }}
            onClick={() => setView("catalog")}
          >
            ← Back to Catalog
          </button>
          <h3>{selectedProduct.name}</h3>
          <p className="meta">
            {selectedProduct.brand} | ${selectedProduct.price} | Rating{" "}
            {selectedProduct.rating}
          </p>
          <div className="field" style={{ marginTop: 16 }}>
            <label>Choose size</label>
            <select
              value={pdpSize || String(selectedProduct.sizes[0])}
              onChange={(e) => setPdpSize(e.target.value)}
            >
              {selectedProduct.sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Choose color</label>
            <select
              value={pdpColor || selectedProduct.colors[0]}
              onChange={(e) => setPdpColor(e.target.value)}
            >
              {selectedProduct.colors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Quantity</label>
            <input
              type="number"
              min="1"
              value={pdpQty}
              onChange={(e) => setPdpQty(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => {
              const size = pdpSize || String(selectedProduct.sizes[0]);
              const color = pdpColor || selectedProduct.colors[0];
              addLine(selectedProduct, size, color, pdpQty);
              setView("cart");
            }}
          >
            Add to cart
          </button>
        </section>
      )}

      {view === "cart" && (
        <section className="section-block">
          <h3>Your Cart</h3>
          <div style={{ margin: "12px 0" }}>
            {cart.length === 0 ? (
              <p className="meta" style={{ textAlign: "center", padding: 20 }}>
                Your cart is empty.
              </p>
            ) : (
              cart.map((item) => (
                <div key={item.key} className="cart-line">
                  <div>
                    <div className="name">{item.name}</div>
                    <div className="meta">
                      Size {item.size} | {item.color}
                    </div>
                    <div className="meta">Unit {money(item.unitPrice)}</div>
                  </div>
                  <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                    <div className="qty-controls">
                      <button onClick={() => updateQty(item.key, -1)}>-</button>
                      <span>{item.qty}</span>
                      <button onClick={() => updateQty(item.key, 1)}>+</button>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeItem(item.key)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="cart-section">
            <h3>Promo Code</h3>
            <p className="meta" style={{ marginBottom: 8 }}>
              {coupon
                ? `Coupon status: ${coupon} applied successfully.`
                : "Coupon status: none applied yet."}
            </p>
            <div className="promo-row">
              <input
                placeholder="Enter code"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const code = couponInput.trim().toUpperCase();
                    if (code === "SAVE10") {
                      setCoupon("SAVE10");
                      setCouponMessage("Coupon applied: 10% off");
                      setCouponMessageType("ok");
                    } else {
                      setCoupon(null);
                      setCouponMessage("Invalid coupon");
                      setCouponMessageType("error");
                    }
                  }
                }}
              />
              <button
                className="btn btn-primary"
                onClick={() => {
                  const code = couponInput.trim().toUpperCase();
                  if (code === "SAVE10") {
                    setCoupon("SAVE10");
                    setCouponMessage("Coupon applied: 10% off");
                    setCouponMessageType("ok");
                  } else {
                    setCoupon(null);
                    setCouponMessage("Invalid coupon");
                    setCouponMessageType("error");
                  }
                }}
              >
                Apply
              </button>
            </div>
            {couponMessage && (
              <p className={couponMessageType} style={{ marginTop: 6 }}>
                {couponMessage}
              </p>
            )}
          </div>

          <div className="cart-section">
            <h3>Shipping</h3>
            <p className="meta" style={{ marginBottom: 10 }}>
              {shippingMethod === "express"
                ? "Shipping selected: Express ($15)"
                : "Shipping selected: Standard (Free)"}
            </p>
            <label className="shipping-option">
              <input
                type="radio"
                name="shipping-method"
                value="standard"
                checked={shippingMethod === "standard"}
                onChange={() => setShippingMethod("standard")}
              />
              Standard (Free)
            </label>
            <label className="shipping-option">
              <input
                type="radio"
                name="shipping-method"
                value="express"
                checked={shippingMethod === "express"}
                onChange={() => setShippingMethod("express")}
              />
              Express ($15)
            </label>
          </div>

          <div className="cart-section">
            <h3>Checkout</h3>
            <p className="meta" style={{ marginBottom: 8 }}>
              Fill both fields below to complete your order.
            </p>
            <div className="checkout-fields">
              <input
                placeholder="Full name"
                value={checkoutName}
                onChange={(e) => setCheckoutName(e.target.value)}
              />
              <input
                type="email"
                placeholder="Email address"
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="summary-divider"></div>
          <div className="summary-line">
            <span>Subtotal</span>
            <span>{money(computeSummary().subtotal)}</span>
          </div>
          <div className="summary-line">
            <span>Discount</span>
            <span>
              {computeSummary().discount > 0
                ? `- ${money(computeSummary().discount)}`
                : money(0)}
            </span>
          </div>
          <div className="summary-line">
            <span>Shipping</span>
            <span>{money(computeSummary().shipping)}</span>
          </div>
          <div className="summary-divider"></div>
          <div className="summary-line">
            <strong>Total</strong>
            <strong>{money(computeSummary().total)}</strong>
          </div>

          {orderError && (
            <p className="error" style={{ marginTop: 8 }}>
              {orderError}
            </p>
          )}

          <button
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 12, padding: 14, fontSize: 15 }}
            onClick={placeOrder}
            disabled={isProcessing}
          >
            {isProcessing ? "Processing..." : "Place Order"}
          </button>
          <button
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => setView("catalog")}
          >
            Continue Shopping
          </button>
        </section>
      )}

      {view === "confirmation" && lastOrder && (
        <section className="section-block">
          <span style={{ fontSize: 56 }}>✓</span>
          <h2>Order Confirmed!</h2>
          <p>
            Thank you for your purchase. A confirmation email has been sent to{" "}
            {lastOrder.email}
          </p>
          <p style={{ marginTop: 16 }}>
            Order ID: <strong>{lastOrder.orderId}</strong>
          </p>
          <div
            style={{
              margin: "16px 0",
              padding: 12,
              background: "#f8fafc",
              borderRadius: 8,
              textAlign: "left",
              fontSize: 14,
            }}
          >
            {lastOrder.items.map((item) => (
              <div key={item.key}>
                {item.name} ({item.size}/{item.color}) x{item.qty} —{" "}
                {money(item.unitPrice * item.qty)}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              maxWidth: 300,
              margin: "0 auto",
              fontSize: 14,
            }}
          >
            <span>Subtotal:</span>
            <span>{money(lastOrder.subtotal)}</span>
          </div>
          {lastOrder.discount > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                maxWidth: 300,
                margin: "4px auto",
                fontSize: 14,
              }}
            >
              <span>Discount:</span>
              <span className="ok">-{money(lastOrder.discount)}</span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              maxWidth: 300,
              margin: "4px auto",
              fontSize: 14,
            }}
          >
            <span>Shipping:</span>
            <span>
              {lastOrder.shipping === 0 ? "Free" : money(lastOrder.shipping)}
            </span>
          </div>
          <p style={{ marginTop: 12, fontSize: 18 }}>
            Total: <strong>{money(lastOrder.total)}</strong>
          </p>
          <div className="order-actions">
            <button className="btn btn-primary" onClick={continueShopping}>
              Continue Shopping
            </button>
          </div>
        </section>
      )}

      {view === "orders" && (
        <section className="section-block">
          <h3>Your Orders</h3>
          <div style={{ marginTop: 16 }}>
            {previousOrders.length === 0 ? (
              <p className="meta" style={{ textAlign: "center", padding: 20 }}>
                No orders yet.
              </p>
            ) : (
              previousOrders.map((order) => (
                <div
                  key={order.orderId}
                  style={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "start",
                      marginBottom: 12,
                      paddingBottom: 12,
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    <div>
                      <div className="name">Order #{order.orderId}</div>
                      <div className="meta">
                        {new Date(order.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span
                        className="badge"
                        style={{ background: "#dcfce7", color: "#166534" }}
                      >
                        {order.status || "Confirmed"}
                      </span>
                      <div className="price" style={{ marginTop: 4 }}>
                        {money(order.total)}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <div
                      className="meta"
                      style={{ fontWeight: 600, marginBottom: 6 }}
                    >
                      Items:
                    </div>
                    {order.items.map((item) => (
                      <div
                        key={item.key}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "4px 0",
                          fontSize: 13,
                        }}
                      >
                        <span>
                          {item.name} ({item.size} / {item.color}) x{item.qty}
                        </span>
                        <span>{money(item.unitPrice * item.qty)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>Subtotal:</span>
                      <span>{money(order.subtotal)}</span>
                    </div>
                    {order.discount > 0 && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>Discount:</span>
                        <span className="ok">-{money(order.discount)}</span>
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>Shipping:</span>
                      <span>
                        {order.shipping === 0 ? "Free" : money(order.shipping)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid #e2e8f0",
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <strong>Ship to:</strong> {order.name} ({order.email})
                    </div>
                    <div className="meta">
                      <strong>Shipping method:</strong>{" "}
                      {order.shippingMethod === "express"
                        ? "Express ($15)"
                        : "Standard (Free)"}
                    </div>
                    {order.coupon && (
                      <div className="meta">
                        <strong>Coupon:</strong> {order.coupon} (10% off)
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <button
            className="btn btn-ghost"
            style={{ width: "100%", marginTop: 16 }}
            onClick={() => setView("catalog")}
          >
            Close
          </button>
        </section>
      )}
    </>
  );
}
