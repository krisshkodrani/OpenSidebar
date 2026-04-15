# Development Questions

This directory is the lab's intake queue for research questions that arise during
development.

Use it for:

- harness pathologies seen in traces
- recurring E2E failures that suggest a missing abstraction
- weird model behaviors that need generalization rather than one-off prompt edits
- ideas from books, papers, or competitor systems worth testing against OpenSidebar
- design questions that should become RFCs or experiments

The goal is not to collect random thoughts. The goal is to convert concrete
development friction into structured research that can improve the harness.

## Workflow

1. Capture the question
   - `npm run lab:question -- "Why does the executor over-commit before verification in cart flows?"`
2. Attach evidence
   - traces, E2E files, reports, code paths
3. Generalize
   - identify whether the issue is fixture-specific, workflow-specific, or harness-wide
4. Investigate
   - use `lab:research`, `lab:analyze-traces`, books, and targeted code reading
5. Promote or close
   - promote to RFC/experiment when action is clear
   - close when resolved, invalidated, or absorbed into shipped behavior

## Layout

- `QUEUE.md`
  - human-readable index of open / active / resolved questions
- `open/`
  - one markdown file per open question
  - may also include a few clearly-labeled `Status: Example` reference items that show what a strong intake question looks like
- `active/`
  - questions currently under focused investigation
- `resolved/`
  - closed questions with outcomes recorded

## Question Quality Bar

A good question:

- starts from a real trace, test, regression, or recurring design tension
- aims at a reusable harness improvement
- is specific enough to investigate
- is broad enough to matter beyond one fixture

A weak question:

- is just a feature wish
- only describes one site-specific annoyance
- has no evidence trail
- cannot lead to a concrete experiment or design decision
