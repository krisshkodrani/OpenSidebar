# Checklist: Perception Eval Harness Alignment

Source RFC: [rfc-perception-eval-harness-alignment.md](C:\Users\k_shk\Projects\OpenSidebar\plans\rfc-perception-eval-harness-alignment.md)

## Phase 0: Baseline Snapshot

- [x] Archive the latest legacy perception eval report.
- [x] Record the current perception models used for A/B comparison.
- [x] Archive the current `evals/golden/perception/` dataset as legacy fixtures.
- [x] Mark all pre-migration perception reports as `legacy perception harness`.
- [x] Capture a short baseline summary.

Legacy baseline:

- report: [perception-critique-2026-03-13T17-07-16-905Z.md](C:\Users\k_shk\Projects\OpenSidebar\evals\reports\perception-critique-2026-03-13T17-07-16-905Z.md)
- raw results: [perception-2026-03-13T17-03-19-235Z.jsonl](C:\Users\k_shk\Projects\OpenSidebar\evals\results\perception\perception-2026-03-13T17-03-19-235Z.jsonl)
- pass rate: `12/20` (`60%`)
- avg composite: `0.717`

## Phase 1: Shared Production Prompt Path

- [x] Extract shared v6 prompt-builder helper.
- [x] Update production to use the shared helper.
- [x] Update the eval runner to use the same helper.
- [x] Remove eval dependence on the legacy prompt builder.
- [x] Add prompt-parity tests.
- [x] Confirm prompt parity is `100%`.

## Phase 2: Eval Schema Migration

- [x] Remove legacy `mode` from the active perception eval schema.
- [x] Remove legacy `completionSignal` from the active perception eval schema.
- [x] Restrict `requiredSections` to v6 section names.
- [x] Support v6 blocker types including `mismatch`.
- [x] Rewrite the scorer to v6 dimensions.
- [x] Rewrite the judge prompts and parsing to v6 dimensions.
- [x] Confirm schema parity is `100%`.
- [x] Confirm judge rubric parity is `100%`.

## Phase 3: Golden Migration

- [x] Rewrite extraction for v6 section detection.
- [x] Remove legacy orientation and focused derivation.
- [x] Migrate checked-in perception goldens to the v6 schema.
- [x] Remove invalid or placeholder expectations discovered during migration.
- [x] Confirm migrated goldens use only v6 sections.
- [x] Confirm migrated goldens contain no completion-signal expectations.

## Phase 4: Fixture Validator

- [x] Add offline perception validator.
- [x] Reject non-v6 section names.
- [x] Reject unsupported blocker types.
- [x] Reject expected blocker tag IDs not present in the element list.
- [x] Reject `mustMentionElements` not present in the element list.
- [x] Reject mixed legacy and v6 schema in a single case.
- [x] Add validator command to the CLI.
- [x] Fail fast before replay when fixture validation fails.
- [x] Document validation behavior in [README.md](C:\Users\k_shk\Projects\OpenSidebar\evals\README.md).

Current validator result:

- `20 valid, 0 invalid, 1 warning`

## Phase 5: Measurement Framework

- [x] Report overall pass rate.
- [x] Report average composite score.
- [x] Report grounded affordances rate.
- [x] Report hallucination rate.
- [x] Report visual-only recall.
- [ ] Add blocker precision and recall.
- [ ] Add zero-phantom-case rate.
- [ ] Add scorer vs judge agreement reporting.
- [ ] Add reviewer audit process.
- [ ] Add predictive-validity comparison to labeled live traces.

## Phase 6: A/B Rollout

- [x] Choose the baseline model set.
- [x] Re-run the same model set on the corrected harness.
- [x] Preserve the legacy-harness results for side-by-side interpretation.
- [x] Publish the first v6-aligned perception report.
- [x] Separate harness-correction effects from real model-quality effects.

Model comparison on corrected harness:

- `google/gemini-2.5-flash`: `14/20` (`70%`)
- `openai/gpt-4.1`: `16/20` (`80%`)
- `google/gemini-2.5-pro`: `0/20` (`0%`)
- `x-ai/grok-4.1-fast`: `18/20` (`90%`)

## Exit Criteria

### Met

- [x] Prompt parity = `100%`
- [x] Schema parity = `100%`
- [x] Fixture consistency = `100%`
- [x] Judge rubric parity = `100%`

### Remaining

- [ ] Programmatic scorer vs judge agreement `>= 85%`
- [ ] Scorer vs reviewer agreement `>= 85%`
- [ ] Judge vs reviewer agreement `>= 80%`
- [ ] Every future perception A/B report includes blocker precision and recall.
- [ ] Every future perception A/B report includes zero-phantom-case rate.

## Frozen Baseline

- default perception model: `x-ai/grok-4.1-fast`
- validator result: `20 valid, 0 invalid, 1 warning`
- corrected-harness result: `18/20` pass (`90%`)
- canonical report: [perception-critique-2026-03-13T18-22-13-878Z.md](C:\Users\k_shk\Projects\OpenSidebar\evals\reports\model-compare\perception-critique-2026-03-13T18-22-13-878Z.md)
- canonical raw results: [perception-2026-03-13T18-14-33-349Z.jsonl](C:\Users\k_shk\Projects\OpenSidebar\evals\results\perception\perception-2026-03-13T18-14-33-349Z.jsonl)
