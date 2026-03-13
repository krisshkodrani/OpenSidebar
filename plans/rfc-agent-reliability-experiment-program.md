# RFC: Agent Reliability Experiment Program

**Date**: 2026-03-12
**Status**: Draft
**Goal**: Improve end-to-end browser-agent reliability with changes that are measurable, reproducible, and supported by both repository evidence and relevant literature.

## Problem

OpenSidebar's runtime agent has evolved into a guarded execution system with middleware, stagnation handling, strategy pivots, tool recovery, and prompt-driven planning. However, the main critique benchmark still evaluates mostly the model's **first emitted tool choice** rather than the behavior of the **full guarded runtime loop**.

This creates two problems:

1. **Measurement mismatch**: improvements in `src/background/agent/loop.ts` can improve live behavior without moving the top-line critique score.
2. **Optimization mismatch**: the team risks over-optimizing for prompt phrasing and first-action prediction instead of end-to-end recovery and completion.

Current repository evidence:

| Area | Observation | Evidence |
|------|-------------|----------|
| Runtime agent | Execution is guarded by pre-dispatch checks, middleware, stagnation handling, and strategy pivots | `src/background/agent/loop.ts`, `src/background/agent/middleware.ts` |
| Tool-space control | Tool filtering exists, but only via coarse `toolProfile` values | `src/background/agent/planner.ts`, `src/background/agent/loop.ts` |
| Eval behavior | Critique replays one LLM response and scores the actual first tool calls | `evals/cli.ts`, `evals/runner.ts`, `evals/scorer.ts` |
| Prompt governance | Local notes already identify prompt drift and oversized context as systemic risks | `books/notes/prompt-management-notes.md` |

Recent evidence from this repo:

| Eval | Result |
|------|--------|
| Main critique rerun | 4/13 pass |
| Focused find_element_loop | 0/2 pass |
| Focused marathon_no_done | 0/2 pass |

The most important result is not that the guardrails "failed." It is that the current eval does not faithfully measure the runtime pipeline being improved.

## Literature Basis

This RFC is informed by the following primary sources:

1. **ReAct** — intertwined reasoning and acting works best when actioning is grounded and iterative, not purely one-shot.
   - https://arxiv.org/abs/2210.03629
2. **Reflexion** — explicit feedback and memory improve agent performance more reliably than adding more prompt text.
   - https://arxiv.org/abs/2303.11366
3. **Mind2Web** — web-agent performance depends heavily on constraining the web action space and grounding decisions in local context.
   - https://arxiv.org/abs/2306.06070
4. **WebArena** — realistic web tasks are long-horizon and brittle; first-step correctness is insufficient as the primary success measure.
   - https://arxiv.org/abs/2307.13854
5. **OSWorld** — execution-based evaluation is required for computer-use agents; static next-step judgment alone is not enough.
   - https://arxiv.org/abs/2404.07972

Local book-derived notes support the same direction:

- Prompt quality should be treated as a governed system artifact.
- Context should prioritize actionable state and suppress repetitive low-signal content.
- Eval prompts and runtime prompts should be versioned and measured together.

Source:
- `books/notes/prompt-management-notes.md`

## Research Questions

1. Does a **recovery-aware evaluation** correlate with real runtime quality better than the current first-action critique?
2. Does **narrowing executor tool exposure** improve reliability more than adding prompt instructions?
3. Do **deterministic policy gates** outperform prompt-only anti-pattern guidance on known failure classes?
4. Does **structured failure memory** improve recovery and reduce wasted turns more than textual history alone?
5. After pipeline improvements, which executor model gives the best **success-per-dollar**?

## Hypotheses

### H1: Evaluation Alignment

If critique is upgraded from single-response scoring to guarded multi-turn replay, measured improvement will better match observed live reliability.

### H2: Action-Space Reduction

If the executor sees fewer tools per subtask, wrong-tool-first failures and redundant action loops will decrease materially.

### H3: Deterministic Control Beats Prompt Text

For repeated, known anti-patterns, deterministic pre-dispatch policy enforcement will outperform additional prompt wording.

### H4: Structured Failure Memory

Compact structured memory of prior failed attempts will improve recovery more than longer raw conversation history.

### H5: Model Choice Is Secondary

Until evaluation alignment, action-space reduction, and deterministic control are improved, changing executor model will yield smaller gains than pipeline changes.

## Success Metrics

### Primary Metrics

| Metric | Definition | Why it matters |
|--------|------------|----------------|
| End-to-end completion rate | % tasks completed within turn budget in guarded replay or live trace replay | Best proxy for user-visible quality |
| Recovery-aware pass rate | % eval cases that reach a correct action within N guarded turns | Measures actual runtime behavior |
| Median turns to success | Median turns for successful cases | Captures efficiency without rewarding premature escalation |

### Secondary Metrics

| Metric | Definition |
|--------|------------|
| First-action critique pass rate | Current critique metric for continuity |
| Wrong-tool-first rate | % cases where the first proposed tool is incorrect |
| Redundant-action rate | Repeated same-tool+same-args attempts per task |
| Escalation precision | % escalations that occur on genuinely stuck trajectories |
| Escalation recall | % stuck trajectories that eventually escalate |
| Cost per successful task | Total model cost / successful tasks |
| Median latency to first correct action | Speed to the first grounded move |

### Failure Taxonomy

All results should be bucketed into:

1. visible-element misuse
2. repeated-action cycling
3. disabled/prereq blindness
4. scope overshoot / over-investigation
5. stale-state / wrong-id errors
6. tool-call formatting failures
7. escalation failures

## Experimental Methodology

### General Rules

1. Use a fixed eval set for each comparison.
2. Run each condition at least **3 times** because routed model variance exists.
3. Record:
   - code commit
   - prompt hash
   - model id
   - tool-profile version
   - eval runner version
4. Compare both mean and variance, not just a single pass rate.
5. Promote only changes that improve a primary metric without causing severe regression in another failure class.

### Datasets

Use four datasets in parallel:

1. **Current critique golden set**
   - Purpose: maintain backward compatibility with existing benchmarks
2. **Recovery-aware critique set**
   - Same tasks, but replayed through guarded execution for 2-3 turns
3. **Live trace replay set**
   - Recorded sessions from `traces/` or equivalent run logs where the agent visibly behaved poorly
4. **Manual "felt broken" set**
   - 10-20 high-friction user-observed sessions selected from recent logs

## Phase 1: Evaluation Alignment

### Objective

Build an eval that measures the runtime loop, not only the first raw model response.

### Change

Add a new eval mode: `critique-recovery`

Behavior:
- Replay the case through 2-3 guarded turns
- Apply:
  - prompt override
  - tool recovery from text
  - current loop guardrails
  - feedback injection
  - deterministic blockers
- Score:
  - first proposed action
  - eventual correct action within N turns
  - whether recovery came from the model or from runtime policy

### Files

| File | Change |
|------|--------|
| `evals/runner.ts` | Add guarded replay mode |
| `evals/cli.ts` | Add `critique-recovery` command |
| `evals/scorer.ts` | Add eventual-success and recovery attribution metrics |
| `evals/report.ts` or new report module | Separate first-action vs recovered outcome reporting |

### Experiment

Compare:
- Current critique
- Recovery-aware critique

Against:
- Live replay outcomes on the same cases or closely matched traces

### Decision Criterion

Promote if recovery-aware critique correlates substantially better with live outcomes than current critique.

## Phase 2: Executor Action-Space Reduction

### Objective

Reduce the executor's decision burden by aggressively narrowing tool availability.

### Current State

Tool filtering exists via `toolProfile`, but the vocabulary is too coarse:
- `full`
- `read_only`
- `form_fill`
- `navigate`

### Proposed Change

Expand tool profiles to include narrower execution modes, for example:

- `direct_interact`
- `single_input_submit`
- `submit_with_prereq_check`
- `diagnose_hidden_state`
- `recover_after_failed_submit`
- `navigation_recovery`

The planner must attach one on every subtask where possible.

### Files

| File | Change |
|------|--------|
| `src/background/agent/planner.ts` | Expand profile vocabulary and output requirements |
| `src/background/agent/loop.ts` | Apply stricter profile filtering |
| `src/background/tools/metadata.ts` or profile mapping location | Map tools to finer profiles |

### Experiment

Conditions:
- Baseline profiles
- Moderate reduction
- Aggressive reduction

### Decision Criterion

Promote if wrong-tool-first rate and redundant-action rate drop without materially increasing unrecoverable dead ends.

## Phase 3: Deterministic Policy Layer

### Objective

Move known failure rules from prompt text into explicit machine-enforced policy.

### Proposed Deterministic Policies

1. If the required value is visible, act directly.
2. If submit appears disabled or inert, inspect prerequisites before retrying.
3. If the same code/value has already been rejected repeatedly, stop retrying and escalate or investigate.
4. If `read_page` or `find_element` is proposed when page state is already sufficient, block and redirect.
5. If the goal is already reached by URL or heading, prefer `done()`.

### Files

| File | Change |
|------|--------|
| `src/background/agent/middleware.ts` | Add task-level policy checks or shared policy helpers |
| `src/background/agent/loop.ts` | Integrate policy decisions into pre-dispatch flow |
| `src/background/agent/loop-helpers.ts` | Add reusable state classifiers |

### Experiment

Compare:
- Prompt-only guidance
- Prompt + deterministic policy

### Decision Criterion

Promote if targeted pathologies decrease on both recovery-aware eval and live replay.

## Phase 4: Structured Failure Memory

### Objective

Replace part of the verbose natural-language history burden with compact episodic failure memory.

### Proposed Memory Record

For each significant failed or blocked attempt, store:

- task fingerprint
- page/state fingerprint
- action
- outcome
- suggested recovery move

Retrieve similar memories at turn start and inject a short structured summary.

### Files

| File | Change |
|------|--------|
| `src/background/agent/context.ts` | Add compact failure memory retrieval surface |
| `src/background/agent/loop.ts` | Write memory records on meaningful failure/block |
| `src/background/agent/loop-helpers.ts` | Fingerprinting and retrieval helpers |

### Experiment

Compare:
- no memory
- textual recent-history hints
- structured failure memory

### Decision Criterion

Promote if recovery rate increases and context size does not grow materially.

## Phase 5: Planner-Executor Contract Tightening

### Objective

Make the planner more explicit so the executor behaves as a constrained executor, not a generalist improviser.

### Proposed Planner Contract

Each step should include, where possible:

- `toolProfile`
- expected completion evidence
- expected state description
- disallowed actions
- fallback branch if blocked

### Files

| File | Change |
|------|--------|
| `src/background/agent/planner.ts` | Extend plan schema |
| `src/background/agent/loop.ts` | Enforce stronger step contracts |
| `src/types/agent.ts` or planner types | Add any new plan-step fields |

### Experiment

Compare planner output before and after contract tightening on:
- scope overshoot
- escalation recovery
- prerequisite handling

### Decision Criterion

Promote if subtask completion improves and overshoot drops.

## Phase 6: Model Selection After Pipeline Stabilization

### Objective

Choose the executor model based on stabilized pipeline behavior, not before.

### Candidate Models

- `openai/gpt-oss-120b`
- `openai/gpt-4.1-mini`
- one Gemini Flash variant if still relevant

### Decision Metric

Select on:
- recovery-aware success rate
- live replay success rate
- cost per successful task
- median latency to first correct action

### Decision Criterion

Use the model with the best success-per-dollar after Phases 1-5 are complete.

## Implementation Order

1. **Phase 1: Recovery-aware eval**
   - Highest leverage because it fixes what the team optimizes for
2. **Phase 2: Tool-space reduction**
   - Likely largest immediate runtime gain
3. **Phase 3: Deterministic policy layer**
   - Converts prompt advice into enforceable behavior
4. **Phase 4: Structured failure memory**
   - Improves long-horizon recovery without inflating context
5. **Phase 5: Planner-executor contract**
   - Tightens coordination and reduces ambiguity
6. **Phase 6: Model selection**
   - Final tuning after the pipeline is sound

## Deliverables

### D1. Measurement Infrastructure

- `critique-recovery` eval mode
- report format separating:
  - first-action quality
  - recovered outcome quality
  - recovery source attribution

### D2. Runtime Improvements

- narrower tool profiles
- deterministic task policies
- structured failure memory
- stronger planner contract

### D3. Experiment Reporting

For each phase:
- hypothesis
- implementation diff summary
- before/after table
- variance across 3 runs
- pathology-specific changes
- recommendation: keep / revise / revert

## Decision Thresholds

Promote a phase only if:

1. A primary metric improves by a meaningful margin
2. No severe regression appears in another pathology
3. Variance across repeated runs remains acceptable
4. Cost increase, if any, is justified by success increase

Suggested working thresholds:

| Metric | Promotion threshold |
|--------|---------------------|
| Recovery-aware pass rate | +10 percentage points or more |
| Live replay completion | +10 percentage points or more |
| Redundant-action rate | -20% or more |
| Wrong-tool-first rate | -15% or more |
| Cost per success | No more than +15% unless success increase is substantial |

## Risks

| Risk | Mitigation |
|------|------------|
| Overfitting to curated evals | Use live replay and manual broken-session sets in every phase |
| More policy creates brittle blocking | Keep blocked-action reports explicit and inspect false positives |
| Too-narrow tool profiles prevent recovery | Keep `done`, `escalate`, `clarify`, and note/update tools always available |
| Evaluation complexity slows iteration | Keep old critique as a quick diagnostic, new critique as the decision metric |
| Model routing noise masks gains | Run each condition 3 times and compare variance |

## Non-Goals

- Adding many new tools before action-space control is solved
- Doing large prompt rewrites as the main strategy
- Choosing a final executor model before measurement alignment
- Treating first-action critique as the sole optimization target

## Recommendation

The best-results path is:

1. **Fix the benchmark**
2. **Reduce executor choices**
3. **Enforce known rules deterministically**
4. **Add structured recovery memory**
5. **Only then compare models**

This is the highest-confidence sequence supported by:
- the current codebase
- the recent eval behavior
- the literature on browser/computer-use agents
- the local notes already collected in `books/notes`

## Appendix: Repository Anchors

| Concern | File |
|--------|------|
| Runtime guarded execution | `src/background/agent/loop.ts` |
| Policy middleware | `src/background/agent/middleware.ts` |
| Planner tool-profile output | `src/background/agent/planner.ts` |
| Prompt assembly | `src/background/agent/context.ts` |
| Current critique orchestration | `evals/cli.ts` |
| Current replay behavior | `evals/runner.ts` |
| Current critique scoring | `evals/scorer.ts` |
| Prompt governance notes | `books/notes/prompt-management-notes.md` |
