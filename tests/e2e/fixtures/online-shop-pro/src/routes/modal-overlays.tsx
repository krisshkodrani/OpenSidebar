import { useState, useEffect } from "react";

export default function ModalOverlays() {
  const [cookieVisible, setCookieVisible] = useState(false);
  const [newsletterVisible, setNewsletterVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    // Both overlays appear immediately on mount
    setCookieVisible(true);
    setNewsletterVisible(true);
  }, []);

  // Track results on window for test assertions
  useEffect(() => {
    (window as any).modalResult = {
      cookieDismissed: !cookieVisible && email !== "", // dismissed AND form was accessible
      newsletterClosed: false,
      deleteConfirmed: deleted,
      formFilled: email.length > 0,
    };
  });

  const dismissCookie = () => {
    setCookieVisible(false);
  };

  const dismissNewsletter = () => {
    setNewsletterVisible(false);
    const prev = (window as any).modalResult || {};
    (window as any).modalResult = { ...prev, newsletterClosed: true };
  };

  const handleDelete = () => {
    setConfirmVisible(true);
  };

  const confirmDelete = () => {
    setConfirmVisible(false);
    setDeleted(true);
    (window as any).modalResult = {
      cookieDismissed: !cookieVisible,
      newsletterClosed: true,
      deleteConfirmed: true,
      formFilled: email.length > 0,
    };
  };

  const cancelDelete = () => {
    setConfirmVisible(false);
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Modal & Overlay Test Page</h1>
        <p>This page tests agent interaction with modals, banners, and popups.</p>
      </div>

      <div className="container" style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}>
        {/* Main content — behind overlays */}
        <div className="card" style={{ padding: 24, marginBottom: 24 }}>
          <h2>Account Settings</h2>
          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="account-email" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
              Notification Email
            </label>
            <input
              id="account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            />
          </div>
          <button
            className="btn"
            onClick={handleDelete}
            style={{
              background: "#ef4444",
              color: "#fff",
              border: "none",
              padding: "10px 20px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Delete Account
          </button>
          {deleted && (
            <p style={{ marginTop: 16, color: "#16a34a", fontWeight: 600 }}>
              Account deleted successfully.
            </p>
          )}
        </div>
      </div>

      {/* Cookie consent banner — fixed bottom */}
      {cookieVisible && (
        <div
          id="cookie-banner"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#1e293b",
            color: "#f1f5f9",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 9000,
            boxShadow: "0 -2px 10px rgba(0,0,0,0.3)",
          }}
        >
          <span style={{ fontSize: 14 }}>
            We use cookies to improve your experience. By continuing, you agree to our cookie policy.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={dismissCookie}
              style={{
                background: "#3b82f6",
                color: "#fff",
                border: "none",
                padding: "8px 20px",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Accept
            </button>
            <button
              onClick={dismissCookie}
              style={{
                background: "transparent",
                color: "#94a3b8",
                border: "1px solid #475569",
                padding: "8px 20px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Newsletter modal — centered overlay with backdrop */}
      {newsletterVisible && (
        <div
          id="newsletter-backdrop"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9500,
          }}
        >
          <div
            id="newsletter-modal"
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 32,
              width: 400,
              maxWidth: "90vw",
              position: "relative",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <button
              onClick={dismissNewsletter}
              aria-label="Close newsletter popup"
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "#64748b",
                lineHeight: 1,
                padding: "4px 8px",
              }}
            >
              X
            </button>
            <h3 style={{ marginBottom: 8, fontSize: 18 }}>Stay Updated!</h3>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16 }}>
              Subscribe to our newsletter for the latest updates and offers.
            </p>
            <input
              type="email"
              placeholder="Enter your email"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                marginBottom: 12,
                fontSize: 14,
              }}
            />
            <button
              style={{
                width: "100%",
                background: "#8b5cf6",
                color: "#fff",
                border: "none",
                padding: "10px 20px",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Subscribe
            </button>
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmVisible && (
        <div
          id="confirm-backdrop"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
        >
          <div
            id="confirm-dialog"
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              width: 360,
              maxWidth: "90vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <h3 style={{ marginBottom: 8, color: "#dc2626" }}>Confirm Deletion</h3>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>
              Are you sure you want to delete your account? This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={cancelDelete}
                style={{
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #e2e8f0",
                  padding: "8px 20px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  padding: "8px 20px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
