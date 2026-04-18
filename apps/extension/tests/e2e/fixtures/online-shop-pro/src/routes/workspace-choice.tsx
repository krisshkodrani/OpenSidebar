import { useEffect, useState } from "react";

const WORKSPACES = [
  {
    id: "alpha",
    label: "Alpha Workspace",
    summary: "Legacy support backlog and handoff notes.",
  },
  {
    id: "beta",
    label: "Beta Workspace",
    summary: "Quarterly planning board and roadmap checkpoints.",
  },
];

export default function WorkspaceChoice() {
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);

  useEffect(() => {
    (window as any).__workspaceSelection = selectedWorkspace
      ? {
          workspace: selectedWorkspace,
          openedAt: Date.now(),
        }
      : null;
  }, [selectedWorkspace]);

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Workspace Selector</h1>
        <p>Choose a workspace to continue into the planning board.</p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 860, margin: "32px auto", padding: "0 24px" }}
      >
        <div className="card" style={{ padding: 32 }}>
          <div
            id="workspace-guidance"
            data-testid="workspace-guidance"
            style={{
              background: "#fff7ed",
              border: "1px solid #fdba74",
              borderRadius: 12,
              color: "#9a3412",
              marginBottom: 24,
              padding: 20,
            }}
          >
            <strong>Important:</strong> The correct workspace is intentionally not
            specified on this page. Ask the user which workspace to open before
            clicking either button.
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {WORKSPACES.map((workspace) => (
              <section
                key={workspace.id}
                data-testid={`workspace-${workspace.id}`}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                <h2 style={{ marginBottom: 8 }}>{workspace.label}</h2>
                <p style={{ color: "#64748b", marginBottom: 16 }}>
                  {workspace.summary}
                </p>
                <button
                  id={`open-${workspace.id}`}
                  onClick={() => setSelectedWorkspace(workspace.label)}
                  style={{
                    background: "#0f172a",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    padding: "10px 18px",
                  }}
                >
                  Open {workspace.label}
                </button>
              </section>
            ))}
          </div>

          {selectedWorkspace ? (
            <div
              id="workspace-selection-result"
              data-testid="workspace-selection-result"
              style={{
                background: "#ecfdf5",
                border: "1px solid #6ee7b7",
                borderRadius: 12,
                color: "#047857",
                marginTop: 24,
                padding: 20,
              }}
            >
              Opened <strong>{selectedWorkspace}</strong>.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
