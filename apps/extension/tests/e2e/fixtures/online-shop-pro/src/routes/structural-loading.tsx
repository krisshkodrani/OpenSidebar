import { useState, useEffect } from "react";

/**
 * Structural Loading fixture — simulates a page (like LinkedIn) where the word
 * "loading" is always present in the DOM as part of lazy-load containers, even
 * after all interactive content has finished rendering.
 *
 * Tests that the agent's async change detection correctly ignores structural
 * "loading" text and doesn't get stuck in a click→wait→done(rejected) loop.
 *
 * The page has:
 * - A permanent "loading more items..." lazy-load footer (always in DOM)
 * - A "Compose Message" button that opens a composer panel after a short delay
 * - The agent must click the button, see the composer, and report done
 */
export default function StructuralLoading() {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerReady, setComposerReady] = useState(false);

  const openComposer = () => {
    setComposerOpen(true);
    // Simulate brief render delay (300ms) before composer is ready
    setTimeout(() => setComposerReady(true), 300);
  };

  // Expose state for test verification
  useEffect(() => {
    (window as any).__composerReady = composerReady;
  }, [composerReady]);

  return (
    <div style={{ padding: "2rem", maxWidth: 700, margin: "0 auto" }}>
      <h1>Social Feed</h1>
      <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
        Welcome to your feed. Click "Compose Message" to open the message editor.
      </p>

      {/* Feed items */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
        {["Alice shared a photo", "Bob commented on your post", "Carol started a project"].map(
          (item, i) => (
            <div
              key={i}
              style={{
                padding: "1rem",
                background: "#f9fafb",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
              }}
            >
              {item}
            </div>
          ),
        )}
      </div>

      {/* Compose button */}
      {!composerOpen && (
        <button
          aria-label="Compose Message"
          onClick={openComposer}
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "0.75rem 1.5rem",
            cursor: "pointer",
            fontSize: 16,
            marginBottom: "1.5rem",
          }}
        >
          Compose Message
        </button>
      )}

      {/* Composer panel — appears after button click */}
      {composerOpen && (
        <div
          data-testid="composer"
          style={{
            padding: "1.5rem",
            background: "#eff6ff",
            border: "1px solid #93c5fd",
            borderRadius: 8,
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: 18 }}>
            Message Composer
          </h2>
          {composerReady ? (
            <>
              <textarea
                aria-label="Message body"
                placeholder="Write your message here..."
                rows={4}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  borderRadius: 4,
                  border: "1px solid #d1d5db",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
                <button style={{ padding: "0.5rem 1rem", borderRadius: 4, background: "#2563eb", color: "white", border: "none" }}>
                  Send
                </button>
                <button
                  onClick={() => { setComposerOpen(false); setComposerReady(false); }}
                  style={{ padding: "0.5rem 1rem", borderRadius: 4, background: "#e5e7eb", border: "none" }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: "#6b7280" }}>Preparing editor...</p>
          )}
        </div>
      )}

      {/* ─── STRUCTURAL "LOADING" ───
          This element is ALWAYS present in the DOM, simulating how sites
          like LinkedIn have permanent "loading" text in lazy-load containers.
          The agent must NOT treat this as a transient loading indicator. */}
      <div
        aria-label="loading more items"
        style={{
          padding: "0.75rem",
          textAlign: "center",
          color: "#9ca3af",
          fontSize: 13,
          borderTop: "1px solid #f3f4f6",
        }}
      >
        <span role="status">loading more items...</span>
      </div>

      {/* Second structural loading element — aria attribute */}
      <div
        aria-busy="false"
        data-state="loading"
        style={{ display: "none" }}
      >
        Lazy load placeholder
      </div>
    </div>
  );
}
