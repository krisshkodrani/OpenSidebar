# WorkArena Major Full Run Checklist

Use this checklist before a deliberate full WorkArena run. A full run may reset remote ServiceNow benchmark instances and spend LLM tokens, so do not use it as a debugging loop.

## Preconditions

- [ ] Current branch has a named checkpoint commit.
- [ ] No unrelated local changes are needed for the run, or they are explicitly recorded in the run notes.
- [ ] `npx tsx scripts/workarena-doctor.ts` reports ready.
- [ ] `cmd /c npx nx test extension -- agent.test.ts tools.test.ts` passes after the latest runtime changes.
- [ ] `cmd /c npx tsx scripts/workarena-validate-reports.ts` passes on existing reports.
- [ ] The latest calibrated ServiceNow sample is green, or known failures have linked trace notes and fix owners.
- [ ] The operator explicitly accepts `--allow-servicenow-reset`.

## Calibration Gate

Run the explicit 7-case ServiceNow sample before widening:

```sh
cmd /c npx tsx scripts/workarena-suite.ts --suite atomic --task workarena.servicenow.all-menu --task workarena.servicenow.create-change-request --task workarena.servicenow.filter-incident-list --task workarena.servicenow.knowledge-base-search --task workarena.servicenow.multi-chart-value-retrieval --task workarena.servicenow.order-standard-laptop --task workarena.servicenow.sort-incident-list --seeds 0 --max-turns 20 --retries 0 --allow-servicenow-reset --no-build
```

- [ ] Pass@1 is `7/7`.
- [ ] No report warnings are present.
- [ ] Form and catalog cases do not show avoidable exploration loops.
- [ ] Latest reports validate with `cmd /c npx tsx scripts/workarena-validate-reports.ts`.

## Full Run Setup

- [ ] Choose the target scope: all atomic tasks first, then broaden only if atomic is stable.
- [ ] Use `--retries 0` for the first signal run; add retries only for confidence measurement.
- [ ] Keep `--max-turns 20` unless a category has a documented reason for a different cap.
- [ ] Record provider, executor model, planner model, temperature, and VL settings.
- [ ] Save the exact command in the run notes before executing it.

## During The Run

- [ ] Watch the first failure stage: `setup`, `reset`, `extension_launch`, `agent_run`, `validation`, or `teardown`.
- [ ] Stop widening if a clean product/runtime regression appears.
- [ ] Do not patch prompts, task IDs, seeds, validators, or runner shortcuts mid-run to save a single case.
- [ ] If a case passes validation but reports terminal warnings, inspect the trace before counting it as stable.

## Post-Run

- [ ] Run `cmd /c npx tsx scripts/workarena-validate-reports.ts`.
- [ ] Archive the dated suite and grade reports under `.artifacts/e2e/`.
- [ ] Summarize pass@1, category-balanced pass@1, median turns, p95 turns, warnings, and top token drivers.
- [ ] Inspect the highest-turn passing case in each weak category.
- [ ] Classify every failure by fix layer: runtime primitive, ServiceNow domain adapter, generic skill, planner policy, harness/reporting.
- [ ] Create GitHub issues for real product bugs that are not fixed immediately.
- [ ] Create a checkpoint commit only after the final validation and report schema checks are green.
