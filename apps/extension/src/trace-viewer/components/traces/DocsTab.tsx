import React from "react";

const workflowCards = [
  {
    title: "Install",
    command: "npm install",
    detail: "Install workspace dependencies once after cloning or pulling dependency changes.",
  },
  {
    title: "Build Extension",
    command: "npm run dist",
    detail: "Writes the loadable Chrome extension to dist/. Load or reload that folder in Chrome.",
  },
  {
    title: "Run Dev Stack",
    command: "npm run dev",
    detail: "Starts local services, this viewer, Vite/CRXJS, and writes dist-dev/ for Chrome.",
  },
  {
    title: "Maintain Traces",
    command: "npm run traces:compact",
    detail: "Backfills SQLite, then deletes raw trace files older than 7 days.",
  },
];

const commandRows = [
  {
    command: "npm run dev",
    use: "Start local development services",
    notes: "Load dist-dev/ while the shell is running.",
  },
  {
    command: "npm run dist",
    use: "Create a standalone extension build",
    notes: "Chrome Load unpacked path: dist/",
  },
  {
    command: "npm run build",
    use: "CI-compatible production build name",
    notes: "Equivalent production build path as dist/",
  },
  {
    command: "npm test",
    use: "Run fast extension/backend tests",
    notes: "Use focused Vitest commands while iterating.",
  },
  {
    command: "npm run traces:delete-old",
    use: "Preview old raw trace deletion",
    notes: "Dry run by default; 7-day raw-file window.",
  },
  {
    command: "npm run traces:delete-old -- --apply",
    use: "Delete old raw trace files",
    notes: "Requires matching SQLite rows before deleting JSONL, screenshots, run files, and logs.",
  },
  {
    command: "npm run traces:index",
    use: "Backfill or repair SQLite",
    notes: "Writes .artifacts/trace-index.sqlite from raw JSONL.",
  },
  {
    command: "npm run traces:compact",
    use: "Normal trace maintenance",
    notes: "Index first, then delete old raw files.",
  },
];

const storageRows = [
  {
    path: "traces/",
    role: "Hot trace evidence",
    policy: "Recent session JSONL and run JSONL files. Keep this small for active debugging.",
  },
  {
    path: "logs/",
    role: "Hot session logs",
    policy: "Local structured logs linked to active trace sessions.",
  },
  {
    path: ".artifacts/trace-archive/",
    role: "Legacy raw archive",
    policy: "Deprecated archive location from the previous maintenance flow.",
  },
  {
    path: ".artifacts/trace-index.sqlite",
    role: "Trace viewer store",
    policy: "Long-lived query store populated live by the log server and repairable from hot JSONL.",
  },
];

const viewerRows = [
  {
    surface: "Metrics",
    question: "Is the system healthy?",
    use: "Sessions, runs, token and cost totals, model mix, latency, and index coverage.",
  },
  {
    surface: "Insights",
    question: "Where are patterns forming?",
    use: "Failures, tools, skills, models, events, and repeated ratchet candidates.",
  },
  {
    surface: "Session",
    question: "What exactly happened?",
    use: "Turn-by-turn screenshots, tool output, logs, costs, and integrity warnings.",
  },
  {
    surface: "Ratchet",
    question: "What should become permanent?",
    use: "Copyable briefs for tool, skill, policy, verifier, prompt, or context fixes.",
  },
];

export default function DocsTab() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded border border-trace-border bg-trace-panel px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
            Condensed Operator Guide
          </div>
          <div className="mt-2 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <h1 className="text-2xl font-semibold text-trace-text">
                OpenSidebar development in two modes
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-trace-subtle">
                Use npm scripts as the stable interface. Nx is the internal task
                runner. For manual Chrome dev testing, keep <Code>npm run dev</Code>{" "}
                running and load <Code>dist-dev/</Code>. For a standalone build,
                load <Code>dist/</Code>.
              </p>
            </div>
            <div className="rounded border border-trace-border bg-trace-bg px-3 py-3 text-[12px] leading-5 text-trace-subtle">
              <div className="font-semibold text-trace-text">Current rule</div>
              <div className="mt-1">
                <Code>npm run dev</Code> writes <Code>dist-dev/</Code>.{" "}
                <Code>npm run dist</Code> writes <Code>dist/</Code>.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-4">
          {workflowCards.map((item) => (
            <article
              key={item.title}
              className="rounded border border-trace-border bg-trace-bg px-3 py-3"
            >
              <h2 className="text-sm font-semibold text-trace-text">
                {item.title}
              </h2>
              <div className="mt-2 font-mono text-[11px] text-trace-accent-light">
                {item.command}
              </div>
              <p className="mt-2 text-[12px] leading-5 text-trace-subtle">
                {item.detail}
              </p>
            </article>
          ))}
        </section>

        <GuideTable
          title="Command Reference"
          columns={["Command", "Use", "Notes"]}
          rows={commandRows.map((row) => [
            <Code key="command">{row.command}</Code>,
            row.use,
            row.notes,
          ])}
        />

        <GuideTable
          title="Trace Storage Policy"
          columns={["Path", "Role", "Policy"]}
          rows={storageRows.map((row) => [
            <Code key="path">{row.path}</Code>,
            row.role,
            row.policy,
          ])}
        />

        <GuideTable
          title="How To Read The Viewer"
          columns={["Surface", "Question", "Use It For"]}
          rows={viewerRows.map((row) => [row.surface, row.question, row.use])}
        />

        <section className="rounded border border-trace-border bg-trace-panel px-4 py-4">
          <h2 className="text-sm font-semibold text-trace-text">
            Investigation Discipline
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Principle
              label="Start wide"
              detail="Use Metrics and Insights first. A failure matters more when it repeats across sessions."
            />
            <Principle
              label="Inspect one trace"
              detail="Open a concrete sample and verify the turn evidence, screenshots, tool output, and logs."
            />
            <Principle
              label="Name the layer"
              detail="Classify fixes as tool, skill, policy, verifier, prompt, context, or harness before editing."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function GuideTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <section className="rounded border border-trace-border bg-trace-bg px-4 py-4">
      <h2 className="mb-3 text-sm font-semibold text-trace-text">{title}</h2>
      <div className="overflow-x-auto rounded border border-trace-border">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[190px_minmax(180px,1fr)_minmax(240px,1.4fr)] gap-3 border-b border-trace-border bg-trace-panel px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-[190px_minmax(180px,1fr)_minmax(240px,1.4fr)] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0"
            >
              <span className="font-semibold text-trace-text">{row[0]}</span>
              <span className="text-trace-subtle">{row[1]}</span>
              <span className="text-trace-subtle">{row[2]}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Principle({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded border border-trace-border bg-trace-bg px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-trace-muted">
        {label}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-trace-subtle">{detail}</p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-trace-accent-light">{children}</code>;
}
