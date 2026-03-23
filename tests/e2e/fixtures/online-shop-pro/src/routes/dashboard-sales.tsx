export default function DashboardSales() {
  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Sales Dashboard</h1>
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
            <div className="stat-label">Total Revenue</div>
            <div className="stat-value">$284,500</div>
            <div className="stat-change positive">+18% from last quarter</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Orders This Month</div>
            <div className="stat-value">1,423</div>
            <div className="stat-change positive">+7% from last month</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Top Product</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              Wireless Pro Headphones
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Conversion Rate</div>
            <div className="stat-value">3.8%</div>
            <div className="stat-change positive">+0.5% from last month</div>
          </div>
        </div>

        <div className="card">
          <h3>Top Products</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Units Sold</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Wireless Pro Headphones</td>
                <td>342</td>
                <td>$51,300</td>
              </tr>
              <tr>
                <td>Ultra Running Shoes</td>
                <td>289</td>
                <td>$43,350</td>
              </tr>
              <tr>
                <td>Smart Fitness Watch</td>
                <td>215</td>
                <td>$32,250</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
