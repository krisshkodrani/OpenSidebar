import { useState } from "react";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [settingsEmail, setSettingsEmail] = useState("");
  const [settings, setSettings] = useState({
    timezone: "UTC",
    emailNotifications: true,
    weeklyDigest: false,
  });
  const [saveStatus, setSaveStatus] = useState("");
  const [notification, setNotification] = useState("");

  const handleSaveSettings = () => {
    setSaveStatus("saving");
    setTimeout(() => {
      setSaveStatus("saved");
      setNotification("Settings saved successfully!");
      // Export result for e2e test detection
      (window as any).dashboardSettings = {
        email: settingsEmail,
        timezone: settings.timezone,
        savedAt: new Date().toISOString(),
      };
      setTimeout(() => setNotification(""), 3000);
    }, 1000);
  };

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Analytics Dashboard</h1>
      </div>

      <div style={{ padding: "0 24px", maxWidth: 1200, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 24,
            borderBottom: "1px solid #e2e8f0",
            paddingBottom: 12,
          }}
        >
          <button
            className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            Overview
          </button>
          <button
            className={`tab-btn ${activeTab === "reports" ? "active" : ""}`}
            onClick={() => setActiveTab("reports")}
          >
            Reports
          </button>
          <button
            className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            Settings
          </button>
        </div>

        {activeTab === "overview" && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div className="stat-card">
                <div className="stat-label">Total Users</div>
                <div className="stat-value">12,847</div>
                <div className="stat-change positive">
                  ↑ 12% from last month
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Revenue</div>
                <div className="stat-value">$48,392</div>
                <div className="stat-change positive">↑ 8% from last month</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Bounce Rate</div>
                <div className="stat-value">42.3%</div>
                <div className="stat-change negative">↑ 3% from last month</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Avg. Session</div>
                <div className="stat-value">4m 32s</div>
                <div className="stat-change positive">
                  ↓ 12% from last month
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Traffic Sources</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Visitors</th>
                    <th>Change</th>
                    <th>Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Google Search</td>
                    <td>5,234</td>
                    <td style={{ color: "#16a34a" }}>+15%</td>
                    <td>3.2%</td>
                  </tr>
                  <tr>
                    <td>Direct</td>
                    <td>3,891</td>
                    <td style={{ color: "#16a34a" }}>+8%</td>
                    <td>2.8%</td>
                  </tr>
                  <tr>
                    <td>Social Media</td>
                    <td>2,145</td>
                    <td style={{ color: "#dc2626" }}>-5%</td>
                    <td>1.9%</td>
                  </tr>
                  <tr>
                    <td>Referral</td>
                    <td>1,577</td>
                    <td style={{ color: "#16a34a" }}>+22%</td>
                    <td>4.1%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "reports" && (
          <div className="card">
            <h3>Available Reports</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 16,
                marginTop: 16,
              }}
            >
              <div className="report-card">
                <h4>Monthly Performance</h4>
                <p>Comprehensive monthly analytics report</p>
                <button className="btn btn-primary btn-sm">Download</button>
              </div>
              <div className="report-card">
                <h4>User Engagement</h4>
                <p>User interaction and engagement metrics</p>
                <button className="btn btn-primary btn-sm">Download</button>
              </div>
              <div className="report-card">
                <h4>Conversion Funnel</h4>
                <p>Detailed conversion analysis</p>
                <button className="btn btn-primary btn-sm">Download</button>
              </div>
              <div className="report-card">
                <h4>Traffic Breakdown</h4>
                <p>Detailed traffic source analysis</p>
                <button className="btn btn-primary btn-sm">Download</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="card">
            <h3>Account Settings</h3>

            <div style={{ marginTop: 20 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Notification Email
              </label>
              <input
                id="settings-email"
                type="email"
                value={settingsEmail}
                onChange={(e) => setSettingsEmail(e.target.value)}
                placeholder="admin@example.com"
                style={{
                  width: "100%",
                  maxWidth: 300,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
            </div>

            <div style={{ marginTop: 20 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Timezone
              </label>
              <select
                value={settings.timezone}
                onChange={(e) =>
                  setSettings({ ...settings, timezone: e.target.value })
                }
                style={{
                  width: "100%",
                  maxWidth: 300,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              >
                <option value="UTC">UTC</option>
                <option value="EST">Eastern Time (EST)</option>
                <option value="PST">Pacific Time (PST)</option>
                <option value="GMT">Greenwich Mean Time (GMT)</option>
              </select>
            </div>

            <button
              className="btn btn-primary"
              onClick={handleSaveSettings}
              style={{ marginTop: 24 }}
            >
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved!"
                  : "Save"}
            </button>

            {notification && (
              <div
                id="settings-toast"
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: "#dcfce7",
                  borderRadius: 8,
                  color: "#166534",
                }}
              >
                {notification}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
