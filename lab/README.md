# OpenSidebar Lab

The lab is the repo's research surface for browser-agent work.

Use it when you need to:

- investigate recurring E2E failures
- turn traces into reusable harness ideas
- write dated research notes and open RFCs in Notion
- preserve findings so they survive beyond one coding session

This is not a second docs folder. It is an operating system for research.

## What The Lab Does

The lab combines two things:

- **Hermes** for research and synthesis
- **GBrain** for local knowledge persistence and search

OpenSidebar wraps both of them behind repo-owned scripts so contributors do not
need to work directly inside the vendored agent repos.

The intended loop is:

1. observe a problem in traces, E2Es, or development work
2. capture the question
3. research or analyze it
4. write down the finding
5. feed the result back into prompts, skills, orchestration, or tests

## How It Works

At a high level:

```text
Question / trace pathology
        ->
OpenSidebar lab wrapper
        ->
Hermes produces a research note
        ->
Note is saved in lab/research/
        ->
GBrain indexes it into the local knowledge base
        ->
Later sessions can search and reuse it
```

Important boundaries:

- The supported entrypoint is the OpenSidebar wrapper, not raw Hermes commands.
- Research notes are first-class artifacts. Chat output is not enough.
- The local knowledge base lives under `data/`, not in some external hosted system.

Runtime state:

- `data/gbrain/brain.pglite` - local GBrain database
- `data/lab-home/` - isolated home/config space used by lab wrappers

Active RFC workflow now lives in Notion:

- RFC Process: `https://www.notion.so/349b9079bcc28165923ae20959fcfdc0`
- RFCs database: `https://www.notion.so/5d3d2b1ff5dc45bcb28ffc578a1de365`

## Recommended Commands

This README intentionally does **not** list every lab command. These are the few
you should actually start with.

### 1. Verify The Lab

```bash
npm run lab:doctor
```

Use this first.

It checks:

- required API keys
- Hermes availability
- GBrain availability
- local brain initialization

If `lab:doctor` is not clean, do not trust later research runs.

### 2. Capture A Real Research Question

```bash
npm run lab:question -- "Why does the executor over-commit before verification in transactional workflows?"
```

Use this when a problem shows up during coding or E2E work and you do not want
it to disappear into chat history.

This creates a durable intake item under `lab/questions/`.

### 3. Run A Fast Local Research Pass

```bash
npm run lab:research -- "Summarize the current OpenSidebar lab environment in 5 short bullets."
```

This is the safest default research command.

Current behavior:

- uses the lab wrapper around Hermes
- runs in **local** mode by default
- relies on the repo context bundle rather than external browsing
- is good for repo-grounded synthesis and lab summaries

Use this for:

- "what do we already know?"
- "summarize the current state of X in this repo"
- "turn existing lab material into a concise brief"

### 4. Save A Research Note Back Into The Lab

```bash
npm run lab:research -- --save note-name "What are the main failure patterns in recent continuation traces?"
```

Use this when you want a durable artifact, not just terminal output.

What happens:

1. Hermes produces a note
2. the wrapper validates the output
3. the note is saved into `lab/research/`
4. GBrain re-indexes the result

If Hermes returns junk or a stub, the wrapper now fails the save and writes a
diagnostic artifact under `lab/research/_failed/` instead of polluting the
knowledge base.

### 5. Re-index The Knowledge Base

```bash
npm run lab:index
```

Use this after:

- editing research notes manually
- adding book notes
- creating or revising Notion RFCs and then updating local research notes to match
- cleaning up or reorganizing lab content

This refreshes the local searchable knowledge base from lab and docs markdown.

## Research Modes

`lab:research` now supports two modes:

### Local Mode

```bash
npm run lab:research -- --mode local "Summarize the current workflow-skills roadmap."
```

This is the default.

Use it when the answer should come from:

- repo files
- lab notes
- existing indexed knowledge

This is best for internal synthesis.

### External Mode

```bash
npm run lab:research -- --mode external --save note-name "What is the current state of the art in browser-agent memory systems?"
```

Use this when the question is genuinely outward-facing and current:

- vendor capability research
- product comparisons
- external state-of-the-art scans

In external mode, the prompt allows normal research behavior rather than forcing
repo-only summarization.

## What Good Lab Usage Looks Like

Good usage:

- capture concrete questions from real traces or regressions
- write dated notes with a clear scope
- connect findings back to harness design
- keep evidence and conclusions separate

Bad usage:

- using `lab/` as a random notes dump
- saving low-signal AI output with no operational consequence
- treating one research note as proven truth
- asking the lab to replace direct code reading when the answer is already local

## Directory Guide

The important directories are:

- `lab/questions/` - intake queue for researchable development questions
- `lab/research/` - saved research notes and literature-style writeups
- `lab/reports/` - benchmark and evaluation summaries
- `lab/e2e-reports/` - per-run E2E reporting
- `lab/knowledge/` - accumulated synthesized knowledge
- `lab/agents/` - Hermes and GBrain configuration

Active RFCs are no longer stored under `lab/`. Use the Notion RFC workflow instead.

## Evidence Standard

The lab should preserve the distinction between:

- **A - Replicated**: seen repeatedly across independent runs
- **B - Single-run**: one run, but with trace evidence
- **C - Anecdotal**: observed informally
- **D - Theoretical**: reasoned or literature-derived, not yet validated here

If a note does not make its evidence level clear, it is weaker than it looks.

## Suggested Workflow

If you only remember one workflow, use this:

1. `npm run lab:doctor`
2. `npm run lab:question -- "..."` for the concrete problem
3. `npm run lab:research -- --save note-name "..."` to create a durable note
4. `npm run lab:index` after any manual edits
5. convert the useful part into a Notion RFC, test, or code change

## Relationship To `docs/`

Use `docs/` for:

- contributor-facing documentation
- product and architecture explanations
- manuals and guides

Use `lab/` for:

- research intake
- dated findings
- trace-driven diagnosis
- experiments
- research that informs Notion RFCs
- knowledge you want future sessions to be able to recover

## Related Files

- [examples/README.md](./examples/README.md)
- [agents/README.md](./agents/README.md)
- [questions/README.md](./questions/README.md)
- [../docs/skills-roadmap-2026-04-13.md](../docs/skills-roadmap-2026-04-13.md)
