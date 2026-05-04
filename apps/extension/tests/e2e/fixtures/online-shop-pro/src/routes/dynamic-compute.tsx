import { useState } from "react";

/**
 * Dynamic compute fixture: Tests execute_js by providing data that
 * can only be extracted via JavaScript (data attributes, computed
 * styles, localStorage, or programmatic DOM queries).
 *
 * The page shows visible options and a visible computed price, while
 * also exposing the computed total through data attributes/window state.
 */
export default function DynamicCompute() {
  const [size, setSize] = useState("medium");
  const [color, setColor] = useState("black");
  const [engraving, setEngraving] = useState(false);

  // Price logic is exposed through data attributes for verification.
  const basePrice = 75;
  const sizeMultiplier = size === "small" ? 0.8 : size === "large" ? 1.3 : 1.0;
  const engravingCost = engraving ? 15 : 0;
  const computedTotal = Math.round((basePrice * sizeMultiplier + engravingCost) * 100) / 100;

  // Expose via window for e2e verification
  if (typeof window !== "undefined") {
    (window as any).getComputedPrice = () => computedTotal;
    (window as any).productConfig = { size, color, engraving, total: computedTotal };
  }

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Custom Product Configurator</h1>
      </div>

      <div style={{ padding: "24px", maxWidth: 600, margin: "0 auto" }}>
        <div className="card" style={{ padding: 24 }}>
          <h2>Premium Water Bottle</h2>
          <p style={{ color: "#64748b", marginTop: 8 }}>
            Customize your bottle below. The final price depends on your selections.
          </p>

          <div style={{ marginTop: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 8 }}>
              Size
            </label>
            <select
              id="size-select"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}
            >
              <option value="small">Small (16 oz)</option>
              <option value="medium">Medium (24 oz)</option>
              <option value="large">Large (32 oz)</option>
            </select>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 8 }}>
              Color
            </label>
            <select
              id="color-select"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 14 }}
            >
              <option value="black">Matte Black</option>
              <option value="white">Arctic White</option>
              <option value="blue">Ocean Blue</option>
            </select>
          </div>

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="engraving-checkbox"
              type="checkbox"
              checked={engraving}
              onChange={(e) => setEngraving(e.target.checked)}
            />
            <label htmlFor="engraving-checkbox" style={{ fontSize: 14 }}>
              Add custom engraving (+$15)
            </label>
          </div>

          <div
            id="price-display"
            data-computed-total={computedTotal}
            style={{
              marginTop: 24,
              padding: 16,
              background: "#f8fafc",
              borderRadius: 8,
              textAlign: "center",
            }}
          >
            <p style={{ color: "#64748b", fontSize: 13 }}>
              Your configuration: {size} / {color} {engraving ? "/ engraved" : ""}
            </p>
            <p id="price-text" style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>
              ${computedTotal.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
