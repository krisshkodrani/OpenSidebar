# RFC: Align Perception Evals with Production v6

**Date**: 2026-03-13
**Status**: Implemented
**Owner**: Eval / Perception
**Scope**: `evals/perception-*`, `evals/golden/perception/*`, `src/background/perception/*`, `prompts/evals/perception_judge_*`

## Status

Implemented on 2026-03-13.

Completed:

- shared v6 prompt-builder used by both production and evals
- v6-aligned perception runner, scorer, judge, and report flow
- offline perception fixture validator
- migrated perception goldens to the v6 schema
- default production perception model switched to `x-ai/grok-4.1-fast`

Frozen perception baseline:

- model: `x-ai/grok-4.1-fast`
- harness: corrected v6 perception harness
- validator: `20 valid, 0 invalid, 1 warning`
- pass rate: `18/20` (`90%`)
- report: [perception-critique-2026-03-13T18-22-13-878Z.md](C:\Users\k_shk\Projects\OpenSidebar\evals\reports\model-compare\perception-critique-2026-03-13T18-22-13-878Z.md)
- raw results: [perception-2026-03-13T18-14-33-349Z.jsonl](C:\Users\k_shk\Projects\OpenSidebar\evals\results\perception\perception-2026-03-13T18-14-33-349Z.jsonl)

This RFC now serves as the implementation record and reporting contract for future perception A/Bs.

## Problem

The original perception eval harness did not measure the production perception contract.

Production uses the unified v6 perception format:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

But the old eval harness depended on the deprecated dual-mode prompt and legacy expectations:

- runner used the legacy prompt builder
- goldens encoded legacy section expectations
- judge rubric explicitly scored legacy section names and completion checks
- scorer mixed in legacy completion-oriented dimensions

This was a harness validity problem first, not a model-quality problem. That harness issue is now resolved.

## Evidence

Confirmed during migration:

- the eval runner originally used the legacy prompt builder in [perception-runner.ts](C:\Users\k_shk\Projects\OpenSidebar\evals\perception-runner.ts)
- production used the unified v6 perception prompt in [perception-agent.ts](C:\Users\k_shk\Projects\OpenSidebar\src\background\perception\perception-agent.ts) and [interpret_page.md](C:\Users\k_shk\Projects\OpenSidebar\prompts\runtime\perception\interpret_page.md)
- extractor, scorer, and judge all encoded legacy assumptions before migration
- some checked-in goldens had inconsistent blocker expectations and placeholder `VISUAL-ONLY` content

Legacy baseline artifact:

- report: [perception-critique-2026-03-13T17-07-16-905Z.md](C:\Users\k_shk\Projects\OpenSidebar\evals\reports\perception-critique-2026-03-13T17-07-16-905Z.md)
- raw results: [perception-2026-03-13T17-03-19-235Z.jsonl](C:\Users\k_shk\Projects\OpenSidebar\evals\results\perception\perception-2026-03-13T17-03-19-235Z.jsonl)

Legacy baseline summary:

| Metric | Value |
|---|---|
| Total cases | 20 |
| Pass rate | 60.0% (12/20) |
| Failed | 8 |
| Avg section completeness | 0.490 |
| Avg signal accuracy | 0.650 |
| Avg blocker detection | 0.544 |
| Avg actionability | 1.000 |
| Avg hallucination | 0.990 |
| Avg composite | 0.717 |

Interpretation:

- the legacy baseline is a reference artifact only
- it is not directly comparable to the corrected v6 harness
- the old failure distribution was dominated by schema mismatch

## Goals

1. Make perception eval prompts match production prompts.
2. Make eval schema match the production output contract.
3. Remove scoring dimensions that production no longer emits.
4. Repair or replace golden fixtures so expected annotations are internally consistent.
5. Produce a measurement framework that can detect both harness-validity improvements and actual model-quality improvements.

## Implemented Changes

### S1: Shared production prompt path

A shared v6 prompt-builder now exists under `src/background/perception/` and is used by both production and evals.

### S2: v6 eval schema

The perception eval schema now uses the production v6 contract only:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

Legacy `mode` and `completionSignal` semantics were removed from the active harness path.

### S3: v6 scorer and judge

The scorer and judge now evaluate v6-aligned dimensions instead of legacy completion-oriented ones. The judge rubric no longer references `LAYOUT`, `STATE`, `SUBTASK_STATE`, `COMPLETION_SIGNAL`, or `OBJECTIVE_CHECK`.

### S4: Fixture validation

An offline validator now rejects invalid perception cases before replay. It checks:

1. non-v6 section names
2. unsupported blocker types
3. invalid blocker tag IDs
4. invalid `mustMentionElements`
5. mixed legacy and v6 schema in the same case

### S5: Production model selection

After the harness was corrected, four perception models were compared on the same 20-case dataset:

| Model | Pass | Fail | Pass Rate |
|---|---:|---:|---:|
| `google/gemini-2.5-flash` | 14 | 6 | 70% |
| `openai/gpt-4.1` | 16 | 4 | 80% |
| `google/gemini-2.5-pro` | 0 | 20 | 0% |
| `x-ai/grok-4.1-fast` | 18 | 2 | 90% |

`x-ai/grok-4.1-fast` is the current best-fit production model for the v6 perception contract and is now the default.

## Measurement Plan

The measurement plan answers two separate questions:

1. Did the harness become valid?
2. Did model quality improve under the corrected harness?

Those remain separate.

### A. Harness Validity Metrics

#### A1. Prompt parity

Definition:

- percent of perception eval runs using the exact same prompt-construction path as production

Target:

- `100%`

#### A2. Schema parity

Definition:

- percent of perception goldens using only v6 section names and v6 blocker taxonomy

Target:

- `100%`

#### A3. Fixture consistency

Definition:

- percent of golden cases passing offline consistency validation

Target:

- `100%`

#### A4. Judge rubric parity

Definition:

- percent of judge rubric references matching production v6 sections only

Target:

- `100%`

### B. Offline Quality Metrics

Primary metrics for future model-quality runs:

- overall pass rate
- average composite score
- blocker precision and recall
- grounded affordances rate
- hallucination rate
- zero-phantom-case rate
- visual-only recall

### C. Agreement Metrics

LLM-as-judge should not be the only source of truth.

Required longer-term checks:

- programmatic scorer vs judge agreement
- scorer vs human reviewer agreement
- judge vs human reviewer agreement

### D. Predictive Validity

The corrected harness should better predict production usefulness than the legacy harness, especially for blocker-heavy and grounding-heavy tasks.

## Success Criteria

### Harness correctness

| Metric | Target | Status |
|---|---|---|
| Prompt parity | 100% | Met |
| Schema parity | 100% | Met |
| Fixture consistency | 100% | Met |
| Judge rubric parity | 100% | Met |

### Current frozen baseline

| Metric | Value |
|---|---|
| Default model | `x-ai/grok-4.1-fast` |
| Validator result | `20 valid, 0 invalid, 1 warning` |
| Pass rate | `18/20` (`90%`) |

## Risks

### R1: Historical score comparability

Legacy and corrected perception scores are not directly comparable because they measure different contracts.

### R2: Migrated golden quality

Some perception goldens were migrated from stored data rather than regenerated from full original traces. That makes the benchmark credible but not perfect.

### R3: Judge subjectivity

Judge subjectivity still exists. Deterministic checks and future reviewer audits remain important.

## Recommendation

Treat this RFC as the accepted baseline contract for future perception work:

1. use the corrected v6 harness for all perception A/Bs
2. require `perception-validate` to pass before trusting score changes
3. compare future perception changes against the frozen `x-ai/grok-4.1-fast` `18/20` baseline
