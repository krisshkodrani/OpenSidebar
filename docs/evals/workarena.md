# WorkArena Setup

This page documents the local setup used to prepare OpenSidebar for real WorkArena benchmark runs. It does not vendor WorkArena into this repository.

For the graded-evaluation plan, scoring contract, and batch-run milestones, use the roadmap in [`workarena-roadmap.md`](./workarena-roadmap.md).

For the first guarded live run after Hugging Face access is approved, use the smoke checklist in [`workarena-smoke-test-checklist.md`](./workarena-smoke-test-checklist.md).

## Current Scope

The current integration supports guarded real WorkArena handoff runs, plus no-token setup checks and local rehearsal commands. It verifies local prerequisites, Hugging Face gated dataset access, BrowserGym session transfer, OpenSidebar execution, WorkArena validation, report schema validation, and trace-learning summaries.

```bash
npx tsx scripts/workarena-doctor.ts
npx tsx scripts/workarena-list.ts
npx tsx scripts/workarena-adapter.ts --task workarena.servicenow.all-menu
npx tsx scripts/workarena-run.ts --task workarena.servicenow.all-menu
npx tsx scripts/workarena-local-execution.ts --task workarena-gap.crm-ticket-escalation
npx tsx scripts/workarena-browser-strategy.ts
npx tsx scripts/workarena-held-session.ts --task workarena.servicenow.all-menu
npx tsx scripts/workarena-first-task.ts
npx tsx scripts/workarena-category-coverage.ts
npx tsx scripts/workarena-trace-learning.ts
npx tsx scripts/workarena-validate-reports.ts
npx tsx scripts/workarena-grade.ts
npx tsx scripts/workarena-suite.ts --suite atomic --categories all --seeds 0,1,2 --max-turns 20 --retries 0 --allow-servicenow-reset
npx tsx scripts/workarena-dry.ts --task workarena.servicenow.all-menu
npx tsx scripts/workarena-handoff.ts --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset
```

The doctor command writes a JSON report to:

```text
.artifacts/e2e/workarena-doctor-YYYY-MM-DD.json
```

## Required Access

WorkArena uses ServiceNow benchmark instances distributed through a gated Hugging Face dataset:

```text
ServiceNow/WorkArena-Instances
```

Required:

- Hugging Face account
- approved access to `ServiceNow/WorkArena-Instances`
- `HUGGING_FACE_HUB_TOKEN` available in the shell or repo-local `.env`

While access is pending, the doctor reports that the token is present and gated access is pending. Real dry runs require access to `instances_v2.json`.

## Local Python Environment

Keep benchmark dependencies outside the tracked repo tree:

```bash
npx tsx scripts/workarena-setup.ts
```

Equivalent manual setup:

```powershell
python -m venv .artifacts\workarena\.venv
.artifacts\workarena\.venv\Scripts\python.exe -m pip install --upgrade pip
.artifacts\workarena\.venv\Scripts\python.exe -m pip install browsergym-workarena huggingface_hub
.artifacts\workarena\.venv\Scripts\python.exe -m playwright install
```

The doctor automatically uses:

```text
.artifacts/workarena/.venv/Scripts/python.exe
```

If you use a different Python environment, set:

```powershell
$env:WORKARENA_PYTHON="C:\path\to\python.exe"
```

## Environment Variables

Use `.env` for local secrets. The file is ignored by git.

```text
HUGGING_FACE_HUB_TOKEN=...
FIREWORKS_API_KEY=...
# Optional when using E2E_PROVIDER=xiaomi
XIAOMI_API_KEY=...
```

The Hugging Face token is used only to retrieve gated WorkArena instance metadata. LLM calls still use the configured OpenSidebar provider, Fireworks by default for E2E.

## Doctor Checks

The doctor verifies:

- Python executable
- `HUGGING_FACE_HUB_TOKEN` presence
- `huggingface_hub` import
- `browsergym-workarena` import
- BrowserGym core imports
- `gymnasium` import
- Python Playwright package
- Playwright CLI
- Chromium browser availability
- gated dataset access

If you want setup-only readiness while Hugging Face access is still pending, allow pending HF access explicitly:

```bash
npx tsx scripts/workarena-doctor.ts --allow-pending-hf
```

With pending gated access, the doctor reports `Status: local setup ready; gated access pending`. That means local dependencies and browser setup are usable, but real ServiceNow resets remain blocked until dataset access is granted.

## Task Discovery

List task metadata without launching a browser or spending LLM tokens:

```bash
npx tsx scripts/workarena-list.ts
```

Useful filters:

```bash
npx tsx scripts/workarena-list.ts --suite atomic
npx tsx scripts/workarena-list.ts --suite l2
npx tsx scripts/workarena-list.ts --suite l3 --limit 100
npx tsx scripts/workarena-list.ts --suite atomic --category form
npx tsx scripts/workarena-list.ts --suite l2 --json
```

Suites:

| Suite | Meaning |
| --- | --- |
| `all` | every registered WorkArena task class |
| `atomic` | atomic L1-style task classes without seed expansion |
| `l1` | agent curriculum atomic tasks with seeds |
| `l2` | agent curriculum compositional L2 task sample |
| `l3` | agent curriculum compositional L3 task sample |

## Dry Run

Launch one WorkArena BrowserGym task, collect the real task goal and initial URLs, then close and teardown. This does not start OpenSidebar and does not call an LLM provider.

```bash
npx tsx scripts/workarena-dry.ts --task workarena.servicenow.all-menu
```

For seeded L2/L3 tasks:

```bash
npx tsx scripts/workarena-dry.ts --task workarena.servicenow.navigate-and-create-incident-l2 --seed 330
```

The dry run contacts ServiceNow and may create temporary benchmark state as part of `env.reset()`. The command always attempts `env.close()` so WorkArena can run teardown.

Use pure metadata mode when you do not want to reset the environment:

```bash
npx tsx scripts/workarena-dry.ts --task workarena.servicenow.all-menu --no-reset
```

Dry-run reports are written to:

```text
.artifacts/e2e/workarena-dry-YYYY-MM-DD-<task-id>.json
```

## Adapter Plan

Create a no-reset adapter contract for one task:

```bash
npx tsx scripts/workarena-adapter.ts --task workarena.servicenow.all-menu
```

This command:

- runs setup readiness with pending Hugging Face access allowed
- resolves WorkArena task metadata through the Python bridge
- passes `--no-reset`, so it does not contact or mutate ServiceNow task state
- does not call OpenSidebar or any LLM provider
- writes a JSON plan under `.artifacts/e2e/`

The plan records the task id, BrowserGym env id, seed, category, prompt source, browser attach strategy, and remaining runner phases. While gated access is pending, the real WorkArena prompt is unavailable because WorkArena only provides `obs.goal` after `env.reset()`.

Use `--skip-doctor` only when iterating on adapter formatting and you do not want the Hugging Face access check:

```bash
npx tsx scripts/workarena-adapter.ts --task workarena.servicenow.all-menu --skip-doctor --no-report
```

## Guarded Reset Runner

Prepare a real WorkArena reset without starting OpenSidebar:

```bash
npx tsx scripts/workarena-run.ts --task workarena.servicenow.all-menu
```

By default this command refuses to reset ServiceNow. It runs the strict doctor check, writes a report, and explains the blocked state. This makes it safe to run while gated access is pending.

After Hugging Face access is approved and you intentionally want to use a remote WorkArena instance, pass the explicit reset flag:

```bash
npx tsx scripts/workarena-run.ts --task workarena.servicenow.all-menu --allow-servicenow-reset
```

The guarded reset runner:

- requires approved gated dataset access before reset
- requires `--allow-servicenow-reset` or `--reset` before calling `env.reset()`
- captures the real `obs.goal`, start URL, active URL, open pages, and task metadata
- closes the WorkArena environment after collecting diagnostics
- does not start OpenSidebar and does not call an LLM provider

Reports are written to:

```text
.artifacts/e2e/workarena-run-YYYY-MM-DD-<task-id>.json
```

## Local Execution Contract

Create an `agent-execution` contract report from an existing local WorkArena-gap fixture task:

```bash
npx tsx scripts/workarena-local-execution.ts --task workarena-gap.crm-ticket-escalation
```

List available local WorkArena-style tasks:

```bash
npx tsx scripts/workarena-local-execution.ts --list
```

This command does not start a browser, OpenSidebar, ServiceNow, or an LLM provider. It converts a local arena task into the same report shape the real WorkArena handoff runner produces, with `prompt.source` set to `local_fixture_prompt` and the env id under `local-fixture/`.

Reports are written to:

```text
.artifacts/e2e/workarena-local-execution-YYYY-MM-DD-local.<task-id>.json
```

Use this before ServiceNow approval to keep the result schema, report validator, and local task metadata aligned with the real runner.

## Browser Attach Strategy

Inspect the local BrowserGym and OpenSidebar browser-launch paths:

```bash
npx tsx scripts/workarena-browser-strategy.ts
```

This command is metadata-only. It does not reset BrowserGym, contact ServiceNow, start OpenSidebar, or call an LLM provider.

Current decision:

- Prefer `separate-extension-browser-with-transferred-session` first.
- Do not target `extension-loaded-browser-context` first.

Rationale:

- BrowserGym currently launches Chromium with `pw.chromium.launch()` and then creates task pages through `browser.new_context()`.
- The OpenSidebar E2E harness currently launches a separate Puppeteer-controlled Chrome with `--load-extension` and `--disable-extensions-except`.
- A same-context approach would require changing BrowserGym's browser lifecycle to a persistent extension-loaded context and porting enough extension-control helpers to that context.
- A separate-browser approach keeps BrowserGym responsible for reset, task prompt, task state, validation, and teardown while OpenSidebar runs in its existing extension-loaded Chrome.

The next real runner should keep the BrowserGym environment open, export session cookies/storage and the active WorkArena URL, import that session into the OpenSidebar browser, run the agent there, then validate through the held BrowserGym task environment.

Strategy reports are written to:

```text
.artifacts/e2e/workarena-browser-strategy-YYYY-MM-DD.json
```

## Held Session Bridge

Inspect the long-lived bridge protocol that will keep BrowserGym alive while OpenSidebar acts in a separate extension browser:

```bash
npx tsx scripts/workarena-held-session.ts --task workarena.servicenow.all-menu
```

By default this is protocol-only. It starts the Python JSONL bridge, reads the `describe` response, writes a report, and exits without resetting BrowserGym or contacting ServiceNow.

After gated access is approved, the reset/export path can be exercised explicitly:

```bash
npx tsx scripts/workarena-held-session.ts --task workarena.servicenow.all-menu --allow-servicenow-reset
```

The bridge protocol supports:

| Command | Purpose | Requires reset | Mutates ServiceNow |
| --- | --- | --- | --- |
| `describe` | report protocol capabilities and current state | No | No |
| `reset` | create the BrowserGym task and keep the environment alive | No | Yes |
| `export_session` | return Playwright storage state, active URL, and open pages | Yes | No |
| `validate` | run WorkArena validation against the held environment | Yes | No |
| `teardown` | close task, chat, context, and browser | No | No |

The standalone held-session CLI tears down before exit when it exercises reset. The handoff runner keeps the same bridge process alive, imports the exported session into the OpenSidebar extension browser, runs the agent, then calls `validate` and `teardown`.

Held-session reports are written to:

```text
.artifacts/e2e/workarena-held-session-YYYY-MM-DD-<task-id>.json
```

## Report Schema Validation

Validate generated WorkArena JSON reports without contacting ServiceNow:

```bash
npx tsx scripts/workarena-validate-reports.ts
```

Validate a specific report:

```bash
npx tsx scripts/workarena-validate-reports.ts --file .artifacts/e2e/workarena-run-YYYY-MM-DD-workarena.servicenow.all-menu.json
```

The validator covers:

- doctor reports
- task-list reports
- dry-run reports
- adapter-plan reports
- guarded-reset reports
- local execution-contract reports
- browser attach strategy reports
- held-session protocol reports
- the `agent-execution` report shape

The execution result schema reserves stable fields for task id, seed, real WorkArena or local fixture prompt, start URL, trace ids/files, final answer, turns, perceptions, tool counts, tokens, cost, validation result, timings, and failure stage. Failure stages are fixed to `setup`, `reset`, `extension_launch`, `agent_run`, `validation`, and `teardown`.

## Grade Reports

Aggregate latest dated WorkArena execution reports without contacting ServiceNow:

```bash
npx tsx scripts/workarena-grade.ts
```

By default, the grader uses the latest dated `agent-execution` reports under `.artifacts/e2e/`. Pass explicit files to grade a chosen batch, or use `--all` to include all historical execution reports:

```bash
npx tsx scripts/workarena-grade.ts --file .artifacts/e2e/workarena-handoff-YYYY-MM-DD-workarena.servicenow.all-menu.json
npx tsx scripts/workarena-grade.ts --all
```

The grader writes:

```text
.artifacts/e2e/workarena-grade-YYYY-MM-DD.json
.artifacts/e2e/workarena-grade-YYYY-MM-DD.md
```

Primary success uses WorkArena score when present. This avoids treating a BrowserGym episode that ended with score `0` as a benchmark pass.

## Suite Runner

Run controlled batches through the existing handoff runner:

```bash
npx tsx scripts/workarena-suite.ts --suite atomic --categories all --seeds 0,1,2 --max-turns 20 --retries 0 --allow-servicenow-reset
```

Useful non-mutating preview:

```bash
npx tsx scripts/workarena-suite.ts --suite atomic --category menu --seeds 0 --dry-run --no-report
```

Useful targeted rerun:

```bash
npx tsx scripts/workarena-suite.ts --task workarena.servicenow.create-incident --seeds 0 --max-turns 20 --retries 0 --allow-servicenow-reset --no-build
```

The suite runner builds the extension once, then calls `workarena-handoff` with `--no-build` for each target. It writes:

```text
.artifacts/e2e/workarena-suite-YYYY-MM-DD.json
.artifacts/e2e/workarena-suite-YYYY-MM-DD.md
```

Use `--resume-from-report .artifacts/e2e/workarena-suite-YYYY-MM-DD.json` to skip targets already completed in a prior suite report.

## Trace Learning Report

After a WorkArena handoff batch, summarize the generated JSON reports and trace files into likely fix layers:

```bash
npx tsx scripts/workarena-trace-learning.ts
```

The report is written to:

```text
.artifacts/e2e/workarena-trace-learning-YYYY-MM-DD.md
```

The analyzer reads `agent-execution` reports, follows trace file references, counts turns, perception prompts, tool calls, tool failures, reset attempts, and selected skills, then routes each run toward a likely next fix layer: WorkArena harness/session, validation/session sync, DOM/perception runtime, tool execution runtime, planner/skill policy, skill/policy optimization, or trace/report instrumentation. These classifications are investigation hints, not final root-cause proof.

By default, pending reports with no trace files are skipped because they do not contain agent behavior to learn from. Use `--include-pending` when you want the report to include blocked or pending contract records too.

## Local Rehearsal Checks

Before attempting real WorkArena, run the local no-token checks individually:

```bash
npx tsx scripts/workarena-category-coverage.ts
npx tsx scripts/workarena-local-execution.ts --task workarena-gap.crm-ticket-escalation
npx tsx scripts/workarena-browser-strategy.ts
npx tsx scripts/workarena-held-session.ts --task workarena.servicenow.all-menu
npx tsx scripts/workarena-validate-reports.ts
```

These checks cover:

- arena registry validation
- one local `agent-execution` contract report for each `workarena-gap` task
- browser attach strategy probe
- held-session protocol probe
- session state import E2E for cookies and origin storage in the extension browser
- WorkArena report schema validation

The historical `scripts/workarena-copy-suite.ts` wrapper is not the canonical path right now because it still shells out to legacy npm aliases. Prefer the individual commands above until the suite runner is refreshed.

Local rehearsal reports are written to:

```text
.artifacts/e2e/workarena-category-coverage-YYYY-MM-DD.md
.artifacts/e2e/workarena-local-execution-YYYY-MM-DD-local.<task-id>.json
.artifacts/e2e/workarena-browser-strategy-YYYY-MM-DD.json
.artifacts/e2e/workarena-held-session-YYYY-MM-DD-<task-id>.json
```

## Next Integration Step

After doctor, list, adapter plan, guarded reset, dry run, held-session, and session import are green, use the manual handoff runner for the first real WorkArena execution:

Before access is granted, prepare the first-run candidate:

```bash
npx tsx scripts/workarena-first-task.ts
```

This is metadata-only. It does not reset ServiceNow, start OpenSidebar, or call an LLM provider. It ranks local WorkArena task metadata and prints the exact guarded handoff command to use after doctor reports `ready=true`.

Check local category coverage before the first real reset:

```bash
npx tsx scripts/workarena-category-coverage.ts
```

This command compares the local arena task registry against the WorkArena category list and writes a markdown report under `.artifacts/e2e/`. The current local category pack covers every WorkArena category with at least one tagged local analog, including infeasible-context, data-driven reasoning, sophisticated-memory, service catalog, menu, list-filter, and list-sort coverage.

```bash
npx tsx scripts/workarena-handoff.ts --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset
```

## Demo Session Server

For filming, start a local control server that opens a visible held WorkArena session on command and keeps it alive until teardown:

```bash
npm run workarena:demo -- --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset
```

Then open:

```text
http://127.0.0.1:7595
```

The page exposes buttons for `Start visible session`, `Export session`, `Validate`, and `Teardown`. The server refuses to reset ServiceNow unless it was started with `--allow-servicenow-reset`.

Useful HTTP endpoints:

```text
GET  /status
POST /start
POST /export
POST /validate
POST /teardown
```

The handoff runner is manual-only. It refuses to reset WorkArena unless `--allow-servicenow-reset` or `--reset` is present, checks doctor readiness first, starts the held BrowserGym session, exports cookies/storage and the active URL, imports that state into the OpenSidebar extension browser, runs the agent with the real WorkArena goal, validates through the still-held BrowserGym environment, tears down, and writes a JSON execution report under `.artifacts/e2e/`. The report includes bridge status summaries, storage import counts, the final OpenSidebar URL, and the terminal agent event summary.

Use `--no-build` only when the extension is already built:

```bash
npx tsx scripts/workarena-handoff.ts --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset --no-build
```

Without the reset flag, the command only writes a blocked/pending report and does not contact ServiceNow.
