# WorkArena First Smoke Test Checklist

Use this checklist for the first guarded live WorkArena run after Hugging Face access to `ServiceNow/WorkArena-Instances` has been approved.

## Objective

Run the first live OpenSidebar WorkArena smoke against:

```text
Task: workarena.servicenow.all-menu
Seed: 0
```

This task is preferred for the first run because it is navigation/menu-oriented and lower risk than record creation, update, deletion, or communication tasks.

## Prerequisites

- [ ] Hugging Face access is approved for `ServiceNow/WorkArena-Instances`.
- [ ] `HUGGING_FACE_HUB_TOKEN` is set in the shell or repo-local `.env`.
- [ ] The OpenSidebar E2E provider key is set, usually `FIREWORKS_API_KEY`.
- [ ] WorkArena Python dependencies are installed under `.artifacts/workarena/.venv`.
- [ ] The OpenSidebar extension build succeeds.
- [ ] The operator accepts that commands with `--allow-servicenow-reset` may reset or mutate a remote ServiceNow WorkArena instance.

## Setup

Install or refresh the local WorkArena Python environment:

```powershell
npm run benchmark:workarena:setup
```

Build the extension:

```powershell
npm run build
```

Pass criteria:

- [ ] WorkArena setup completes without dependency errors.
- [ ] Extension build completes successfully.

## Gate 1: Strict Readiness

Run the doctor without pending-access allowances:

```powershell
npm run benchmark:workarena:doctor
```

Pass criteria:

- [ ] `Ready: yes`.
- [ ] `Status: ready`.
- [ ] Python executable is resolved.
- [ ] `huggingface_hub` import passes.
- [ ] `browsergym-workarena` import passes.
- [ ] BrowserGym, `gymnasium`, Playwright, and Chromium checks pass.
- [ ] Gated dataset access check passes.

Stop if:

- [ ] Hugging Face access is still reported as pending.
- [ ] Python, BrowserGym, Playwright, or Chromium is missing.
- [ ] The token is missing or rejected.

## Gate 2: Candidate Confirmation

Confirm the first-run candidate:

```powershell
npm run benchmark:workarena:first-task -- --seed 0
```

Pass criteria:

- [ ] The command completes without resetting ServiceNow.
- [ ] The selected or top-ranked task is low risk.
- [ ] Expected first task is `workarena.servicenow.all-menu`.
- [ ] The printed handoff command includes `--seed 0` and `--allow-servicenow-reset`.

## Gate 3: Dry Run

Run a real BrowserGym reset and teardown without starting OpenSidebar:

```powershell
npm run benchmark:workarena:dry -- --task workarena.servicenow.all-menu --seed 0 --show-browser
```

Pass criteria:

- [ ] BrowserGym reset succeeds.
- [ ] Real WorkArena goal is captured.
- [ ] Start URL is captured.
- [ ] Active URL is captured.
- [ ] Open pages are captured.
- [ ] Teardown succeeds.
- [ ] A dry-run report is written under `.artifacts/e2e/`.

Stop if:

- [ ] Reset fails.
- [ ] Goal is empty.
- [ ] Active URL is missing.
- [ ] Teardown fails in a way that leaves the environment uncertain.

## Gate 4: Held Session Bridge

Exercise the held-session bridge reset, export, validation, and teardown path:

```powershell
npm run benchmark:workarena:held-session -- --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset --show-browser
```

Pass criteria:

- [ ] Bridge starts and reports protocol capabilities.
- [ ] Reset succeeds.
- [ ] Session export succeeds.
- [ ] Validation command responds.
- [ ] Teardown succeeds.
- [ ] `next.canImportSessionIntoExtensionBrowser` is true when reset/export succeeds.
- [ ] A held-session report is written under `.artifacts/e2e/`.

Stop if:

- [ ] Session export fails.
- [ ] Validation command cannot reach the held environment.
- [ ] Teardown fails in a way that leaves the ServiceNow state uncertain.

## Gate 5: First Live OpenSidebar Handoff

Run the first live OpenSidebar agent handoff with conservative limits:

```powershell
npm run benchmark:workarena:handoff -- --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset --show-browser --max-turns 12 --timeout-ms 300000
```

Pass criteria:

- [ ] Strict doctor passes before reset.
- [ ] Held BrowserGym session starts.
- [ ] WorkArena session state imports into the OpenSidebar extension browser.
- [ ] OpenSidebar navigates to the exported active WorkArena URL.
- [ ] Agent starts from the real WorkArena goal.
- [ ] Agent events are captured.
- [ ] Trace files are produced.
- [ ] WorkArena validation runs against the held environment.
- [ ] Execution report is written under `.artifacts/e2e/`.

Stop if:

- [ ] Extension browser cannot launch.
- [ ] Session import fails.
- [ ] Active tab cannot be resolved.
- [ ] Agent never leaves idle state.
- [ ] Agent times out before producing useful trace evidence.
- [ ] Validation cannot run.

## Gate 6: Report Validation

Validate generated WorkArena reports:

```powershell
npm run benchmark:workarena:validate-reports
```

Pass criteria:

- [ ] Doctor report validates.
- [ ] Dry-run report validates.
- [ ] Held-session report validates.
- [ ] Handoff execution report validates.

## First Smoke Success Criteria

The smoke test is successful when all of the following are true:

- [ ] `benchmark:workarena:doctor` reports ready.
- [ ] Dry run captures a real goal and active URL.
- [ ] Held-session reset/export/validate/teardown path works.
- [ ] Handoff imports the session into the extension browser.
- [ ] OpenSidebar performs at least one real agent run against the WorkArena goal.
- [ ] WorkArena validation is executed.
- [ ] JSON reports are written under `.artifacts/e2e/`.
- [ ] `benchmark:workarena:validate-reports` passes.

## Evidence To Keep

Keep generated artifacts local under `.artifacts/e2e/`:

- [ ] `workarena-doctor-YYYY-MM-DD.json`
- [ ] `workarena-first-task-YYYY-MM-DD-*.json`
- [ ] `workarena-dry-YYYY-MM-DD-workarena.servicenow.all-menu.json`
- [ ] `workarena-held-session-YYYY-MM-DD-workarena.servicenow.all-menu.json`
- [ ] `workarena-handoff-YYYY-MM-DD-workarena.servicenow.all-menu.json`
- [ ] Trace files referenced by the handoff report

Do not move generated reports into `docs/`.

## Follow-Up Decisions

- [ ] Decide whether to enable the E2E visible rail inside the WorkArena handoff runner.
- [ ] Decide whether the first passing smoke should be repeated with a slightly higher `--max-turns`.
- [ ] If the smoke fails, classify the first failure stage: `setup`, `reset`, `extension_launch`, `agent_run`, `validation`, or `teardown`.
- [ ] File a GitHub issue for any real product bug or reusable cleanup that is not fixed immediately.
