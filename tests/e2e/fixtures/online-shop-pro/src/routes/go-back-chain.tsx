/**
 * Go-back navigation fixture: A 3-page chain linked by in-page navigation.
 * Page 1 → Page 2 → Page 3 (each has unique data).
 * The agent reads from Page 3, then must go_back twice to return to Page 1.
 *
 * Uses window.location for real history entries (not SPA pushState)
 * so that go_back actually works via browser history.
 *
 * Since the fixture SPA uses window.location.href for nav, each page is
 * a fresh load with a real history entry.
 */
export default function GoBackChain() {
  const params = new URLSearchParams(window.location.search);
  const step = parseInt(params.get("step") || "1", 10);

  const handleNext = (nextStep: number) => {
    window.location.href = `/go-back-chain?step=${nextStep}`;
  };

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Navigation Chain — Page {step} of 3</h1>
      </div>

      <div style={{ padding: "24px", maxWidth: 600, margin: "0 auto" }}>
        {step === 1 && (
          <div className="card" style={{ padding: 24 }}>
            <h2>Warehouse Alpha</h2>
            <p style={{ marginTop: 12, fontSize: 15 }}>
              This warehouse is located in <strong>Portland, Oregon</strong>.
            </p>
            <p id="page1-data" style={{ marginTop: 8, color: "#3b82f6", fontWeight: 600 }}>
              Inventory count: 4,827 units
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => handleNext(2)}
            >
              Go to Warehouse Beta →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="card" style={{ padding: 24 }}>
            <h2>Warehouse Beta</h2>
            <p style={{ marginTop: 12, fontSize: 15 }}>
              This warehouse is located in <strong>Austin, Texas</strong>.
            </p>
            <p id="page2-data" style={{ marginTop: 8, color: "#3b82f6", fontWeight: 600 }}>
              Inventory count: 3,156 units
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => handleNext(3)}
            >
              Go to Warehouse Gamma →
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="card" style={{ padding: 24 }}>
            <h2>Warehouse Gamma</h2>
            <p style={{ marginTop: 12, fontSize: 15 }}>
              This warehouse is located in <strong>Chicago, Illinois</strong>.
            </p>
            <p id="page3-data" style={{ marginTop: 8, color: "#3b82f6", fontWeight: 600 }}>
              Inventory count: 6,412 units
            </p>
            <p style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>
              Use the browser back button or go_back to return to previous warehouses.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
