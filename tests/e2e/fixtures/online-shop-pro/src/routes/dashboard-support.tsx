export default function DashboardSupport() {
  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Support Dashboard</h1>
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
            <div className="stat-label">Open Tickets</div>
            <div className="stat-value">47</div>
            <div className="stat-change positive">-12% from last week</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Resolution Time</div>
            <div className="stat-value">4.2 hours</div>
            <div className="stat-change positive">-8% from last month</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Satisfaction Score</div>
            <div className="stat-value">92%</div>
            <div className="stat-change positive">+3% from last quarter</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Top Issue</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              Billing Inquiries
            </div>
          </div>
        </div>

        <div className="card">
          <h3>Recent Tickets</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>#4521</td>
                <td>Payment not processed</td>
                <td>Open</td>
                <td>High</td>
              </tr>
              <tr>
                <td>#4520</td>
                <td>Shipping delay inquiry</td>
                <td>In Progress</td>
                <td>Medium</td>
              </tr>
              <tr>
                <td>#4519</td>
                <td>Return request</td>
                <td>Resolved</td>
                <td>Low</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
