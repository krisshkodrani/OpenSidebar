import { useEffect, useMemo, useState } from "react";

const initialStatus = {
  version: "Beacon-17",
  slaBreaches: 4,
  refreshedAt: "09:20",
};

const updatedStatus = {
  version: "Beacon-18",
  slaBreaches: 9,
  refreshedAt: "10:05",
};

const dossierFacts = [
  ["Activation Code", "ORBIT-7321"],
  ["Quarterly Revenue", "$84,210"],
  ["Retention Rate", "91.6%"],
  ["Launch Owner", "Priya Shah"],
  ["Primary Risk", "Billing migration delay"],
  ["Support Queue", "27 tickets"],
  ["Northstar Segment", "Bluefin enterprise"],
  ["Escalation Window", "Friday 16:00 UTC"],
];

function buildResearchNotes(): string[] {
  const notes = [
    "Northstar note: Bluefin enterprise accounts are stable after the May retry fix.",
    "Billing migration delay remains the only blocker for the launch checklist.",
    "Priya Shah owns customer messaging and partner readiness for this release.",
  ];

  for (let i = 1; i <= 24; i += 1) {
    notes.push(
      `Context note ${i}: telemetry sample ${1200 + i} was reviewed and does not change the launch recommendation.`,
    );
  }

  notes.push(
    "Final evidence note: use ORBIT-7321 as the activation code in any launch memo.",
  );
  return notes;
}

export default function MemoryLab() {
  const [status, setStatus] = useState(initialStatus);
  const notes = useMemo(() => buildResearchNotes(), []);

  useEffect(() => {
    (window as any).__memoryLab = {
      facts: Object.fromEntries(dossierFacts),
      status,
      notes,
    };
  }, [notes, status]);

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Memory Lab Dashboard</h1>
        <p style={{ color: "#64748b", marginTop: 4 }}>
          Cross-run context and freshness fixture
        </p>
      </div>

      <main style={{ padding: "0 24px 48px", maxWidth: 1180, margin: "0 auto" }}>
        <section
          aria-label="Dossier facts"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          {dossierFacts.map(([label, value]) => (
            <div className="stat-card" key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize: 24 }}>
                {value}
              </div>
            </div>
          ))}
        </section>

        <section
          className="card"
          aria-label="Live operating status"
          style={{ marginBottom: 24 }}
        >
          <h3>Live Operating Status</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 16,
              marginTop: 16,
            }}
          >
            <div>
              <div className="stat-label">Dashboard Version</div>
              <div id="memory-lab-version" className="stat-value">
                {status.version}
              </div>
            </div>
            <div>
              <div className="stat-label">SLA Breaches</div>
              <div id="memory-lab-sla-breaches" className="stat-value">
                {status.slaBreaches}
              </div>
            </div>
            <div>
              <div className="stat-label">Last Refreshed</div>
              <div id="memory-lab-refreshed-at" className="stat-value">
                {status.refreshedAt}
              </div>
            </div>
          </div>
          <button
            id="memory-lab-refresh-status"
            className="btn btn-primary"
            style={{ marginTop: 18 }}
            onClick={() => setStatus(updatedStatus)}
          >
            Refresh live status
          </button>
        </section>

        <section className="card" aria-label="Research notes">
          <h3>Research Notes</h3>
          <div style={{ columns: 2, columnGap: 28, marginTop: 16 }}>
            {notes.map((note) => (
              <p key={note} style={{ breakInside: "avoid", lineHeight: 1.6 }}>
                {note}
              </p>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
