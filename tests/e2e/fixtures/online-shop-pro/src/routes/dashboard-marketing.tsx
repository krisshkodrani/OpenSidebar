export default function DashboardMarketing() {
  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Marketing Dashboard</h1>
      </div>

      <div style={{ padding: "0 24px", maxWidth: 1200, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            margin: "24px 0",
          }}
        >
          <div className="stat-card">
            <div className="stat-label">Active Campaigns</div>
            <div className="stat-value">12</div>
            <div className="stat-change positive">+2 from last month</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Ad Spend</div>
            <div className="stat-value">$45,200</div>
            <div className="stat-change negative">+15% from last month</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Click-Through Rate</div>
            <div className="stat-value">2.4%</div>
            <div className="stat-change positive">+0.3% from last month</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Best Channel</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              Email Marketing
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Campaign Performance</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Impressions</th>
                <th>CTR</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Spring Sale Email</td>
                <td>125,000</td>
                <td>3.8%</td>
              </tr>
              <tr>
                <td>Social Media Push</td>
                <td>89,400</td>
                <td>2.1%</td>
              </tr>
              <tr>
                <td>Retargeting Ads</td>
                <td>67,200</td>
                <td>1.9%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
