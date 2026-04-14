import { useState } from "react";

const VALID_EMAIL = "admin@example.com";
const VALID_PASSWORD = "secret123";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (email !== VALID_EMAIL || password !== VALID_PASSWORD) {
      setError("Invalid email or password.");
      return;
    }

    // Simulate auth delay
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setAuthenticated(true);
      (window as any).loginResult = {
        authenticated: true,
        email,
        rememberMe,
      };
    }, 1000);
  };

  if (authenticated) {
    return (
      <div className="fixture-static" style={{ minHeight: "100vh" }}>
        <div className="header">
          <h1>Dashboard</h1>
        </div>
        <div className="container" style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}>
          <div className="card" style={{ padding: 32, textAlign: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#dcfce7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: 28,
              }}
            >
              A
            </div>
            <h2 id="welcome-message" style={{ marginBottom: 8 }}>Welcome, Admin!</h2>
            <p style={{ color: "#64748b", marginBottom: 24 }}>
              You are logged in as <strong>{email}</strong>
            </p>
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 8,
                padding: 16,
                textAlign: "left",
                fontSize: 14,
              }}
            >
              <p><strong>Session Info</strong></p>
              <p style={{ color: "#64748b", marginTop: 8 }}>Email: {email}</p>
              <p style={{ color: "#64748b" }}>Remember me: {rememberMe ? "Yes" : "No"}</p>
              <p style={{ color: "#64748b" }}>Logged in at: {new Date().toLocaleTimeString()}</p>
            </div>
            <button
              onClick={() => {
                setAuthenticated(false);
                setEmail("");
                setPassword("");
                setRememberMe(false);
                (window as any).loginResult = undefined;
              }}
              style={{
                marginTop: 24,
                background: "#f1f5f9",
                color: "#475569",
                border: "1px solid #e2e8f0",
                padding: "10px 24px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Sign In</h1>
        <p>Log in to access your dashboard.</p>
      </div>

      <div className="container" style={{ maxWidth: 420, margin: "32px auto", padding: "0 24px" }}>
        <div className="card" style={{ padding: 32 }}>
          <h2 style={{ marginBottom: 24, textAlign: "center" }}>Log In</h2>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="login-email"
                style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="login-password"
                style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}
              >
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                Remember me
              </label>
            </div>

            {error && (
              <p
                id="login-error"
                style={{
                  color: "#dc2626",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 14,
                  marginBottom: 16,
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "12px 20px",
                background: loading ? "#94a3b8" : "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: loading ? "default" : "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              {loading ? "Signing in..." : "Log In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
