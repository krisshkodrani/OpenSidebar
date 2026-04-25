# WorkArena Setup

This page documents the local setup used to prepare OpenSidebar for real WorkArena benchmark runs. It does not vendor WorkArena into this repository.

## Current Scope

The current integration is a no-token doctor command. It verifies local prerequisites and Hugging Face gated dataset access before we add real task execution.

```bash
npm run benchmark:workarena:doctor
npm run benchmark:workarena:list
npm run benchmark:workarena:adapter -- --task workarena.servicenow.all-menu
npm run benchmark:workarena:run -- --task workarena.servicenow.all-menu
npm run benchmark:workarena:local -- --task workarena-gap.crm-ticket-escalation
npm run benchmark:workarena:browser-strategy
npm run benchmark:workarena:held-session -- --task workarena.servicenow.all-menu
npm run benchmark:workarena:validate-reports
npm run test:e2e:workarena:copy
npm run benchmark:workarena:dry -- --task workarena.servicenow.all-menu
```

The command writes a JSON report to:

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
npm run benchmark:workarena:setup
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
npm run benchmark:workarena:doctor -- --allow-pending-hf
```

With pending gated access, the doctor reports `Status: local setup ready; gated access pending`. That means local dependencies and browser setup are usable, but real ServiceNow resets remain blocked until dataset access is granted.

## Task Discovery

List task metadata without launching a browser or spending LLM tokens:

```bash
npm run benchmark:workarena:list
```

Useful filters:

```bash
npm run benchmark:workarena:list -- --suite atomic
npm run benchmark:workarena:list -- --suite l2
npm run benchmark:workarena:list -- --suite l3 --limit 100
npm run benchmark:workarena:list -- --suite atomic --category form
npm run benchmark:workarena:list -- --suite l2 --json
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
npm run benchmark:workarena:dry -- --task workarena.servicenow.all-menu
```

For seeded L2/L3 tasks:

```bash
npm run benchmark:workarena:dry -- --task workarena.servicenow.navigate-and-create-incident-l2 --seed 330
```

The dry run contacts ServiceNow and may create temporary benchmark state as part of `env.reset()`. The command always attempts `env.close()` so WorkArena can run teardown.

Use pure metadata mode when you do not want to reset the environment:

```bash
npm run benchmark:workarena:dry -- --task workarena.servicenow.all-menu --no-reset
```

Dry-run reports are written to:

```text
.artifacts/e2e/workarena-dry-YYYY-MM-DD-<task-id>.json
```

## Adapter Plan

Create a no-reset adapter contract for one task:

```bash
npm run benchmark:workarena:adapter -- --task workarena.servicenow.all-menu
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
npm run benchmark:workarena:adapter -- --task workarena.servicenow.all-menu --skip-doctor --no-report
```

## Guarded Reset Runner

Prepare a real WorkArena reset without starting OpenSidebar:

```bash
npm run benchmark:workarena:run -- --task workarena.servicenow.all-menu
```

By default this command refuses to reset ServiceNow. It runs the strict doctor check, writes a report, and explains the blocked state. This makes it safe to run while gated access is pending.

After Hugging Face access is approved and you intentionally want to use a remote WorkArena instance, pass the explicit reset flag:

```bash
npm run benchmark:workarena:run -- --task workarena.servicenow.all-menu --allow-servicenow-reset
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

Create a future `agent-execution` report from an existing local WorkArena-gap fixture task:

```bash
npm run benchmark:workarena:local -- --task workarena-gap.crm-ticket-escalation
```

List available local WorkArena-style tasks:

```bash
npm run benchmark:workarena:local -- --list
```

This command does not start a browser, OpenSidebar, ServiceNow, or an LLM provider. It converts a local arena task into the same report shape the real WorkArena agent runner will eventually produce, with `prompt.source` set to `local_fixture_prompt` and the env id under `local-fixture/`.

Reports are written to:

```text
.artifacts/e2e/workarena-local-execution-YYYY-MM-DD-local.<task-id>.json
```

Use this before ServiceNow approval to keep the result schema, report validator, and local task metadata aligned with the future real runner.

## Browser Attach Strategy

Inspect the local BrowserGym and OpenSidebar browser-launch paths:

```bash
npm run benchmark:workarena:browser-strategy
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
npm run benchmark:workarena:held-session -- --task workarena.servicenow.all-menu
```

By default this is protocol-only. It starts the Python JSONL bridge, reads the `describe` response, writes a report, and exits without resetting BrowserGym or contacting ServiceNow.

After gated access is approved, the reset/export path can be exercised explicitly:

```bash
npm run benchmark:workarena:held-session -- --task workarena.servicenow.all-menu --allow-servicenow-reset
```

The bridge protocol supports:

| Command | Purpose | Requires reset | Mutates ServiceNow |
| --- | --- | --- | --- |
| `describe` | report protocol capabilities and current state | No | No |
| `reset` | create the BrowserGym task and keep the environment alive | No | Yes |
| `export_session` | return Playwright storage state, active URL, and open pages | Yes | No |
| `validate` | run WorkArena validation against the held environment | Yes | No |
| `teardown` | close task, chat, context, and browser | No | No |

The current CLI tears down before exit when it exercises reset. The future agent runner will keep the same bridge process alive, import the exported session into the OpenSidebar extension browser, run the agent, then call `validate` and `teardown`.

Held-session reports are written to:

```text
.artifacts/e2e/workarena-held-session-YYYY-MM-DD-<task-id>.json
```

## Report Schema Validation

Validate generated WorkArena JSON reports without contacting ServiceNow:

```bash
npm run benchmark:workarena:validate-reports
```

Validate a specific report:

```bash
npm run benchmark:workarena:validate-reports -- --file .artifacts/e2e/workarena-run-YYYY-MM-DD-workarena.servicenow.all-menu.json
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
- the future `agent-execution` report shape

The future execution result schema reserves stable fields for task id, seed, real WorkArena or local fixture prompt, start URL, trace ids/files, final answer, turns, perceptions, tool counts, tokens, cost, validation result, timings, and failure stage. Failure stages are fixed to `setup`, `reset`, `extension_launch`, `agent_run`, `validation`, and `teardown`.

## Local Copy Suite

Run the local copy suite before attempting real WorkArena:

```bash
npm run test:e2e:workarena:copy
```

The default copy suite is no-token and no-ServiceNow. It runs:

- arena registry validation
- one local `agent-execution` contract report for each `workarena-gap` task
- browser attach strategy probe
- held-session protocol probe
- session state import E2E for cookies and origin storage in the extension browser
- WorkArena report schema validation

To include the actual local OpenSidebar WorkArena-gap E2E suite, pass `--agent`:

```bash
npm run test:e2e:workarena:copy -- --agent
```

Use `--no-build` only when the extension and fixtures are already built:

```bash
npm run test:e2e:workarena:copy -- --agent --no-build
```

Copy-suite reports are written to:

```text
.artifacts/e2e/workarena-copy-suite-YYYY-MM-DD.md
```

## Next Integration Step

After doctor, list, adapter plan, guarded reset, and dry run are green, add a manual single-task runner that launches WorkArena, hands the goal to OpenSidebar, and invokes the WorkArena evaluator after the agent stops. Real agent execution should remain manual at first because it is token-expensive and depends on remote instance availability.
