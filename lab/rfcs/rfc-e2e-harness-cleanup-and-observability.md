# RFC: E2E Harness Observability Improvements

**Status**: Draft
**Date**: 2026-04-11
**Author**: Codex
**Affects**: `tests/e2e/helpers/diagnostics.ts`, harness debugging workflow, E2E reporting

## Problem

The harness currently observes only a narrow slice of runtime behavior during E2E runs.

That makes it harder to distinguish:

- product failures
- harness synchronization failures
- provider and transport failures

The continuation investigation showed this directly. Better observability would have reduced diagnosis time substantially.

## Diagnosis

Observability is intentionally partial today:

- the event monitor records only a subset of runtime messages
- event history is capped
- console output is filtered aggressively for readability
- trace attribution still depends partly on filesystem heuristics

Those choices are fine for normal local runs, but they are limiting when the harness itself is under investigation.

## Proposed Solution

Add a diagnostic observability mode without changing reset or isolation semantics.

## Observability Modes

### Default mode

Purpose:

- readable local output
- enough signal for normal debugging

### Diagnostic mode

Purpose:

- preserve broader runtime evidence when a harness or lifecycle bug is suspected

Capabilities:

- larger or uncapped event history
- reduced console filtering
- explicit provider and transport error capture
- stronger trace-to-workspace/run mapping

This should be selectable without patching harness code for each investigation.

## Trace Attribution

Trace ownership should move away from filesystem timing heuristics where possible.

Preferred order:

1. workspace or run identifier emitted into trace records
2. helper-side filtering by that identifier
3. timestamp ordering only as fallback

This matters more as retries, replans, and multi-trace workflows become common.

## Why this is the right fix

When the harness is under suspicion, narrow logs are the wrong default.

Better observability makes failure classification faster and cheaper:

- provider/transport failure
- harness synchronization failure
- product assertion failure

## Non-Goals

This RFC does not propose:

- changing reset semantics
- printing every log line in every run
- replacing trace files with console output

## Recommended Implementation

1. Add a harness diagnostic-mode flag that expands event retention and console visibility.
2. Increase or remove event-buffer caps in diagnostic mode.
3. Improve trace attribution around workspace/run identifiers.
4. Add report output that distinguishes:
   - provider/transport failure
   - harness synchronization failure
   - product assertion failure
5. Add harness self-tests for long-run event retention and trace attribution.

## Files to Modify

| File | Change |
|---|---|
| `tests/e2e/helpers/diagnostics.ts` | Add diagnostic mode and stronger trace attribution |
| `tests/e2e/helpers/harness.ts` | Allow suite-level selection of observability mode |
| E2E reports | Include failure classification and diagnostic metadata |

## Tests

1. Long multi-turn runs do not lose critical early events in diagnostic mode.
2. Console filtering can be relaxed in diagnostic mode without changing default local readability.
3. Trace files are attributed to the correct workspace/run without relying solely on mtime.
4. Reports can distinguish provider/harness/product failure classes.

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected - reason: ___
