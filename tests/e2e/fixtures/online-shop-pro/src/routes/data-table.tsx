import { useState, useEffect, useMemo } from "react";

// Generate 50 employees with deterministic data
const DEPARTMENTS = ["Engineering", "Sales", "Marketing", "HR", "Finance", "Operations", "Legal", "Support"];
const FIRST_NAMES = [
  "Alice", "Bob", "Carol", "David", "Eve", "Frank", "Diana", "Henry",
  "Ivy", "Jack", "Karen", "Leo", "Mona", "Nick", "Olivia", "Paul",
  "Quinn", "Rita", "Sam", "Tina", "Uma", "Vic", "Wendy", "Xander",
  "Yara", "Zach", "Aria", "Blake", "Clara", "Derek", "Elena", "Felix",
  "Gina", "Hugo", "Isla", "Jude", "Kara", "Liam", "Mia", "Noel",
  "Opal", "Pete", "Rosa", "Sean", "Tara", "Uri", "Vera", "Wade",
  "Xena", "Yuri",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Chen", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
  "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White",
  "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young",
  "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
  "Carter", "Quinn",
];

interface Employee {
  id: number;
  name: string;
  email: string;
  department: string;
  salary: string;
}

function generateEmployees(): Employee[] {
  const employees: Employee[] = [];
  for (let i = 0; i < 50; i++) {
    const firstName = FIRST_NAMES[i];
    const lastName = LAST_NAMES[i];
    const dept = DEPARTMENTS[i % DEPARTMENTS.length];
    const baseSalary = 55000 + (i * 1731) % 60000;
    employees.push({
      id: i + 1,
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@company.com`,
      department: dept,
      salary: `$${baseSalary.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`,
    });
  }
  return employees;
}

const ALL_EMPLOYEES = generateEmployees();
const PAGE_SIZE = 5;

export default function DataTable() {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return ALL_EMPLOYEES;
    const q = searchQuery.toLowerCase();
    return ALL_EMPLOYEES.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Expose results for test assertions
  // Diana Chen is employee at index 49 (last) => page 10
  // But we want her on page 4, so let's check: index 15-19 is page 4
  // Let's make sure Diana Chen exists in the data
  useEffect(() => {
    const diana = ALL_EMPLOYEES.find((e) => e.name === "Diana Chen");
    const dianaPage = diana
      ? Math.ceil((ALL_EMPLOYEES.indexOf(diana) + 1) / PAGE_SIZE)
      : -1;

    // Page 7 engineering count
    const page7Start = (7 - 1) * PAGE_SIZE;
    const page7Data = ALL_EMPLOYEES.slice(page7Start, page7Start + PAGE_SIZE);
    const engCount = page7Data.filter((e) => e.department === "Engineering").length;

    (window as any).tableResult = {
      dianaFound: false,
      dianaSalary: diana?.salary || "",
      dianaPage,
      engineeringCount: engCount,
      totalEmployees: ALL_EMPLOYEES.length,
      currentPage,
    };
  });

  // Track when Diana's page is viewed
  useEffect(() => {
    const diana = pageData.find((e) => e.name.includes("Diana") || e.name.includes("Chen"));
    if (diana) {
      const prev = (window as any).tableResult || {};
      (window as any).tableResult = { ...prev, dianaFound: true, dianaSalary: diana.salary };
    }
  }, [pageData]);

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Employee Directory</h1>
        <p>Browse and search employees across departments. 50 employees, 5 per page.</p>
      </div>

      <div className="container" style={{ maxWidth: 900, margin: "32px auto", padding: "0 24px" }}>
        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            id="employee-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or department..."
            style={{
              width: "100%",
              padding: "10px 14px",
              fontSize: 14,
              borderRadius: 8,
              border: "1px solid #e2e8f0",
            }}
          />
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>#</th>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>Name</th>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>Email</th>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>Department</th>
                <th style={{ textAlign: "right", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>Salary</th>
              </tr>
            </thead>
            <tbody>
              {pageData.map((emp) => (
                <tr key={emp.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 16px", fontSize: 14, color: "#94a3b8" }}>{emp.id}</td>
                  <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 500 }}>{emp.name}</td>
                  <td style={{ padding: "10px 16px", fontSize: 14, color: "#64748b" }}>{emp.email}</td>
                  <td style={{ padding: "10px 16px", fontSize: 14 }}>
                    <span
                      style={{
                        background: emp.department === "Engineering" ? "#dbeafe" : "#f1f5f9",
                        color: emp.department === "Engineering" ? "#1e40af" : "#475569",
                        padding: "2px 10px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {emp.department}
                    </span>
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 14, textAlign: "right", fontFamily: "monospace" }}>
                    {emp.salary}
                  </td>
                </tr>
              ))}
              {pageData.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "#94a3b8" }}>
                    No employees found matching "{searchQuery}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 16,
            fontSize: 14,
          }}
        >
          <span style={{ color: "#64748b" }}>
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{
                padding: "6px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                background: currentPage === 1 ? "#f8fafc" : "#fff",
                color: currentPage === 1 ? "#cbd5e1" : "#334155",
                cursor: currentPage === 1 ? "default" : "pointer",
                fontSize: 13,
              }}
            >
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                style={{
                  padding: "6px 12px",
                  border: "1px solid",
                  borderColor: page === currentPage ? "#3b82f6" : "#e2e8f0",
                  borderRadius: 6,
                  background: page === currentPage ? "#3b82f6" : "#fff",
                  color: page === currentPage ? "#fff" : "#334155",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: page === currentPage ? 600 : 400,
                }}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{
                padding: "6px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                background: currentPage === totalPages ? "#f8fafc" : "#fff",
                color: currentPage === totalPages ? "#cbd5e1" : "#334155",
                cursor: currentPage === totalPages ? "default" : "pointer",
                fontSize: 13,
              }}
            >
              Next
            </button>
          </div>
        </div>

        {/* Page info */}
        <div style={{ marginTop: 12, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Page {currentPage} of {totalPages}
        </div>
      </div>
    </div>
  );
}
