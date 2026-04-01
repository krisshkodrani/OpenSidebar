/**
 * Go-back navigation fixture: A 3-page chain linked by in-page navigation.
 * Page 1 → Page 2 → Page 3 (each has unique data).
 * The agent navigates forward to collect data, then uses breadcrumbs to
 * return to earlier pages and collect their data too.
 *
 * Uses window.location for real page loads (not SPA pushState).
 */

const PAGES = [
  { step: 1, name: "Warehouse Alpha", location: "Portland, Oregon", inventory: "4,827" },
  { step: 2, name: "Warehouse Beta", location: "Austin, Texas", inventory: "3,156" },
  { step: 3, name: "Warehouse Gamma", location: "Chicago, Illinois", inventory: "6,412" },
];

function Breadcrumbs({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 16, fontSize: 14 }}>
      {PAGES.map((page, i) => (
        <span key={page.step}>
          {i > 0 && <span style={{ margin: "0 6px", color: "#94a3b8" }}>/</span>}
          {page.step === currentStep ? (
            <strong style={{ color: "#1e293b" }}>{page.name}</strong>
          ) : (
            <a
              href={`/go-back-chain?step=${page.step}`}
              onClick={(e) => {
                e.preventDefault();
                window.location.href = `/go-back-chain?step=${page.step}`;
              }}
              style={{ color: "#3b82f6", textDecoration: "underline", cursor: "pointer" }}
            >
              {page.name}
            </a>
          )}
        </span>
      ))}
    </nav>
  );
}

export default function GoBackChain() {
  const params = new URLSearchParams(window.location.search);
  const step = parseInt(params.get("step") || "1", 10);
  const page = PAGES.find((p) => p.step === step) || PAGES[0];
  const nextPage = PAGES.find((p) => p.step === step + 1);

  const handleNext = (nextStep: number) => {
    window.location.href = `/go-back-chain?step=${nextStep}`;
  };

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Navigation Chain — Page {step} of 3</h1>
      </div>

      <div style={{ padding: "24px", maxWidth: 600, margin: "0 auto" }}>
        <Breadcrumbs currentStep={step} />

        <div className="card" style={{ padding: 24 }}>
          <h2>{page.name}</h2>
          <p style={{ marginTop: 12, fontSize: 15 }}>
            This warehouse is located in <strong>{page.location}</strong>.
          </p>
          <p id={`page${step}-data`} style={{ marginTop: 8, color: "#3b82f6", fontWeight: 600 }}>
            Inventory count: {page.inventory} units
          </p>
          {nextPage && (
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => handleNext(nextPage.step)}
            >
              Go to {nextPage.name} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
