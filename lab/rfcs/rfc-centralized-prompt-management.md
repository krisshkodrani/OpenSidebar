# RFC: Centralized Prompt Management and Build-Time Prompt Templates

## Status
Proposed

## Problem

Prompt logic is currently fragmented across multiple runtime files, UI seed data, and eval helpers. This causes:

- Low inspectability: no single place to review active prompts.
- Drift risk: app prompts and eval prompts evolve independently.
- Prompt bloat: duplicated instructions across system prompt + handoff + runtime nudges.
- Poor governance: no versioned prompt manifest for reproducibility.

The immediate outcome is weaker agent behavior and harder debugging, especially for orchestrator runs.

## Context

Current prompt sources include:

- `src/background/agent/context.ts` (`SYSTEM_PROMPT_TEMPLATE`)
- `src/background/agent/planner.ts` (`DECOMPOSE_SYSTEM`, `VALIDATE_SYSTEM`)
- `src/background/agent/loop.ts` runtime injected nudges/corrections
- `src/prompts/registry.ts` orchestrator verifier/advisory prompts
- `src/background/orchestrator/handoff.ts` executor instruction builder text
- `src/sidepanel/saved-prompts.ts` default seeded user prompts
- `evals/judge.ts` eval judge system/user prompt strings
- `evals/cli.ts` critique prompt template strings
- `src/background/golden/builder.ts` synthetic system prompt builder for eval cases

## Goals

- Create a root-level prompt source of truth for app + evals.
- Make prompts easy to inspect, diff, and version.
- Ensure runtime and evals consume the same compiled prompt artifacts.
- Reduce duplication and clarify role boundaries (planner/executor/verifier).
- Add structured notes under `/books` to tie implementation decisions to references.

## Non-Goals

- Rewriting all agent behavior in this RFC.
- Replacing tool definitions with prompt text.
- Solving all prompt quality issues in one pass.

## Solution

### 1) Root Prompt Directory

Add a root `prompts/` tree:

- `prompts/runtime/agent/system.md`
- `prompts/runtime/planner/decompose.md`
- `prompts/runtime/planner/validate_done.md`
- `prompts/runtime/orchestrator/verifier_system.md`
- `prompts/runtime/orchestrator/advisory_system.md`
- `prompts/runtime/orchestrator/executor_instruction.md`
- `prompts/runtime/reflections/*.md`
- `prompts/ui/default_saved_prompts/*.md`
- `prompts/evals/judge_system.md`
- `prompts/evals/critique_template.md`

Each prompt file uses frontmatter:

```md
---
id: runtime.agent.system
version: v1
owner: agent-runtime
variables:
  - persona
  - current_task
---
...template body...
```

### 2) Build-Time Prompt Compilation

Add `scripts/build-prompts.ts`:

- Read `prompts/**/*.md`
- Validate frontmatter and variables
- Emit:
  - `src/prompts/generated.ts` (compiled templates for runtime/evals)
  - `src/prompts/manifest.json` (id/version/hash/path metadata)

This removes hidden ad-hoc prompt strings from runtime code.

### 3) Shared Runtime/Eval Consumption

App runtime and eval pipeline import from one generated module:

- Runtime prompt retrieval by ID
- Eval prompt retrieval by ID
- Trace emits prompt id/version/hash for each call path

### 4) Guardrails for Prompt Hygiene

- Add lint/CI check to block large hardcoded prompt literals outside:
  - `prompts/`
  - `src/prompts/generated.ts`
- Add consistency tests:
  - every referenced prompt id exists
  - required variables provided at render
  - manifest hash stable across build

### 5) Prompt Surface Rationalization

As part of migration:

- Deduplicate policy text between system prompt and orchestrator handoff.
- Keep dynamic context concise (no giant filler viewport dumps).
- Keep tool-specific behavior in tool definitions, not repeated in all prompts.

## Implementation Plan

### Phase 0: Inventory and Mapping

- Build full prompt map (source file -> target `prompts/` id).
- Tag each prompt by function: runtime policy, role policy, correction, eval, UI seed.

### Phase 1: Introduce Prompt Infrastructure

- Create `prompts/` structure.
- Add compiler script and generated module.
- Add manifest type definitions and loader utilities.

### Phase 2: Migrate Runtime Prompts

- Move system/planner/orchestrator/verifier/advisory prompts.
- Move runtime reflection templates from loop constants into prompt ids.
- Keep behavior unchanged (text parity pass).

### Phase 3: Migrate UI Seed and Evals Prompts

- Move seeded sidepanel default prompts to `prompts/ui/`.
- Move eval judge/critique templates to `prompts/evals/`.
- Update eval runner to accept prompt manifest refs.

### Phase 4: Deduplicate and Simplify

- Remove duplicated sections.
- Split static policy from dynamic per-turn context blocks.
- Add capped rendering rules for dynamic context.

## Testing

- Unit tests:
  - prompt compiler validation
  - prompt rendering variable substitution
  - manifest hash/version generation
- Integration tests:
  - runtime can load compiled prompts
  - evals run with compiled prompt ids
- Regression:
  - trace includes prompt id/version/hash
  - no hardcoded prompt literals left in migrated areas

## Operational Notes

- Prompt changes become reviewable as file diffs under `prompts/`.
- Prompt releases can be tracked by manifest hash snapshots.
- Rollback is straightforward by reverting prompt files + generated artifacts.

## Risks

- Migration churn across many files.
- Temporary mismatch between generated prompts and runtime imports.
- Over-templating may reduce readability if structure is too abstract.

Mitigations:

- Migrate in phases with parity tests.
- Keep template syntax minimal and explicit.
- Gate rollout behind CI checks.

## Impact

- Better prompt quality control and reproducibility.
- Faster debugging of agent failures.
- Cleaner separation between runtime policy, orchestration instructions, and eval prompts.
- Stronger alignment between product behavior and eval signals.
