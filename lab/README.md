# OpenSidebar Lab

A scientific laboratory for empirical research on browser-agent harness design.

## Thesis

Building a reliable browser-automation harness is not purely a programming exercise
-- it is an **empirical discipline**. Each E2E run is an experiment. Each RFC is a
hypothesis. Each trace is raw data. Findings that are not systematically recorded
decay within days.

This lab exists to:

1. **Preserve knowledge** -- observations, hypotheses, and evidence survive across
   sessions and contributors.
2. **Structure inquiry** -- every change to the harness follows the loop:
   *observe -> hypothesise -> experiment -> measure -> record*.
3. **Automate review** -- lab-assistant agents periodically scan new traces, papers,
   and upstream changes to surface relevant insights.

## Directory Layout

```
lab/
  README.md              # This file -- lab charter
  rfcs/                  # Requests for Comments (hypotheses & designs)
  research/              # Literature reviews, benchmark studies, evaluations
  reports/               # E2E run reports and benchmark results
  e2e-reports/           # Per-run E2E reports (natural-v2, v3, v4, etc.)
  books/                 # Reference books (PDFs) and reading notes
  articles/              # Short-form articles and essays
  archive/               # Superseded plans and historical notes
  experiments/           # Structured experiment logs (one dir per experiment)
  knowledge/             # Accumulated knowledge base (GBrain indexed)
  agents/                # Lab-assistant agent configurations
    hermes/              # Hermes Agent -- task orchestration & research automation
    gbrain/              # GBrain -- knowledge persistence & semantic search
  traces/                # Symlink/pointer to ../traces/ (raw experiment data)
  logs/                  # Symlink/pointer to ../logs/ (raw session logs)
```

## Methodology

### The Experiment Loop

```
1. OBSERVE   -- Read traces, E2E reports, user sessions. What failed? What surprised?
2. HYPOTHESISE -- Write an RFC: "We believe X because Y. If true, changing Z should ..."
3. EXPERIMENT -- Implement the change. Run E2E suite. Collect traces.
4. MEASURE   -- Compare before/after pass rates, turn counts, token costs.
5. RECORD    -- Write a report in lab/reports/. Update knowledge base. Close the RFC.
```

### Naming Conventions

| Artifact           | Pattern                                      | Example                                  |
|--------------------|----------------------------------------------|------------------------------------------|
| RFC                | `rfc-<slug>.md`                              | `rfc-state-diff-verification.md`         |
| E2E Report         | `e2e-report-YYYY-MM-DD.md`                   | `e2e-report-2026-04-12.md`               |
| Experiment         | `exp-NNN-<slug>/`                            | `exp-001-deepseek-executor-eval/`        |
| Literature Note    | `lit-<source-slug>.md`                       | `lit-designing-multi-agent-systems.md`   |
| Knowledge Entry    | indexed by GBrain (Markdown source in knowledge/) |                                     |

### Evidence Grades

- **A -- Replicated**: Result reproduced in >=3 independent E2E runs.
- **B -- Single-run**: Observed once with full trace evidence.
- **C -- Anecdotal**: Observed informally, no trace captured.
- **D -- Theoretical**: Derived from literature or reasoning, untested.

## Lab Assistants

Two agents power the lab's automation:

### Hermes Agent (nousresearch/hermes-agent)

Task orchestration and research automation. Hermes can:
- Spawn parallel research subagents
- Schedule periodic literature reviews (cron)
- Maintain persistent memory across sessions
- Route queries to any model provider (Fireworks, OpenRouter, etc.)

Configuration: `lab/agents/hermes/`

### GBrain (garrytan/gbrain)

Knowledge persistence and semantic search. GBrain:
- Indexes all lab Markdown into a searchable knowledge base
- Hybrid search (keyword + vector embeddings)
- Periodic autonomous enrichment via cron
- Exposes 30 tools via MCP server for Claude Code integration

Configuration: `lab/agents/gbrain/`

### Default Model

Both agents default to **Kimi K2.5 via Fireworks** for cost-efficient, fast inference
during lab operations.

## Relationship to docs/

`docs/` is for **users and contributors** of the extension:
- Getting started, manual, architecture, features, developer guide.

`lab/` is for **researchers and harness engineers**:
- RFCs, experiments, traces, literature, knowledge base.

The repo README links to `docs/`. The lab README (this file) is the entry point
for research work.
