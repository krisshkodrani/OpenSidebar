# RFC: Workflow Skills Pipeline for OpenSidebar

**Status**: Draft
**Date**: 2026-04-12
**Author**: Codex
**Affects**: `src/background/orchestrator/`, `src/background/agent/`, `src/prompts/`, `tests/e2e/`, new `skills/` directory

## Problem

OpenSidebar's current browser agent architecture is strong at generic action execution:

- generic DOM and tab tools
- planner / executor / verifier role separation
- workspace-scoped turn memory
- trace capture and E2E validation

That foundation is necessary, but the recent continuation and transactional E2E evidence suggests the next bottleneck is no longer raw tool availability.

The April 12 continuation report shows that memory and contract fixes were enough to recover many continuity tasks, but the remaining hard failures are still long-horizon workflows that require stronger execution discipline than generic tool prompting provides.

Representative signals:

- `continuation-act-check-act` still times out in Turn 1
- `continuation-cart-swap` still exhausts horizon under current provider conditions
- a generic prompt bug around multi-field forms improved behavior when replaced with a more explicit workflow rule

So the current issue is:

> OpenSidebar has generic browser primitives, but it lacks a first-class workflow layer that packages recurring browser-task procedures as reusable, selectively loaded contracts.

## Why generic tools are not enough

The current tool layer should stay broad. Tools like `click_element`, `type_text`, `read_page`, `switch_tab`, and `go_back` are the correct level of abstraction for stable browser primitives.

The problem is not that these tools are too generic.

The problem is that recurring workflows currently rely on:

- generic prompt instructions
- planner heuristics
- verifier retries
- local bug fixes encoded in scattered prompt text

That works for short tasks and some continuation cases, but it becomes brittle for workflows that require:

- ordered multi-phase execution
- intermediate verification before continuing
- state preservation across turns, tabs, or pages
- targeted recovery playbooks
- constrained tool sequencing

## Proposed Solution

Introduce a **workflow skills pipeline**.

In this RFC, a skill is:

> a repo-versioned procedural contract for a recurring workflow class, selected by the planner/orchestrator, loaded progressively, and paired with explicit memory and verification rules

This is intentionally not:

- a replacement for tools
- a replacement for the orchestrator
- a marketplace of arbitrary user macros
- a site-specific script for one fixture page

## Design Principles

1. Keep tools generic and composable.
2. Make skills workflow-shaped, not site-shaped.
3. Load only the selected skill, not the whole skill library.
4. Keep safety, permissions, and browser runtime control in the harness.
5. Couple skills to verifier and memory policy.
6. Derive first-wave skills from trace and E2E evidence, not brainstorming.
7. Start with repo-curated, read-only skills.

## Architectural Placement

The intended stack is:

```text
UI
  -> Orchestrator / Planner
    -> Skill selection + skill loading
      -> Generic browser tools + memory + perception + verification
```

Responsibilities:

- **Tools** define what the browser agent can do
- **Skills** define how to conduct recurring workflows
- **Orchestrator** decides whether a skill is needed and injects it
- **Verifier** checks the selected workflow against explicit criteria

## Skill Granularity

The target granularity is:

- more specific than a primitive capability
- less specific than a single fixture or test case

Good:

- `transactional-act-check-act`
- `cart-modify-checkout`
- `structured-form-fill`
- `continuation-edit`
- `cross-tab-compare`

Too generic:

- `browser-automation`
- `forms`
- `shopping`

Too specific:

- `online-shop-pro-cart-swap-save10`
- `delete-account-email-field-click-confirm`

## Skill Shape

Each skill should have two layers:

1. **Machine-readable descriptor**
2. **Markdown procedure**

The descriptor is for routing and enforcement.
The markdown body is for model-facing workflow guidance.

### Proposed descriptor shape

```typescript
interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  maturity: "draft" | "candidate" | "active";
  preferredTools?: string[];
  discouragedTools?: string[];
  memoryScope?: "turn" | "workspace";
  verifierMode: "deterministic" | "hybrid" | "llm";
  notes?: string[];
}
```

### Proposed runtime contract shape

```typescript
interface LoadedSkillContract extends SkillDescriptor {
  procedureMarkdown: string;
  requiredEvidence?: string[];
  commonFailures?: Array<{
    signal: string;
    recovery: string;
  }>;
}
```

## Progressive Loading Model

OpenSidebar should follow a progressive loading pattern similar to the strongest external skill systems:

1. Keep a compact `SkillDescriptor[]` list available to the planner/orchestrator.
2. When the task matches a workflow class, load the chosen skill body.
3. Load additional references only when the chosen skill explicitly needs them.
4. Pass only a reduced contract summary to the verifier.

Why:

- browser tasks already consume context through page state, tool schemas, and memory briefs
- loading every workflow contract by default will degrade tool-calling precision
- the planner needs routing metadata, not the full skill body

## Routing Model

The orchestrator should decide:

- no skill
- one primary skill
- one primary skill plus one helper skill later if truly needed

This RFC recommends **one primary skill per node** in phase 1.

Routing inputs:

- current user task
- task decomposition output
- workspace turn memory
- current page/app context
- prior trace-derived failure patterns

## Memory Integration

Skills should interact deliberately with memory.

Examples:

- `continuation-edit` should read workspace-scoped turn memory before editing
- `cross-tab-compare` should save normalized facts from each tab before synthesizing
- `cart-modify-checkout` should store the pre-change and post-change cart facts during the task

This RFC does **not** propose a new global memory system. It builds on the workspace-turn memory direction already under discussion.

## Verification Integration

Skills must define how success is checked.

Preferred order:

1. deterministic verification where possible
2. hybrid verification for mixed UI / language outcomes
3. LLM verification only when unavoidable

Examples:

- `structured-form-fill`: deterministic
- `cross-tab-compare`: deterministic or hybrid depending on requested synthesis
- `continuation-edit`: hybrid
- `cart-modify-checkout`: hybrid
- `transactional-act-check-act`: hybrid

## Trace and E2E Integration

Each skill selection should be visible in traces.

At minimum, traces should record:

- selected skill id
- why it was selected
- tool calls used under the skill
- verification mode
- final outcome

Skills should also be tied to E2E targets and recurring failure classes.

Initial evidence sources:

- `docs/e2e-report-2026-04-12.md`
- continuation E2E traces
- transactional and cart failure traces

## Initial Skill Candidates

### 1. `transactional-act-check-act`

Use when a workflow requires mutation, explicit intermediate verification, and then a second action.

Target cases:

- delete / confirm flows
- inspect-then-mutate flows
- gated settings changes

### 2. `cart-modify-checkout`

Use when the user asks to alter an existing cart state before checkout.

Target cases:

- swap one product for another
- remove and replace an item
- apply a discount after cart correction

### 3. `structured-form-fill`

Use when filling multi-field forms with submit-last discipline.

Target cases:

- contact / support forms
- settings forms
- forms with dropdown + text + checkbox combinations

### 4. `continuation-edit`

Use when revising prior work in the same workspace without losing stable prior constraints.

Target cases:

- email draft revision
- reply refinement
- cross-turn edits to in-page content

### 5. `cross-tab-compare`

Use when collecting evidence from multiple tabs or pages before comparing or synthesizing.

Target cases:

- dashboard overview vs reports
- page 1 vs last page comparisons
- cross-tab summarization

## Implementation Plan

### Phase 1: Curated skill scaffolding

1. Add repo-owned `skills/` directory with descriptors and markdown procedures
2. Add a compact skill manifest or descriptor loader
3. Keep skills unused by runtime except for local inspection and design review

### Phase 2: Planner awareness

1. Expose compact skill descriptors to planner/orchestrator
2. Add a simple routing decision: no skill vs selected primary skill
3. Include selected skill id in traces

### Phase 3: Runtime loading

1. Load the chosen skill body into executor instruction assembly
2. Pass reduced verification criteria to verifier
3. Add optional memory hooks per skill

### Phase 4: Evaluation and promotion

1. Add skill-aware trace analysis
2. Tie initial skills to targeted E2E suites
3. Promote or revise skills based on pass/fail evidence

## Concrete File Layout

```text
skills/
  README.md
  workflow/
    transactional-act-check-act/
      descriptor.json
      SKILL.md
    cart-modify-checkout/
      descriptor.json
      SKILL.md
    structured-form-fill/
      descriptor.json
      SKILL.md
    continuation-edit/
      descriptor.json
      SKILL.md
    cross-tab-compare/
      descriptor.json
      SKILL.md
```

## Non-Goals

This RFC does not propose:

- replacing generic browser tools with workflow-specific tools
- allowing the runtime to autonomously create or patch active skills
- shipping site-specific fixture scripts as product behavior
- loading the entire skill library into the base system prompt
- a public skill marketplace

## Risks

### Overfitting risk

If skills are written too narrowly, the system becomes a collection of test-shaped scripts.

Mitigation:

- keep skills workflow-specific, not site-specific
- tie them to multiple task examples

### Context bloat risk

If too many skills are loaded at once, tool precision will degrade.

Mitigation:

- keep only a compact descriptor list in default context
- load one primary skill at a time

### Prompt drift risk

If skill procedures duplicate tool semantics or safety rules, maintenance cost rises.

Mitigation:

- keep tool semantics in tools
- keep safety in harness
- keep workflow discipline in skills

### False confidence risk

If a selected skill is treated as proof of correctness, verification quality may decline.

Mitigation:

- keep explicit verification contracts
- preserve deterministic checks where possible

## Success Criteria

Phase 1 success:

- reviewable skills directory exists
- skill candidates are concrete and non-overlapping

Phase 2 success:

- planner can select a primary skill for matching workflow classes
- selected skill is visible in traces

Phase 3 success:

- target E2E classes show improved reliability without site-specific scripting

## Open Questions

1. Should skill selection happen at the orchestrator task level, node level, or both?
2. Should the verifier receive a normalized criteria block derived from skills rather than raw markdown excerpts?
3. Should skills eventually support helper references or examples, or stay single-file until proven necessary?
4. Should skill descriptors be JSON, TypeScript, or frontmatter-only?

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected - reason: ___
