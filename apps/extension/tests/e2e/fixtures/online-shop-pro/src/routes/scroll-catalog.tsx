import { useState } from "react";

/**
 * Scroll-to-find fixture: A long product catalog where the target item
 * is below the fold. The agent must scroll down, find the item, and
 * click its "View Details" button to reveal a hidden spec.
 */
export default function ScrollCatalog() {
  const [revealedItem, setRevealedItem] = useState<string | null>(null);

  const products = [
    { id: "p1", name: "Wireless Mouse", price: "$29.99", category: "Accessories" },
    { id: "p2", name: "Mechanical Keyboard", price: "$89.99", category: "Accessories" },
    { id: "p3", name: "USB-C Hub", price: "$49.99", category: "Accessories" },
    { id: "p4", name: "Monitor Stand", price: "$39.99", category: "Furniture" },
    { id: "p5", name: "Webcam HD", price: "$59.99", category: "Electronics" },
    { id: "p6", name: "Desk Lamp", price: "$34.99", category: "Furniture" },
    { id: "p7", name: "Cable Organizer", price: "$12.99", category: "Accessories" },
    { id: "p8", name: "Laptop Riser", price: "$44.99", category: "Furniture" },
    { id: "p9", name: "Noise-Canceling Earbuds", price: "$129.99", category: "Electronics" },
    { id: "p10", name: "Ergonomic Chair Cushion", price: "$54.99", category: "Furniture" },
    { id: "p11", name: "Portable SSD 1TB", price: "$79.99", category: "Storage" },
    { id: "p12", name: "Blue Light Glasses", price: "$24.99", category: "Accessories" },
    // TARGET ITEM — below the fold
    {
      id: "target",
      name: "Thunderbolt Dock Pro",
      price: "$199.99",
      category: "Electronics",
      spec: "Model: TB4-DOCK-2026 — 96W charging, 3x USB-A, 2x USB-C, HDMI 2.1, SD card reader",
    },
    { id: "p14", name: "Wireless Charger", price: "$19.99", category: "Accessories" },
    { id: "p15", name: "Privacy Screen Filter", price: "$44.99", category: "Accessories" },
  ];

  const handleViewDetails = (productId: string) => {
    setRevealedItem(productId);
    if (productId === "target") {
      (window as any).targetRevealed = {
        productId,
        spec: products.find((p) => p.id === "target")!.spec,
      };
    }
  };

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Office Equipment Catalog</h1>
      </div>

      <div style={{ padding: "24px", maxWidth: 800, margin: "0 auto" }}>
        <p style={{ color: "#64748b", marginBottom: 24 }}>
          Browse our full catalog of office equipment. Click "View Details" on
          any product to see its specifications.
        </p>

        {products.map((product) => (
          <div
            key={product.id}
            className="card"
            style={{
              marginBottom: 16,
              padding: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{product.name}</div>
              <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                {product.category} · {product.price}
              </div>
              {revealedItem === product.id && (product as any).spec && (
                <div
                  id={`spec-${product.id}`}
                  style={{
                    marginTop: 8,
                    padding: 10,
                    background: "#eff6ff",
                    borderRadius: 6,
                    fontSize: 13,
                    color: "#1e40af",
                  }}
                >
                  {(product as any).spec}
                </div>
              )}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleViewDetails(product.id)}
            >
              {product.id === "target" ? "View Specs" : "View Details"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
