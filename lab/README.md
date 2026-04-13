# OpenSidebar Lab

A scientific laboratory for empirical research on browser-agent harness design.

## Operator Surface

The lab is operated through OpenSidebar-owned wrappers, not by calling the
vendored agent repos directly.

Primary entrypoints:

- `npm run lab:setup` -- initialize submodules, create local lab state, bootstrap GBrain, index core content
- `npm run lab:doctor` -- verify tools, env vars, submodules, and local brain state
- `npm run lab:index` -- re-index lab and docs markdown into the local GBrain store
- `npm run lab:analyze-traces -- --days 7 --limit 200` -- generate a dated trace-analysis note and re-index it
- `npm run lab:question -- "question"` -- capture a development question or pathology into the research queue
- `npm run lab:research -- "question"` -- run Hermes as the lab research assistant from the repo root
- `npm run lab:research -- --save note-name "question"` -- save the research note to `lab/research/` and re-index it
- `npm run lab:skill-candidates -- --days 7 --limit 200` -- analyze recent traces and save a prioritized list of possible new workflow skills
- `bun run lab/bin/gbrain-mcp.ts` -- start the GBrain MCP server used by `.mcp.json`
- `npx tsx lab/bin/hermes.ts ...` -- run Hermes through the lab wrapper

Runtime state is kept under `data/`:

- `data/gbrain/brain.pglite` -- local GBrain database
- `data/lab-home/.gbrain/` -- isolated GBrain config home used by the wrappers

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
4. **Improve the harness** -- research should identify pathologies, generalize them,
   and feed them back into better orchestration, skills, prompts, and verification.

## Research Intake

Questions that arise during development should not disappear into chat history.
They should land in `lab/questions/` as explicit research work items.

Good intake items include:

- recurring trace pathologies
- repeated E2E failures that suggest a missing abstraction
- suspicious regressions after harness or prompt changes
- evidence that generic tools are hitting their ceiling
- interesting ideas from books, essays, or competitor systems worth validating

Capture one with:

```bash
npm run lab:question -- "Why does the executor over-commit before verification in transactional workflows?"
```

Then investigate it with the normal lab loop:

1. sample traces
2. generalize the issue
3. research alternatives
4. write an RFC or experiment
5. measure whether the harness improves

If the question is specifically about missing workflow skills, use:

```bash
npm run lab:skill-candidates -- --days 7 --limit 200
```

That workflow:

1. refreshes the latest trace-analysis note
2. asks the lab researcher to inspect recent pathologies for reusable workflow shapes
3. saves a candidate-skill list into `lab/research/`

## Skills Planning

For the current workflow-skill and meta-skill roadmap, see [docs/skills-roadmap-2026-04-13.md](../docs/skills-roadmap-2026-04-13.md).

Use the lab workflows to evolve that roadmap:

- `npm run lab:analyze-traces`
- `npm run lab:skill-candidates -- --days 7 --limit 200`
- `npm run lab:question -- "question"`
- `npm run lab:research -- "question"`

## Directory Layout

```
lab/
  README.md              # This file -- lab charter
  rfcs/                  # Requests for Comments (hypotheses & designs)
  research/              # Literature reviews, benchmark studies, evaluations
  questions/             # Open research questions and pathologies from development
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

Hermes defaults to **Kimi K2.5 via Fireworks** for cost-efficient research flows.

The pinned GBrain build in this repo currently uses `OPENAI_API_KEY` for embeddings
and query expansion. It is wrapped into the lab environment and isolated into
project-local state, but it is not yet Fireworks-native.

## Relationship to docs/

`docs/` is for **users and contributors** of the extension:
- Getting started, manual, architecture, features, developer guide.

`lab/` is for **researchers and harness engineers**:
- RFCs, experiments, traces, literature, knowledge base.

The repo README links to `docs/`. The lab README (this file) is the entry point
for research work.
