# WorkArena Setup

This page documents the local setup used to prepare OpenSidebar for real WorkArena benchmark runs. It does not vendor WorkArena into this repository.

## Current Scope

The current integration is a no-token doctor command. It verifies local prerequisites and Hugging Face gated dataset access before we add real task execution.

```bash
npm run benchmark:workarena:doctor
npm run benchmark:workarena:list
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

## Next Integration Step

After doctor, list, and dry run are green, add a manual single-task runner that launches WorkArena, hands the goal to OpenSidebar, and invokes the WorkArena evaluator after the agent stops. Real agent execution should remain manual at first because it is token-expensive and depends on remote instance availability.
