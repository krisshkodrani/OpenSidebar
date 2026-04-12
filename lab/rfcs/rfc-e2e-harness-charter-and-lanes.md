# RFC: E2E Provider Metadata and Execution Lanes

**Status**: Draft
**Date**: 2026-04-11
**Author**: Codex
**Affects**: `tests/e2e/helpers/harness.ts`, E2E reporting and run policy

## Problem

The E2E suite already supports multiple provider configurations through `E2E_PROVIDER`, but the harness and reports do not make that context visible enough.

That creates avoidable ambiguity. A failing E2E run can mean:

- the product is wrong
- the harness is wrong
- the provider was unstable
- some combination of all three

The continuation runs made this concrete. Provider instability and harness bugs were initially mixed together with product behavior.

## Diagnosis

For financial reasons, `Fireworks / Kimi 2.5` is the correct day-to-day development and test provider. That is a valid project constraint.

The problem is not the default provider. The problem is that the suite does not clearly distinguish:

- cheap development runs
- more authoritative validation runs

As a result, the default dev provider can be interpreted too easily as the source of truth for correctness.

## Proposed Solution

Add a lightweight execution-lane concept in reporting and run interpretation.

This RFC intentionally does **not** propose a new lane framework. The existing `E2E_PROVIDER` environment variable remains the mechanism for provider selection.

## Execution Lanes

### 1. Dev lane

Purpose:

- low-cost day-to-day iteration
- rapid smoke testing during implementation

Provider:

- default `Fireworks / Kimi 2.5`

Interpretation:

- good for catching obvious regressions
- not authoritative for ambiguous failures

### 2. Validation lane

Purpose:

- RFC verification
- regression confirmation
- release and merge confidence

Provider:

- the most stable supported provider/model combination

Interpretation:

- primary source of truth when the dev lane is ambiguous

This RFC does **not** require changing the default provider away from Fireworks.

## Reporting Changes

Every E2E report should include:

- lane
- provider
- model
- whether the run is considered authoritative for correctness

Failures should be classified into one of:

- `product`
- `harness`
- `provider`
- `unknown`

This classification can be provisional, but the report should force the distinction.

## Why this is the right fix

This addresses the real evidence problem without fighting the cost constraint.

We keep the cheap development workflow intact while making run interpretation clearer:

- cheap lane for iteration
- stable lane for judgment

## Non-Goals

This RFC does not propose:

- removing Fireworks from the workflow
- requiring every PR to run the expensive validation lane
- adding a heavy lane framework
- changing fixture navigation policy

`allowNavigation: false` remains the correct default for fixture E2Es and is out of scope for this RFC.

## Recommended Implementation

1. Keep `E2E_PROVIDER` as the mechanism for provider selection.
2. Derive a lane label from the chosen provider configuration.
3. Add provider, model, and lane metadata to all E2E reports.
4. Add optional failure-classification fields in reports.

## Files to Modify

| File | Change |
|---|---|
| `tests/e2e/helpers/harness.ts` | Derive and expose lane metadata from existing provider configuration |
| `tests/e2e/helpers/report.ts` | Record provider/model/lane metadata and optional failure classification |
| `docs/e2e-report-*.md` generation path | Include lane and classification output |

## Tests

1. Dev lane defaults to Fireworks when no override is provided.
2. Validation lane is derived from explicit provider override.
3. Reports include provider, model, and lane.
4. Failure classification can be recorded in report output.

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected - reason: ___
