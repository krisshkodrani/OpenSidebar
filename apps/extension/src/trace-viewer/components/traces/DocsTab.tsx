import React from "react";

const principles = [
  {
    label: "Concrete",
    value: "Open one trace",
    detail: "A failure is only understood when the exact turns and evidence are visible.",
  },
  {
    label: "Comparative",
    value: "Check the fleet",
    detail: "A trace matters more when the same pattern repeats across sessions or runs.",
  },
  {
    label: "Actionable",
    value: "Name the layer",
    detail: "Every repeated failure should point at a tool, skill, policy, verifier, prompt, or context fix.",
  },
];

const workflow = [
  {
    step: "1",
    title: "Start With The Fleet",
    detail:
      "Use Metrics and Insights to see whether a failure is isolated, frequent, expensive, or getting worse.",
  },
  {
    step: "2",
    title: "Open One Concrete Trace",
    detail:
      "Use the sample session links to inspect turns, evidence annotations, screenshots, logs, and integrity signals.",
  },
  {
    step: "3",
    title: "Name The Harness Layer",
    detail:
      "Classify the fix as tool, skill, policy, verifier, prompt, or context work before changing code.",
  },
  {
    step: "4",
    title: "Ratchet The Learning",
    detail:
      "Copy a brief, implement the permanent fix, and come back to Metrics to check whether the pattern moved.",
  },
];

const docs = [
  {
    title: "Why HTML-Style Docs Belong Here",
    body:
      "Trace investigation is dense: failures, turns, tools, screenshots, costs, models, and candidate fixes need to sit side by side. Markdown is good for storage, but the viewer can use HTML layout to make the system readable.",
  },
  {
    title: "The Viewer Philosophy",
    body:
      "One trace explains a failure. The fleet explains whether it matters. A good observability surface must support both without forcing the user to switch tools.",
  },
  {
    title: "What To Teach New Users",
    body:
      "Do not start by blaming the model. Start with repeated evidence, inspect one sample deeply, then choose the harness layer where the permanent fix belongs.",
  },
];

const readingPages = [
  {
    title: "Failure Investigation",
    summary:
      "Start wide, then go deep. Metrics and Ratchet decide what is worth opening; Session detail explains the exact failure.",
    href: "docs/guides/trace-viewer-investigation-loop.html",
  },
  {
    title: "Harness Observability",
    summary:
      "The viewer is a harness engineering tool: traces become evidence, evidence becomes ratchet candidates, fixes are measured back in the fleet.",
    href: "docs/guides/trace-viewer-observability.html",
  },
];

export default function DocsTab() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded border border-trace-border bg-trace-panel px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
            Viewer Guide
          </div>
          <div className="mt-2 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <h1 className="text-2xl font-semibold text-trace-text">
                Dense HTML docs for harness observability
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-trace-subtle">
                The trace viewer should teach the investigation loop directly in
                the product: evaluate the fleet, inspect a sample, classify the
                harness layer, and turn repeated evidence into a permanent
                ratchet.
              </p>
            </div>
            <div className="grid gap-2 text-[12px]">
              {principles.map((item) => (
                <Signal
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  detail={item.detail}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-4">
          {workflow.map((item) => (
            <div
              key={item.step}
              className="rounded border border-trace-border bg-trace-bg px-3 py-3"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded border border-trace-accent/40 bg-trace-accent/15 text-sm font-semibold text-trace-accent-light">
                {item.step}
              </div>
              <h2 className="mt-3 text-sm font-semibold text-trace-text">
                {item.title}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-trace-subtle">
                {item.detail}
              </p>
            </div>
          ))}
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          {docs.map((item) => (
            <article
              key={item.title}
              className="rounded border border-trace-border bg-trace-panel px-3 py-3"
            >
              <h2 className="text-sm font-semibold text-trace-text">
                {item.title}
              </h2>
              <p className="mt-2 text-[12px] leading-5 text-trace-subtle">
                {item.body}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          {readingPages.map((page) => (
            <article
              key={page.title}
              className="rounded border border-trace-border bg-trace-bg px-4 py-3"
            >
              <div className="text-[10px] uppercase tracking-[0.18em] text-trace-muted">
                Standalone HTML
              </div>
              <h2 className="mt-2 text-sm font-semibold text-trace-text">
                {page.title}
              </h2>
              <p className="mt-2 text-[12px] leading-5 text-trace-subtle">
                {page.summary}
              </p>
              <div className="mt-3 font-mono text-[10px] text-trace-muted">
                {page.href}
              </div>
            </article>
          ))}
        </section>

        <section className="rounded border border-trace-border bg-trace-bg px-4 py-4">
          <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-trace-muted">
            How To Read The Viewer
          </div>
          <div className="overflow-hidden rounded border border-trace-border">
            <div className="grid grid-cols-[140px_minmax(180px,1fr)_minmax(220px,1.4fr)] gap-3 border-b border-trace-border bg-trace-panel px-3 py-2 text-[10px] uppercase tracking-wider text-trace-muted">
              <span>Surface</span>
              <span>Question</span>
              <span>Use It For</span>
            </div>
            <DocRow
              surface="Metrics"
              question="Is the system healthy?"
              use="Request volume, token/cost, latency, model mix, index coverage."
            />
            <DocRow
              surface="Insights"
              question="Where are patterns forming?"
              use="Failures, tools, skills, runs, models, events, and ratchet candidates."
            />
            <DocRow
              surface="Session"
              question="What exactly happened?"
              use="Turn-by-turn evidence, screenshots, tool outputs, logs, and integrity warnings."
            />
            <DocRow
              surface="Ratchet"
              question="What should become permanent?"
              use="Repeated failures converted into copyable harness improvement briefs."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Signal({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded border border-trace-border bg-trace-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 font-semibold text-trace-text">{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-trace-subtle">{detail}</div>
    </div>
  );
}

function DocRow({
  surface,
  question,
  use,
}: {
  surface: string;
  question: string;
  use: string;
}) {
  return (
    <div className="grid grid-cols-[140px_minmax(180px,1fr)_minmax(220px,1.4fr)] gap-3 border-b border-trace-border/50 px-3 py-2 text-[12px] last:border-b-0">
      <span className="font-semibold text-trace-text">{surface}</span>
      <span className="text-trace-subtle">{question}</span>
      <span className="text-trace-subtle">{use}</span>
    </div>
  );
}
