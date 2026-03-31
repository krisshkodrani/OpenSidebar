# Round-Trip Completion Plan

Date: 2026-03-30

## Goal

Build a reliable, generic solution for round-trip navigation and completion timing so the runtime, orchestrator, and harness only mark tasks complete when the full original objective has been satisfied.

## Problem Summary

Current failures show a consistent class of bugs:

- intermediate step success is treated as whole-task success
- `done()` is still attempted from locally plausible states
- navigation recovery can restore a page without preserving the root objective
- the harness has historically allowed some false-positive completion states

This is not a fixture-specific problem. It is a control-state problem.

## Design Principles

1. Completion must be derived from explicit runtime state, not from model intuition.
2. Step completion, task completion, and session end must be separate states.
3. Navigation tasks must preserve the original task contract across page changes.
4. Final success must require deterministic obligation coverage.
5. Harness and evals must validate the same contract the runtime uses.

## Implementation Plan

### 1. Introduce a First-Class Execution Contract

Extend the current task contract into a runtime contract with explicit fields:

- `required_milestones`
- `required_final_obligations`
- `required_return_targets`
- `required_report_values`
- `completion_mode`

This contract must be derived once from the original user request and remain stable for the entire run.

### 2. Separate Runtime States

Represent these states independently:

- `step_complete`
- `task_complete`
- `session_ended`

Do not allow one to imply another automatically.

### 3. Add Milestone Tracking in the Agent Loop

After each navigation-sensitive or evidence-producing action, evaluate milestone satisfaction from page state:

- `click_element` when navigation or state transition occurs
- `go_back`
- `navigate`
- `read_page`
- `read_element` when it yields required facts

Milestone satisfaction must be stored in controller state, not inferred from chat history alone.

### 4. Make Navigation Steps Target-Aware

Each navigation step must require explicit target evidence such as:

- meaningful URL fragment
- required named entity on the page
- required numeric or data token when applicable

A page may satisfy only the obligations whose target evidence is actually present.

### 5. Replace Loose Step Advancement

Remove advancement paths that infer:

- “the running step is probably complete”
- “the agent moved somewhere, so continue”

Advance a step only when:

- its own milestone predicate is satisfied
- the current page matches the intended target
- the next step is the valid continuation of the original contract

### 6. Make `done()` a Pure Completion Emission

`done()` must succeed only when:

- all required milestones are satisfied
- all required final obligations are satisfied
- final summary covers required entities and values
- return-target constraints are satisfied

If not, reject it with a structured missing-obligations message.

### 7. Remove Implicit Completion Fallbacks

Do not allow success from:

- plain `IDLE`
- “Task complete” step labels
- repeated rejected `done()` attempts
- intermediate verifier acceptance

Only explicit contract-complete state may emit `TASK_COMPLETION: completed`.

### 8. Tighten Orchestrator Root-Task Semantics

Node-level success must not propagate to root-task success unless the root contract is satisfied.

Add a root-level completion checker before:

- node skipping
- completion broadcasts
- session teardown

### 9. Harden Navigation Recovery Separately

Keep navigation recovery distinct from completion logic.

Recovery should include:

- target-aware back verification
- bridge recovery after history restores
- safe fallback navigation only when it preserves contract obligations

Recovery must not invent malformed URLs or narrow the task scope.

### 10. Make the Harness Contract-Aware

E2E helpers should validate reusable contracts instead of relying on incidental success signals.

Each task contract should expose:

- required milestones
- final obligations
- forbidden false-success conditions

Harness output should report:

- which milestones were satisfied
- where objective drift occurred
- whether completion was emitted without full coverage

### 11. Add Matching Offline Evals

Create evals that mirror the runtime contract model:

- round-trip navigation memory
- intermediate-step false completion
- milestone coverage versus summary-only completion
- history navigation recovery

The offline evals should exercise the same control assumptions as E2E.

## Implementation Order

1. execution contract plus milestone state
2. `done()` and completion-event gating on milestone coverage
3. step-advancement rewrite for navigation-sensitive plans
4. orchestrator root-task completion guard
5. harness contract reporting
6. dedicated offline evals

## Verification Order

1. unit tests
   - contract extraction
   - milestone evaluation
   - step advancement
   - completion gating
2. integration tests
   - orchestrator completion semantics
   - navigation recovery semantics
3. live E2E
   - `go-back-navigation`
   - `modal-overlays`
   - `infinite-scroll`
   - `online-shop-boundaries`

## Expected Outcome

This plan should produce a system where:

- intermediate pages cannot masquerade as full completion
- round-trip tasks remain bound to the original objective
- completion is deterministic and auditable
- harness and evals agree with runtime semantics

This is the intended long-term fix path, not a one-off patch for a single fixture.
