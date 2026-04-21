# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Shape

OpenSidebar is a browser-agent Chrome extension with a small monorepo around it.

Key areas:

- `apps/extension/src/background`: the main agent runtime, including the orchestrator, agent loop, tools, LLM client, skills, checkpoints, and durability logic.
- `apps/extension/src/content`: content-script code and page bridge logic.
- `apps/extension/src/sidepanel`: the extension UI used to start and monitor tasks.
- `apps/extension/src/trace-viewer`: the trace viewer and analytics UI.
- `apps/extension/tests/background`: focused runtime and orchestrator tests.
- `apps/extension/tests/e2e`: fixture-driven E2E tests for real browser behavior.
- `scripts/run-e2e-staged.ts`: the staged E2E runner for `easy`, `medium`, and `hard`.
- `traces/runs`: recorded trace sessions produced by E2E and debugging runs.
- `lab/`: research and analysis tooling. Use this for investigation support, not product behavior.

## Default Change Placement

Prefer these locations when making changes:

- Put agent behavior changes in the product runtime first, usually under `apps/extension/src/background`.
- Put page interaction fixes in reusable runtime policy, controllers, or skills before considering test changes.
- Keep content-script and bridge fixes in `apps/extension/src/content` or background tool/bridge code, not in fixtures.
- Keep the E2E harness thin. It may configure the environment, seed minimal state, collect diagnostics, and assert results, but it should not contain product logic.
- Use skills when a workflow pattern is stable and reusable across sites or tasks.
- Use test-only instrumentation only when it is pure observability or minimal state injection needed for determinism.

## Product And E2E Design Rules

When working on runtime behavior, skills, prompts, or E2E-related failures, follow these rules:

1. Solutions must target real product behavior, not just the current E2E fixture.
2. The harness must stay thin and should only observe, seed minimal state, or assert outcomes.
3. Domain behavior should live in runtime policy, reusable controllers, or skills, not in test-only branches.
4. When a repeated workflow has a stable structure, prefer a generic skill over ad hoc prompt tweaks.
5. Skills should encode reusable sequencing, evidence expectations, and tool discipline, not fixture-specific shortcuts.
6. A skill must never depend on test-only selectors, hardcoded fixture text, or hidden knowledge from the E2E.
7. Planner or verifier estimates must not be treated as execution truth when they can be wrong.
8. Heuristic gates may warn, rank, or defer, but they should not silently convert future work into failure without direct evidence.
9. Prompts should sound like natural user requests, with normal language and concrete intent.
10. Prompts should avoid unnatural scaffolding, keyword stuffing, or wording chosen only to trigger a particular tool path.
11. When a task fails, the first fix should be the most general runtime cause, not the narrowest test symptom.
12. If a generic fix exposes the next bottleneck, keep following the bottlenecks in order instead of patching around them in the harness.
13. Recovery paths must be sincere: if state is uncertain, the system should say so and re-ground, not pretend it still knows.
14. Evaluation should be fair: a task is successful only when the real user objective is met, not when intermediate planner artifacts look good.
15. Any optimization for long tasks should preserve correctness first, then reduce cost or turns second.
16. If a behavior is useful outside E2E, it belongs in the product. If it is useful only inside E2E, it belongs nowhere unless it is pure test instrumentation.

## Prompt And Skill Guidance

- Prefer natural prompts in fixtures and tests. They should read like normal user requests, not activation phrases for a specific tool.
- Do not encode fixture-specific hidden knowledge into prompts, skills, or runtime policy.
- Prefer generic skills with reusable sequencing, evidence rules, and tool discipline.
- If a skill guess is weak, bias toward soft guidance such as ranking or prompt framing rather than hard suppression.
- If a repeated workflow is expensive or brittle, first look for a reusable skill or controller before adding special-case planner logic.

## E2E Workflow

- Prefer staged E2E execution through `scripts/run-e2e-staged.ts`.
- Run `easy` before `medium`, and `medium` before `hard`, unless the task is explicitly scoped to a single failing test.
- When a staged run fails, debug the first clean, high-signal failure before spending tokens on later suites.
- Re-run isolated E2E files when iterating on a specific failure.
- Use dated reports in `docs/` only. Do not create or update an undated `docs/e2e-report.md`.

Useful commands:

- `npm run build`
- `npm run test`
- `npm run test:e2e:easy`
- `npm run test:e2e:medium`
- `npm run test:e2e:hard`
- `npm run test:e2e:staged`

## E2E Runtime Defaults

The E2E harness defaults to:

- provider mode: `fireworks`
- lane: `dev`
- executor/planner model: the Fireworks default configured by the runtime unless explicitly overridden by environment variables

Relevant env vars include:

- `E2E_PROVIDER`
- `E2E_EXECUTOR_MODEL`
- `E2E_TEMPERATURE`
- `E2E_USE_VL_EXECUTOR`
- `E2E_DIAGNOSTIC`

Keep harness configuration minimal and prefer runtime fixes over provider-specific test branching.

## Failure Triage Order

When an E2E or runtime task fails, prefer this order:

1. Identify the most general runtime cause.
2. Confirm the failure in traces or focused tests.
3. Fix the product behavior in runtime policy, orchestration, bridge logic, or skills.
4. Add or update the narrowest regression test that proves the fix.
5. Re-run the isolated failing case before broader staged suites.

Do not start by patching the fixture or harness unless the failure is clearly caused by test infrastructure.

## E2E Report Format

When an agent runs the E2E suite or prepares an E2E summary report, create a dated markdown report in `docs/` using this filename pattern:

- `docs/e2e-report-YYYY-MM-DD.md`

Do not create or update an undated `docs/e2e-report.md` file.

The report should use this structure:

1. Title: `# E2E Final Report`
2. Date line
3. Scope line
4. Overall result line
5. A markdown table with these columns:
   - `Case`
   - `Success`
   - `Turns`
   - `Perceptions`
   - `Traces`
   - `Prompt used`
6. A short `## Metric Definitions` section
7. A short `## Stability Notes` section

Metric conventions:

- `Turns`: total recorded trace turns across the trace file(s) for that case.
- `Perceptions`: turns where the trace input included `Page Interpretation`.
- `Traces`: number of trace sessions produced for that case, including replans or retries.
- `Success`: whether the case completed successfully in the run.

Prefer concise prompts in the table: compact whitespace, preserve key literals, and keep the wording faithful to the actual test prompt.

### Alternative Detailed Format

For single-test or more detailed reports, use this extended structure:

1. Title with test name and date
2. Run section: test file, result, runtime, trace count, trace file
3. Prompt Used section
4. Summary table with additional columns: `Prompt style`, `Tool calls`, `Tool executions`, `Cost`, `Tokens`
5. Trace Details table: Trace ID, Turns, Model, LLM duration, token breakdown, cost
6. Tool Call Breakdown table
7. Event Counts table
8. Turn Sequence table
9. Outcome Notes section
