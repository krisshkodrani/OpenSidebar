import { useEffect, useMemo, useState } from "react";

const RECORDS = {
  alpha: {
    title: "Alpha Operations Report",
    headlineMetric: "P95 response time",
    value: "184 ms",
    owner: "Mira Chen",
    status: "Green",
    note: "Checkout API latency is below the 250 ms threshold.",
  },
  beta: {
    title: "Beta Support Report",
    headlineMetric: "Open escalation queue",
    value: "37 tickets",
    owner: "Devon Patel",
    status: "Watch",
    note: "Weekend queue depth is up 12 tickets from the prior report.",
  },
};

function pageUrl(view: string): string {
  return `/parallel-work?view=${view}`;
}

function Hub() {
  return (
    <main className="fixture-static" style={{ padding: "32px 24px" }}>
      <section className="card" style={{ maxWidth: 920, margin: "0 auto" }}>
        <h1>Parallel Work Lab</h1>
        <p style={{ marginTop: 8, color: "#475569", lineHeight: 1.6 }}>
          This hub exposes two independent read-only reports and one shared form
          for scheduler validation.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginTop: 24,
          }}
        >
          {Object.entries(RECORDS).map(([key, record]) => (
            <a
              key={key}
              href={pageUrl(key)}
              style={{
                display: "block",
                padding: 16,
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                color: "#0f172a",
                textDecoration: "none",
                background: "#fff",
              }}
            >
              <strong>{record.title}</strong>
              <div style={{ marginTop: 8, color: "#64748b" }}>
                {record.headlineMetric}: {record.value}
              </div>
            </a>
          ))}
          <a
            href={pageUrl("shared-form")}
            style={{
              display: "block",
              padding: 16,
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              color: "#0f172a",
              textDecoration: "none",
              background: "#fff",
            }}
          >
            <strong>Shared Work Form</strong>
            <div style={{ marginTop: 8, color: "#64748b" }}>
              One form target for serialization checks.
            </div>
          </a>
        </div>
      </section>
    </main>
  );
}

function Report({ reportKey }: { reportKey: "alpha" | "beta" }) {
  const record = RECORDS[reportKey];
  return (
    <main className="fixture-static" style={{ padding: "32px 24px" }}>
      <section className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
        <a href="/parallel-work" style={{ color: "#2563eb" }}>
          Back to Parallel Work Lab
        </a>
        <h1 style={{ marginTop: 16 }}>{record.title}</h1>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            gap: "12px 16px",
            marginTop: 24,
          }}
        >
          <dt>Headline metric</dt>
          <dd>
            {record.headlineMetric}: <strong>{record.value}</strong>
          </dd>
          <dt>Owner</dt>
          <dd>{record.owner}</dd>
          <dt>Status</dt>
          <dd>{record.status}</dd>
          <dt>Report note</dt>
          <dd>{record.note}</dd>
        </dl>
      </section>
    </main>
  );
}

function SharedForm() {
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    (window as any).__parallelWorkFormState = {
      primary,
      secondary,
      submitted,
    };
  }, [primary, secondary, submitted]);

  return (
    <main className="fixture-static" style={{ padding: "32px 24px" }}>
      <section className="card" style={{ maxWidth: 640, margin: "0 auto" }}>
        <a href="/parallel-work" style={{ color: "#2563eb" }}>
          Back to Parallel Work Lab
        </a>
        <h1 style={{ marginTop: 16 }}>Shared Work Form</h1>
        <p style={{ marginTop: 8, color: "#475569", lineHeight: 1.6 }}>
          Both fields belong to one mutable form resource. Concurrent updates to
          this page should serialize.
        </p>
        <div className="field" style={{ marginTop: 20 }}>
          <label htmlFor="parallel-primary">Primary label</label>
          <input
            id="parallel-primary"
            value={primary}
            onChange={(event) => {
              setSubmitted(false);
              setPrimary(event.target.value);
            }}
            placeholder="Primary label"
          />
        </div>
        <div className="field">
          <label htmlFor="parallel-secondary">Secondary label</label>
          <input
            id="parallel-secondary"
            value={secondary}
            onChange={(event) => {
              setSubmitted(false);
              setSecondary(event.target.value);
            }}
            placeholder="Secondary label"
          />
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 16 }}
          onClick={() => setSubmitted(true)}
        >
          Submit shared form
        </button>
        {submitted ? (
          <div
            role="status"
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              background: "#ecfdf5",
              color: "#065f46",
            }}
          >
            Shared form submitted with Primary label {primary || "(blank)"} and
            Secondary label {secondary || "(blank)"}.
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default function ParallelWork() {
  const view = useMemo(
    () => new URLSearchParams(window.location.search).get("view") ?? "hub",
    [],
  );

  if (view === "alpha" || view === "beta") {
    return <Report reportKey={view} />;
  }
  if (view === "shared-form") return <SharedForm />;
  return <Hub />;
}
