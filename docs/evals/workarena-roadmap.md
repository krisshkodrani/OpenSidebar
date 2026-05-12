# WorkArena Roadmap

Last updated: 2026-05-09

This roadmap defines how OpenSidebar should progress from guarded WorkArena smoke runs to a full WorkArena run-ready harness and then to graded WorkArena performance evaluation. It is intentionally separate from generated run reports, which belong under `.artifacts/e2e/`.

Use this page for planning, grading contract, runner requirements, and triage policy. Use [`workarena.md`](./workarena.md) for setup commands and the current manual runbook. Use [WorkArena Generalized Harness Philosophy](../guides/workarena-generalized-harness-philosophy.md) for the stable evaluator-to-product principles behind this roadmap.

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
- The latest dated 7-case ServiceNow sample grades at 7/7 pass@1. Catalog efficiency remains worth watching, but it is no longer a harness blocker by itself.
- The first broader ServiceNow chunk has been rerun as two smaller guarded batches and is 7/7 pass@1. WorkArena record-creation task slugs such as `create-problem`, `create-incident`, and `create-change-request` route through the generic runtime skill `servicenow-record-form`; the slug names are evaluator case names, not product skill names.
- The completed harness boundary conclusions are now promoted into stable architecture docs.
- Generic ServiceNow form-submit confirmation now records submitted identity evidence and can re-open the submitted record by `sys_id` for validation handoff. The R4 form confidence chunk has passed 5/5 at seed `0`.
- The list-filter resolver now prefers exact internal field names, preserves common ServiceNow field semantics over weak dictionary metadata, and can resolve row-backed choice/reference values from the current list table.
- The R4 list confidence chunk is green at seed `0`: the six list-filter tasks passed 6/6 with p95 turns `1`, and the six list-sort tasks passed 6/6 with turns `1,2,2,1,1,1` after inherited ServiceNow task fields were added to `apply_list_sort`.
- The R4 knowledge/menu/dashboard chunk is green at seed `0`: the seven tasks passed 7/7. A chart-value pass that initially ended with `agentTerminalReason=task_failed` was fixed by scoping chart answer-shape guards to the embedded original user request; the focused rerun completed in 3 turns with `agentTerminalReason=task_completed`.

Current validation gate:

- The seed `0` atomic ServiceNow baseline is green across the current 33 task target set: 33/33 pass@1, category-balanced pass@1 `100.0%`, median turns `3`, p95 turns `11`, warnings `0`.
- The current grade evidence is `.artifacts/e2e/workarena-grade-2026-05-09.md`, generated from the latest 33 seed `0` handoff reports.
- `workarena-validate-reports` accepts all 319 current WorkArena reports.
- The R4 service-catalog category is green at seed `0`: 9/9 pass@1, median turns `7`, p95 turns `11`, warnings `0`; `order-development-laptop-p-c` now passes in 6 turns.
- Catalog blockers were fixed generically in `configure_catalog_item`: durable text/dropdown/quantity commits, direct order-vs-cart routing, direct checkbox label resolution, radio-like option groups, and ServiceNow radio value commits.
- A one-shot full atomic command can exceed a 60 minute outer shell timeout. Until the wrapper has a longer supervised timeout, the accepted full-run procedure is a clean checkpoint plus explicit category/task chunks, followed by `workarena-grade`.
- The remaining pre-widening work is source hygiene, checkpointing, and a deliberate decision whether the next run is seeds `0,1,2` pass@1 or a pass@2 retry study.

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
| 4. Calibrated sample | Done | Run enough tasks to identify dominant failure modes. | All atomic ServiceNow categories run at seed `0`, no retries, with validated reports. |
| 5. Runtime fixes | In progress | Improve broad ServiceNow behavior from trace evidence. | Category failures are fixed in runtime policy, tools, controllers, or reusable skills. |
| 6. Full atomic run | Seed `0` baseline done; multi-seed planned | Produce a category-balanced WorkArena grade for atomic tasks. | All target atomic tasks/seeds run with pass@1, optional pass@2, and validated reports. |
| 7. Scheduled confidence | Optional | Make WorkArena regression tracking repeatable. | A deliberate, budgeted cadence exists for smoke, sample, and full graded runs. |

## Full WorkArena Run Ready Harness Roadmap

The goal is a harness that can run a full WorkArena batch deliberately, preserve benchmark truth, and produce enough evidence to decide the next product fix without rerunning blindly.

Run-ready means the harness is allowed to fail tasks, but it must not lose evidence, hide validation truth, or require one-off runner patches while the batch is in progress.

Read this as a widening ladder. Do not skip a gate because a narrower batch happened to pass once; widen only when the current gate produces valid reports and the remaining risks are either fixed or explicitly accepted.

### R0. Source And Build Hygiene

Status: Active gate before every widening run; not satisfied after code changes until focused tests, build, lint, and report validation are rerun.

Exit criteria:

- Current branch has a named checkpoint commit before a full run.
- The extension is rebuilt after runtime changes before any `--no-build` WorkArena command.
- The run notes record any unrelated dirty worktree state.
- Focused tests for changed runtime areas pass.
- `npm run dist` and `npm run ci:lint` pass, with known warnings explicitly recorded.

### R1. Harness Readiness

Status: Mostly ready; suite summaries now use unique scope/timestamp filenames and still need report validation after each batch.

Exit criteria:

- `workarena-doctor` reports ready.
- `workarena-suite` can run explicit task lists, categories, seeds, retries, max turns, and resume from reports.
- `workarena-handoff` remains the single task execution path for reset, session transfer, agent run, validation, and teardown.
- Browser close, timeout, and teardown warnings are captured in reports instead of becoming silent hangs.
- No leftover WorkArena runner processes remain after command timeout or interruption.

### R2. Report And Trace Credibility

Status: Mostly ready.

Exit criteria:

- Every generated `agent-execution` report validates with `workarena-validate-reports`.
- Every task report includes the real WorkArena prompt, active URL, trace files, terminal reason, validation score, timing, and bridge status.
- Full-run summaries include pass@1, category-balanced pass@1, score, turns, cost, warnings, and failure stage.
- Suite summary filenames include run scope, seed scope, and timestamp so same-day chunks and focused reruns preserve separate evidence.
- Passed validation with timeout, missing trace, or terminal mismatch is surfaced as a warning, not counted as clean stability.
- Trace-learning output can classify failures by fix layer.

### R3. ServiceNow Capability Baseline

Status: Mostly ready; form-submit identity and list confidence are resolved at seed `0`.

Exit criteria:

- The 7-case calibrated sample is green.
- The first broader ServiceNow chunk remains green across:
  - menu navigation
  - incident form creation
  - change-request form creation
  - problem form creation
  - incident list filtering
  - hardware list filtering
  - incident list sorting
- Hardware asset creation passes validation through generic submit identity confirmation, or leaves a direct submit diagnostic if it regresses.
- List-filter field/value resolution is confirmed on hardware, incident, catalog item, asset, change request, and user lists.
- List-sort field resolution is confirmed on asset, change request, hardware, incident, catalog item, and user lists.
- Known high-turn passes have an owner or accepted risk note.
- Browser close or teardown warnings are recorded as harness warnings and do not mask validation truth.
- Any remaining cost target must be selected from traces and fixed through a generic runtime, ServiceNow adapter, or skill layer rather than a task branch.

### R4. Category-Balanced Atomic Baseline

Status: Done for the current seed `0` ServiceNow atomic target set. The next gate is checkpointing and deliberate widening.

Exit criteria:

- Run all atomic ServiceNow categories at seed `0`, no retries, `maxTurns=20`.
- Split into small chunks if needed to avoid wrapper timeouts.
- Preserve `--retries 0` for the first signal run.
- Stop widening only for clean infrastructure breakage or a repeated product regression that invalidates the batch.
- Produce timestamped suite summaries and one grade summary under `.artifacts/e2e/`.
- Current evidence: `.artifacts/e2e/workarena-grade-2026-05-09.md`, 33/33 pass@1, category-balanced pass@1 `100.0%`, warnings `0`.

Recommended R4 chunk order:

1. Form confidence chunk: `create-change-request`, `create-incident`, `create-hardware-asset`, `create-problem`, `create-user`. Current status: passed at seed `0`.
2. List confidence chunk: all list filter and list sort atomic tasks at seed `0`. Current status: passed at seed `0`; filters 6/6 and sorts 6/6.
3. Knowledge, menu, and dashboard chunk. Current status: passed at seed `0`; the chart terminal mismatch was fixed and rerun cleanly.
4. Service catalog chunk. Current status: passed 9/9 at seed `0`; median turns `7`, p95 turns `11`, warnings `0`.

Do not widen to seeds `0,1,2` until the checkpoint is created and the remaining high-turn seed `0` passes have an accepted cost/stability risk note.

### R4A. Active Catalog Blocker

Status: Resolved for seed `0` service-catalog validation; keep monitoring as cost/stability work.

Exit criteria:

- `configure_catalog_item` can set text fields, dropdown/select fields, checkboxes, and quantity fields in one generic call.
- `configure_catalog_item` can set radio-like catalog option groups and commit ServiceNow radio variables with the submitted form value while preserving the `_checked_radio` marker.
- ServiceNow catalog select values are committed to the same page state that WorkArena validation reads after submission.
- The isolated `workarena.servicenow.order-loaner-laptop` seed `0` run passes without task-id-specific code.
- The isolated `workarena.servicenow.order-development-laptop-p-c` seed `0` run passes without task-id-specific code.
- The full service-catalog seed `0` category is 9/9 pass@1 in the latest grade.
- The generated focused and service-catalog suite reports validate with `workarena-validate-reports`.

Preferred fix layer:

1. Product runtime/tool primitive: make catalog option and quantity commits durable.
2. ServiceNow platform semantics: use stable ServiceNow form/catalog APIs only if generic DOM events are insufficient.
3. Generic skill sequencing: keep the cart-to-checkout handoff disciplined after Add to Cart or Order Now.
4. Harness/reporting: only capture clearer diagnostics; do not encode answers or shortcuts.

### R5. Full Atomic Run

Status: Planned.

Exit criteria:

- Run all atomic WorkArena tasks across the chosen seed set.
- Start with seed `0`; widen to seeds `0,1,2` only after seed `0` has no harness-level blockers.
- Keep pass@1 as the main reliability metric.
- Add pass@2 only after the no-retry baseline is captured.
- Do not patch prompts, task ids, seeds, validators, or runner shortcuts during the batch.

### R6. Run-Ready Definition Of Done

Status: Planned.

The harness is full-run ready when all of these are true:

- A full atomic command can be launched from a clean checkpoint with explicit reset approval.
- Each task either passes validation or leaves a valid report with failure stage, trace evidence, and teardown status.
- The final summary can answer: what passed, what failed, what timed out, what cost the most, and what generic capability should be fixed next.
- No full-run blocker requires benchmark-specific code.
- The recommended next action after the run is based on traces, not speculation.

## Readiness Gates

Use these gates to decide whether to keep widening or go back to product work:

| Gate | Required signal | If it fails |
| --- | --- | --- |
| Build gate | Focused tests, lint, and build pass after latest runtime changes. | Stop and fix local product correctness before any WorkArena reset. |
| Report gate | `workarena-validate-reports` accepts generated execution reports. | Fix report schema or missing evidence before interpreting scores. |
| Harness gate | Reset, session import, validation, and teardown produce explicit statuses. | Fix the bridge/runner; do not classify product failures yet. |
| ServiceNow commit gate | Form submit either produces a validator-visible record or direct diagnostics. | Fix the ServiceNow submit/diagnostic primitive before more form runs. |
| ServiceNow list gate | List filter/sort tools set the intended query or order in one direct operation and validation can inspect it. | Fix generic list-tool resolution or ServiceNow platform semantics before widening. |
| Category gate | Each category has at least one no-retry seed `0` result. | Keep sampling that category before claiming full-run readiness. |
| Cost gate | High-turn passing cases have trace-backed owners or accepted risk notes. | Optimize through generic tools or skills only after correctness is stable. |

## Suite Runner Requirements

The full runner should wrap the existing handoff runner instead of reimplementing WorkArena reset, session transfer, validation, or teardown.

Current suite runner examples:

```bash
npx tsx scripts/workarena-suite.ts --suite atomic --categories all --seeds 0,1,2 --max-turns 20
npx tsx scripts/workarena-suite.ts --category menu --seeds 0..4 --no-build
npx tsx scripts/workarena-suite.ts --resume-from-report .artifacts/e2e/workarena-suite-YYYY-MM-DD-SCOPE-SEED-TIME.json
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
.artifacts/e2e/workarena-suite-YYYY-MM-DD-SCOPE-SEED-TIME.json
.artifacts/e2e/workarena-suite-YYYY-MM-DD-SCOPE-SEED-TIME.md
.artifacts/e2e/workarena-trace-learning-YYYY-MM-DD.md
```

Stable documentation:

```text
docs/evals/workarena.md
docs/evals/workarena-roadmap.md
docs/evals/workarena-smoke-test-checklist.md
docs/evals/workarena-full-run-checklist.md
```

Do not commit dated E2E result reports under `docs/`.

## Immediate Next Steps

1. Validate generated WorkArena reports with `workarena-validate-reports`.
2. Run final source hygiene for checkpoint scope: focused tests are green, build is green, and `npm run ci:lint` should be run before committing if this checkpoint is release-facing.
3. Create a named checkpoint commit for the generic catalog fixes and roadmap update, staging only relevant files from the dirty worktree.
4. Use the generated grade and trace-learning reports to rank high-turn passing cases before widening; current top catalog cost is `order-development-laptop-p-c` at 15 turns.
5. Run the full atomic seed `0` no-retry baseline after the checkpoint, then widen to seeds `0,1,2` only after that report validates.
