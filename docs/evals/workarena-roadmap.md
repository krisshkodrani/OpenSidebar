# WorkArena Roadmap

Last updated: 2026-05-05

This roadmap defines how OpenSidebar should progress from guarded WorkArena smoke runs to full graded WorkArena performance evaluation. It is intentionally separate from generated run reports, which belong under `.artifacts/e2e/`.

Use this page for planning, grading contract, runner requirements, and triage policy. Use [`workarena.md`](./workarena.md) for setup commands and the current manual runbook.

## Current State

OpenSidebar can run real WorkArena handoff tasks through the held BrowserGym session bridge:

- WorkArena doctor readiness is available.
- Task discovery, dry reset, held-session export/import, validation, report validation, and trace learning are available.
- The first guarded ServiceNow menu task has passed WorkArena validation at least once.
- A single-sample category matrix exposed failures across dashboard, knowledge, list-filter, list-sort, menu, form, and service catalog tasks.
- Trace viewer support for run-level planner activity is available, so WorkArena orchestrator planning can be inspected even when executor sessions do not embed `planDecomposition`.

Recently resolved:

- A passed WorkArena validation previously recorded internal `agentTerminalReason=task_failed`. The stale-plan guard fix was confirmed by a live rerun: `validation.passed=true`, `score=1`, and `agentTerminalReason=task_completed`. [GitHub issue #16](https://github.com/krisshkodrani/OpenSidebar/issues/16) is closed.
- Initial reusable workflow skills and read-only inspectors now cover chart value extraction, knowledge/search answer extraction, list filtering, list sorting, and service catalog ordering. The first layer is generic runtime behavior, not WorkArena-specific fixture logic.
- A thin suite runner and standalone grader are available. They reuse `workarena-handoff`, write reports under `.artifacts/e2e/`, and compute score-first pass@1 plus category-balanced pass@1.
- The latest dated 7-case ServiceNow sample grades at 7/7 pass@1, with remaining efficiency warnings on form and catalog workflows.
- The current pre-WorkArena checkpoint is to finish RFC promotion into stable docs, run the full staged OpenSidebar E2E suite, then continue to ServiceNow/WorkArena with the generic-skill-first policy below.

## Evaluation Contract

A graded WorkArena result must separate benchmark truth from runtime diagnostics.

Primary success signal:

- `validation.passed === true`

Primary score:

- category-balanced `pass@1`
- Formula: average the pass rate for each WorkArena category, then average those category rates.
- Reason: this prevents large categories from hiding failures in smaller but important categories.

Secondary metrics:

- mean WorkArena `score`
- median and p95 turns on passed tasks
- median and p95 turns on all tasks
- perceptions per task
- tool calls and tool executions per task
- token and cost totals
- trace count per task
- failure rate by category
- failure class from trace learning
- validation/terminal mismatch count

Report warnings must not flip benchmark success, but they must be visible:

- WorkArena validation passed but internal agent terminal state failed.
- Report schema validation failed.
- Missing trace files or missing run trace IDs.
- Validation could not synchronize final URL/session state.

## Roadmap

| Phase | Status | Goal | Exit Criteria |
| --- | --- | --- | --- |
| 0. Readiness | Done | Verify local WorkArena setup and guarded ServiceNow access. | Doctor, task list, dry run, held session, report validation all work. |
| 1. Trace credibility | In progress | Make every real run inspectable and gradeable. | Planner activity visible in Trace Viewer; terminal-state mismatch classified or fixed. |
| 2. Suite runner | Done | Run controlled batches without duplicating handoff logic. | A thin wrapper can run selected suites, categories, seeds, retries, and resume from reports. |
| 3. Grader | Done | Aggregate JSON reports into stable scorecards. | Markdown and JSON summaries include pass rates, scores, costs, traces, and warning classes. |
| 4. Calibrated sample | Planned | Run enough tasks to identify dominant failure modes. | All atomic categories run across a small seed set with no retries. |
| 5. Runtime fixes | In progress | Improve broad ServiceNow behavior from trace evidence. | Category failures are fixed in runtime policy, tools, controllers, or reusable skills. |
| 6. Full graded run | Planned | Produce a category-balanced WorkArena grade. | All target tasks/seeds run with pass@1, optional pass@2, and validated reports. |
| 7. Scheduled confidence | Optional | Make WorkArena regression tracking repeatable. | A deliberate, budgeted cadence exists for smoke, sample, and full graded runs. |

## Suite Runner Requirements

The full runner should wrap the existing handoff runner instead of reimplementing WorkArena reset, session transfer, validation, or teardown.

Current suite runner examples:

```bash
npx tsx scripts/workarena-suite.ts --suite atomic --categories all --seeds 0,1,2 --max-turns 20
npx tsx scripts/workarena-suite.ts --category menu --seeds 0..4 --no-build
npx tsx scripts/workarena-suite.ts --resume-from-report .artifacts/e2e/workarena-suite-YYYY-MM-DD.json
npx tsx scripts/workarena-grade.ts
```

Required options:

- `--suite atomic|l1|l2|l3`
- `--category all|dashboard|form|knowledge|list-filter|list-sort|menu|service-catalog`
- `--task <task-id>` for isolated debugging
- `--seeds <list-or-range>`
- `--max-turns <n>`
- `--timeout-ms <n>`
- `--retries <n>`
- `--provider <provider-mode>`
- `--no-build`
- `--allow-servicenow-reset`
- `--resume-from-report <path>`
- `--stop-on-first-failure`
- `--dry-run` for no-reset target preview

Runner constraints:

- Keep the harness thin.
- Use WorkArena reset, prompt, task state, validation, and teardown as the source of truth.
- Reuse `scripts/workarena-handoff.ts` for individual task execution.
- Never encode fixture-specific selectors, hidden answers, or ServiceNow shortcuts in the runner.
- Always write machine-readable JSON and concise markdown under `.artifacts/e2e/`.
- Always validate generated reports after a batch.

## Grader Requirements

The grader should consume WorkArena `agent-execution` JSON reports and produce:

- one machine-readable JSON summary
- one markdown scorecard
- optional CSV for spreadsheet analysis

Minimum scorecard fields:

| Field | Meaning |
| --- | --- |
| `taskId` | WorkArena task ID. |
| `category` | Normalized category. |
| `seed` | WorkArena seed. |
| `passed` | `validation.passed === true`. |
| `score` | WorkArena validation score. |
| `turns` | Agent trace turns across trace files. |
| `perceptions` | Turns with Page Interpretation. |
| `toolCalls` | Total tool calls. |
| `toolExecutions` | Total executed tools. |
| `tokens` | Input, output, and total tokens. |
| `costUsd` | Runtime cost when available. |
| `traceIds` | Orchestrator run IDs. |
| `traceFiles` | Agent trace files. |
| `runTraceFiles` | Matching `traces/runs/*.jsonl` files. |
| `failureStage` | Setup, reset, launch, agent, validation, or teardown. |
| `failureClass` | Trace-learning classification. |
| `warnings` | Terminal mismatch, missing traces, schema issues, or sync issues. |

Aggregate sections:

- overall pass@1
- category-balanced pass@1
- pass@2 when retries are enabled
- mean WorkArena score
- pass rate by category
- top failed tasks
- top warning types
- cost per successful task
- median and p95 turns
- failure-class distribution

## Sampling Strategy

Start with a no-retry baseline:

```text
suite: atomic
categories: all
seeds: 0,1,2
maxTurns: 20
retries: 0
```

Use this baseline to decide where engineering effort belongs. Do not add retries before the first baseline, because retries can hide deterministic runtime bugs.

After baseline:

- add `pass@2` as a recovery metric
- preserve `pass@1` as the main reliability metric
- record retry reason and retry trace IDs
- compare failures by category and by seed

## Category Triage Order

Fix the highest-signal, broadest runtime bottlenecks first:

1. Menu/navigation in ServiceNow's unified and classic UI.
2. Form text entry, field persistence, and submit verification.
3. List filter condition builders.
4. List sort and personalization flows.
5. Knowledge search result opening and answer extraction.
6. Dashboard and chart value extraction.
7. Service catalog quantity, configuration, cart, and order submission.

For each failure:

- identify the general runtime cause from traces
- confirm it in trace viewer or a focused rerun
- fix product behavior in runtime policy, tools, controllers, or skills
- add the narrowest regression test that proves the fix
- rerun the isolated WorkArena case
- update the scorecard only from real validation results

## Skill And Runtime Policy

Prefer reusable behavior over benchmark-specific prompts.

WorkArena is an evaluator for broad browser-agent capability, not a target for benchmark-specific code. Do not add task-id branches, seed branches, hidden expected values, or harness shortcuts to make one case pass. A passing run is valuable when it proves a reusable runtime behavior, domain adapter, tool primitive, or generic skill.

Good candidates for runtime or skill work:

- ServiceNow menu navigation with filtered All-menu results.
- Robust classic-frame and unified-navigation handling.
- Structured form fill with field-readback before submit.
- Condition-builder workflows.
- List/table column sort workflows.
- Chart value extraction with DOM plus visual fallback.
- Catalog checkout with intermediate cart verification.
- Multi-tab checklist workflows with explicit return-to-source and completion evidence.
- Infeasible or ambiguous task handling that asks for clarification instead of pretending progress.

Rules:

- Skills encode sequencing, evidence expectations, and tool discipline.
- Skills must not depend on hidden WorkArena answers.
- Skills must not use test-only selectors.
- Harness code may observe, seed minimal state, collect diagnostics, and assert results.
- Harness code must not become product behavior.
- If a workflow is organization-specific rather than generally reusable, keep the product path open for user-authored custom skills instead of encoding that workflow in the harness.

## Reporting Policy

Generated artifacts:

```text
.artifacts/e2e/workarena-suite-YYYY-MM-DD.json
.artifacts/e2e/workarena-suite-YYYY-MM-DD.md
.artifacts/e2e/workarena-trace-learning-YYYY-MM-DD.md
```

Stable documentation:

```text
docs/evals/workarena.md
docs/evals/workarena-roadmap.md
docs/evals/workarena-smoke-test-checklist.md
```

Do not commit dated E2E result reports under `docs/`.

## Immediate Next Steps

1. Finish promoting completed RFC conclusions into stable repo docs without committing RFC drafts.
2. Run the full staged OpenSidebar E2E suite before starting the next real WorkArena batch.
3. If staged is green, run the guarded ServiceNow smoke or atomic category sample across seeds `0,1,2` with no retries and `maxTurns=20`.
4. Use the generated grade and trace-learning reports to rank failures and high-turn passes by category.
5. Fix the broadest reusable behavior first: runtime/tool/domain adapter when possible, generic skill when the workflow sequence is the missing piece.
6. Add `pass@2` only after the no-retry baseline is captured.
