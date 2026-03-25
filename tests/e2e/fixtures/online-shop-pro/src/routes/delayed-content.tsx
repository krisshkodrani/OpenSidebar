import { useState, useEffect } from "react";

/**
 * Delayed Content fixture — tests that the agent waits for AJAX content
 * before reading the page. A button triggers a simulated API call (500ms delay),
 * after which a secret code appears. The agent must read the code AFTER it loads.
 */
export default function DelayedContent() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    setData(null);
    // Simulate AJAX call with 500ms delay
    fetch("/api/delayed-data")
      .catch(() => {}) // fetch will fail (no server), use timeout fallback
      .finally(() => {
        // Always set data after 500ms regardless of fetch result
        setTimeout(() => {
          setData("SECRET-CODE-7X9Q2");
          setLoading(false);
        }, 500);
      });
  };

  // Expose state for test verification
  useEffect(() => {
    (window as any).__delayedData = data;
  }, [data]);

  return (
    <div className="fixture-static" style={{ padding: "2rem", maxWidth: 600, margin: "0 auto" }}>
      <h1>Delayed Content Test</h1>
      <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
        Click the button below to load data. A secret code will appear after a short delay.
      </p>

      <button
        aria-label="Load Data"
        onClick={loadData}
        disabled={loading}
        style={{
          background: loading ? "#9ca3af" : "#2563eb",
          color: "white",
          border: "none",
          borderRadius: 6,
          padding: "0.75rem 1.5rem",
          cursor: loading ? "wait" : "pointer",
          fontSize: 16,
        }}
      >
        {loading ? "Loading..." : "Load Data"}
      </button>

      {loading && (
        <div
          data-testid="loading-indicator"
          style={{ marginTop: "1rem", color: "#6b7280" }}
        >
          Fetching data, please wait...
        </div>
      )}

      {data && (
        <div
          data-testid="result"
          style={{
            marginTop: "1.5rem",
            padding: "1rem",
            background: "#ecfdf5",
            border: "1px solid #6ee7b7",
            borderRadius: 8,
          }}
        >
          <strong>Result:</strong> The secret code is <code data-testid="secret-code">{data}</code>
        </div>
      )}
    </div>
  );
}
