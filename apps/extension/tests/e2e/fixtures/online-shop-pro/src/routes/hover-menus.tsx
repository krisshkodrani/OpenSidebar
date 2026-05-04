import { useState, useRef, useEffect } from "react";

const CATEGORIES = ["Electronics", "Books", "Clothing", "Sports"];

const PRODUCTS = [
  { name: "Widget X", sku: "SKU-4829", price: "$49.99" },
  { name: "Widget Y", sku: "SKU-7153", price: "$29.99" },
  { name: "Widget Z", sku: "SKU-3361", price: "$79.99" },
  { name: "Gadget A", sku: "SKU-9087", price: "$99.99" },
];

export default function HoverMenus() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [visibleTooltip, setVisibleTooltip] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Expose results for test verification
  useEffect(() => {
    (window as any).hoverResult = {
      categorySelected: selectedCategory,
      skuFound: visibleTooltip !== null || searchSubmitted,
      searchCompleted: searchSubmitted,
      searchQuery: searchSubmitted ? searchQuery.trim() : "",
    };
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSearchSubmitted(true);
      (window as any).hoverResult = {
        categorySelected: selectedCategory,
        skuFound: true,
        searchCompleted: true,
        searchQuery: searchQuery.trim(),
      };
    }
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      {/* Navigation bar with hover dropdown */}
      <nav
        style={{
          background: "#1e293b",
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 24,
        }}
      >
        <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 16 }}>TechStore</span>

        <div
          ref={dropdownRef}
          style={{ position: "relative" }}
          // JS event listeners for hover — NOT CSS :hover
          onMouseOver={() => setDropdownOpen(true)}
          onMouseEnter={() => setDropdownOpen(true)}
        >
          <button
            style={{
              background: "transparent",
              color: "#cbd5e1",
              border: "none",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Products
          </button>

          {dropdownOpen && (
            <div
              id="products-dropdown"
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                background: "#fff",
                borderRadius: 8,
                boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
                padding: "8px 0",
                minWidth: 180,
                zIndex: 100,
              }}
            >
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: "10px 16px",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#334155",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        <a href="#" style={{ color: "#cbd5e1", textDecoration: "none", fontSize: 14 }}>About</a>
        <a href="#" style={{ color: "#cbd5e1", textDecoration: "none", fontSize: 14 }}>Contact</a>
      </nav>

      <div className="container" style={{ maxWidth: 800, margin: "32px auto", padding: "0 24px" }}>
        {selectedCategory && (
          <div
            id="category-banner"
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 8,
              padding: "12px 20px",
              marginBottom: 24,
              color: "#1e40af",
              fontWeight: 600,
            }}
          >
            Showing products in: {selectedCategory}
          </div>
        )}

        <div className="card" style={{ padding: 0 }}>
          <h2 style={{ padding: "16px 20px", margin: 0, borderBottom: "1px solid #e2e8f0" }}>
            Product Inventory
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: "10px 20px", fontSize: 13, color: "#64748b" }}>Product</th>
                <th style={{ textAlign: "left", padding: "10px 20px", fontSize: 13, color: "#64748b" }}>Price</th>
                <th style={{ textAlign: "center", padding: "10px 20px", fontSize: 13, color: "#64748b" }}>Info</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((product) => (
                <tr key={product.name} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 20px", fontSize: 14 }}>{product.name}</td>
                  <td style={{ padding: "12px 20px", fontSize: 14 }}>{product.price}</td>
                  <td style={{ padding: "12px 20px", textAlign: "center", position: "relative" }}>
                    <span
                      data-sku={product.sku}
                      aria-label={`Info for ${product.name}`}
                      onMouseOver={() => setVisibleTooltip(product.name)}
                      onMouseEnter={() => setVisibleTooltip(product.name)}
                      onMouseLeave={() => setVisibleTooltip(null)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "#e2e8f0",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#475569",
                      }}
                    >
                      i
                    </span>
                    {visibleTooltip === product.name && (
                      <div
                        className="tooltip"
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 4px)",
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "#0f172a",
                          color: "#f8fafc",
                          padding: "6px 12px",
                          borderRadius: 6,
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          zIndex: 50,
                        }}
                      >
                        SKU: {product.sku}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Search box */}
        <div className="card" style={{ padding: 20, marginTop: 24 }}>
          <h3 style={{ marginBottom: 12 }}>Search by SKU</h3>
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
            <input
              id="sku-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter SKU"
              style={{
                flex: 1,
                padding: "10px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: "10px 20px" }}
            >
              Search
            </button>
          </form>
          {searchSubmitted && (
            <p id="search-result" style={{ marginTop: 12, color: "#16a34a", fontWeight: 600 }}>
              Search completed for: {searchQuery}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
