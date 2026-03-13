# RFC: Live Benchmark Program

**Date**: 2026-03-13
**Status**: Draft
**Owner**: Agent reliability workstream

## Goal

Make guarded runtime quality the primary optimization target and measure it directly from live sessions and stable fixtures.

## Why

The current repo now shows a large gap between:

- raw first-action critique
- guarded recovery-aware execution

That means the evaluation stack must reflect the pipeline that actually ships.

## Primary KPI

1. Live session success rate
2. Recovery-aware critique pass rate
3. Raw critique pass rate

Use this order for decision-making.

## Phase 1: Live Benchmark Harness

### Deliverables

1. `evals live-benchmark` CLI command
2. Markdown report generated from `traces/index.jsonl`
3. Filters for:
   - latest N sessions
   - localhost/fixture-only runs
   - query substring
   - URL substring
   - last N days

### Metrics

- success rate
- outcome distribution
- failure category distribution
- avg/median turns
- avg LLM calls
- avg session time
- avg LLM time
- avg cost
- host distribution

### Exit Criteria

- Can produce a report from current local traces in one command
- Report is stable and test-covered

## Phase 2: Controller Metrics

### Deliverables

1. Trace-summary extraction for:
   - guard trigger rate
   - recovery trigger rate
   - repeated-action blocks
   - forced direct-action conversions
   - escalation precision
   - filtered tool counts
2. Runtime trace report grouped by session

### Exit Criteria

- Can explain a success-rate change with controller-level metrics, not only outcome counts

## Phase 3: Stable Fixture Bundle

### Deliverables

1. Small e2e bundle, one case per major pathology
2. Standard benchmark command for those fixtures
3. Report with:
   - completed or not
   - turns
   - cost
   - controller interventions

### Exit Criteria

- Can run a stable fixture benchmark before/after a pipeline change

## Phase 4: Correlation Report

### Deliverables

1. Report comparing:
   - raw critique
   - critique-recovery
   - live benchmark
2. Per-pathology agreement/disagreement view

### Exit Criteria

- We know which benchmark best predicts real failures

## Immediate Checklist

- [x] Add a first live-benchmark report generator from session traces
- [ ] Add CLI command and README docs
- [ ] Add deterministic tests for session summarization
- [ ] Run localhost fixture benchmark and save first report
- [ ] Add controller-level metrics into traces
- [ ] Add fixture-bundle benchmark command
- [ ] Add correlation report across critique / recovery / live

## Decision Rule

Promote a change only if it improves at least one primary KPI without causing a material regression in:

- median turns
- avg cost
- avg session time

Raw critique alone should no longer block shipping a runtime improvement if live benchmark and recovery-aware results improve.
