import { useState, useRef, useEffect } from "react";

const ADDRESSES = [
  "123 Main Street, Springfield, IL 62704",
  "123 Main Avenue, Portland, OR 97201",
  "123 Mainway Drive, Austin, TX 78701",
  "1234 Maine Boulevard, Denver, CO 80202",
  "12 Maple Street, Boston, MA 02101",
];

const PRODUCT_OPTIONS = [
  "Laptop",
  "Laptop Stand",
  "Lap Desk",
  "Lamp",
  "Laminator",
];

export default function Autocomplete() {
  // Address autocomplete state
  const [addressInput, setAddressInput] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const addressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Product autocomplete state
  const [productInput, setProductInput] = useState("");
  const [productSuggestions, setProductSuggestions] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const productTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expose results for test assertions
  useEffect(() => {
    (window as any).autocompleteResult = {
      address: selectedAddress,
      product: selectedProduct,
    };
  });

  // Address input handler with debounce
  const handleAddressChange = (value: string) => {
    setAddressInput(value);
    setSelectedAddress("");
    if (addressTimerRef.current) clearTimeout(addressTimerRef.current);

    if (value.length < 2) {
      setAddressSuggestions([]);
      setAddressDropdownOpen(false);
      return;
    }

    // 300ms debounce to simulate API call
    addressTimerRef.current = setTimeout(() => {
      const matches = ADDRESSES.filter((a) =>
        a.toLowerCase().includes(value.toLowerCase()),
      );
      setAddressSuggestions(matches);
      setAddressDropdownOpen(matches.length > 0);
    }, 300);
  };

  const selectAddress = (addr: string) => {
    setAddressInput(addr);
    setSelectedAddress(addr);
    setAddressDropdownOpen(false);
    setAddressSuggestions([]);
  };

  // Product input handler with debounce
  const handleProductChange = (value: string) => {
    setProductInput(value);
    setSelectedProduct("");
    if (productTimerRef.current) clearTimeout(productTimerRef.current);

    if (value.length < 2) {
      setProductSuggestions([]);
      setProductDropdownOpen(false);
      return;
    }

    productTimerRef.current = setTimeout(() => {
      const matches = PRODUCT_OPTIONS.filter((p) =>
        p.toLowerCase().includes(value.toLowerCase()),
      );
      setProductSuggestions(matches);
      setProductDropdownOpen(matches.length > 0);
    }, 300);
  };

  const selectProduct = (prod: string) => {
    setProductInput(prod);
    setSelectedProduct(prod);
    setProductDropdownOpen(false);
    setProductSuggestions([]);
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Autocomplete & Typeahead</h1>
        <p>Test agent interaction with suggestion dropdowns that appear after typing.</p>
      </div>

      <div className="container" style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}>
        {/* Address autocomplete */}
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 style={{ marginBottom: 16 }}>Shipping Address</h2>
          <div style={{ position: "relative" }}>
            <label
              htmlFor="address-input"
              style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}
            >
              Address
            </label>
            <input
              id="address-input"
              type="text"
              value={addressInput}
              onChange={(e) => handleAddressChange(e.target.value)}
              onFocus={() => {
                if (addressSuggestions.length > 0) setAddressDropdownOpen(true);
              }}
              placeholder="Start typing an address..."
              autoComplete="off"
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            />
            {addressDropdownOpen && addressSuggestions.length > 0 && (
              <ul
                id="address-suggestions"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0 0 8px 8px",
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  maxHeight: 200,
                  overflowY: "auto",
                  zIndex: 50,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
              >
                {addressSuggestions.map((addr) => (
                  <li
                    key={addr}
                    onClick={() => selectAddress(addr)}
                    style={{
                      padding: "10px 14px",
                      cursor: "pointer",
                      fontSize: 14,
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {addr}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selectedAddress && (
            <p
              id="address-confirmed"
              style={{ marginTop: 12, color: "#16a34a", fontWeight: 600, fontSize: 14 }}
            >
              Selected: {selectedAddress}
            </p>
          )}
        </div>

        {/* Product search */}
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2 style={{ marginBottom: 16 }}>Product Search</h2>
          <div style={{ position: "relative" }}>
            <label
              htmlFor="product-input"
              style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}
            >
              Search Products
            </label>
            <input
              id="product-input"
              type="text"
              value={productInput}
              onChange={(e) => handleProductChange(e.target.value)}
              onFocus={() => {
                if (productSuggestions.length > 0) setProductDropdownOpen(true);
              }}
              placeholder="Type to search products..."
              autoComplete="off"
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            />
            {productDropdownOpen && productSuggestions.length > 0 && (
              <ul
                id="product-suggestions"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0 0 8px 8px",
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  maxHeight: 200,
                  overflowY: "auto",
                  zIndex: 50,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
              >
                {productSuggestions.map((prod) => (
                  <li
                    key={prod}
                    onClick={() => selectProduct(prod)}
                    style={{
                      padding: "10px 14px",
                      cursor: "pointer",
                      fontSize: 14,
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {prod}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selectedProduct && (
            <p
              id="product-confirmed"
              style={{ marginTop: 12, color: "#16a34a", fontWeight: 600, fontSize: 14 }}
            >
              Selected: {selectedProduct}
            </p>
          )}
        </div>

        {/* Summary */}
        {selectedAddress && selectedProduct && (
          <div
            id="autocomplete-summary"
            className="card"
            style={{
              padding: 20,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
            }}
          >
            <h3 style={{ color: "#166534", marginBottom: 8 }}>All selections complete!</h3>
            <p style={{ fontSize: 14 }}>Address: {selectedAddress}</p>
            <p style={{ fontSize: 14 }}>Product: {selectedProduct}</p>
          </div>
        )}
      </div>
    </div>
  );
}
