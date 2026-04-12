# RFC: Goal-Conditioned Perception (Scope Visual Interpretation to Current Subtask)

## Status
Proposed

## References
- **Prune4Web** (2025): Li et al., "Prune4Web: DOM Tree Pruning Programming for Web Agent" — task-specific scoring programs generated per subtask reduce candidate elements 25-50x while maintaining 88% grounding accuracy. https://arxiv.org/abs/2511.21398
- **FocusAgent** (2025): "FocusAgent: Simple Yet Effective Ways of Trimming the Large Context of Web Agents" — goal-conditioned observation pruning via lightweight LLM. Task-aware pruning (51.5%) vs generic (40%) on WorkArena. https://arxiv.org/abs/2510.03204
- **AgentOccam** (2024/ICLR 2025): Yao et al., "AgentOccam: A Simple Yet Strong Baseline for LLM-Based Web Agents" — pivotal-node selection + plan-compartmentalized history. https://arxiv.org/abs/2410.13825
- **SeeAct** (2024/ICML): Zheng et al., "GPT-4V(ision) is a Generalist Web Agent, if Grounded" — two-stage perception→grounding; visual grounding improves with task-scoped annotation. https://arxiv.org/abs/2401.01614
- **Book 1**: Victor Dibia, *Designing Multi-Agent Systems* (2025). Ch 4 §4.6.2 "Tool Categories" — context budgets should scale with task complexity; Ch 5 §5.2.1 — observation relevance filtering at the action-generation boundary.
- **Book 2**: Antonio Gulli, *Agentic Design Patterns* (2025). Ch 17 "Scaling Inference Law" (lines 2919-2931) — a smaller model with better context can surpass a larger model with noisy context; Ch 6 "Planning" — dynamic context shaping per plan phase.
- **Book 3**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025). Ch 3 "Procedural RAG" — dynamic instruction retrieval scoped to the current execution phase; Ch 4 "Executor" — context materialization at execution time, not plan time.
- **Internal**: `src/background/perception.ts`, `src/background/agent/loop.ts`, `src/background/agent/context.ts`, `prompts/runtime/perception/interpret_page.md`.

## Context

### The Problem: Generic Perception Wastes the Token Budget

The perception module sends a screenshot + element metadata to a vision model (Llama 4 Scout / GPT-4o-mini) and receives a structured 7-section interpretation (~150 tokens). This interpretation is injected into the agent LLM's system prompt as the primary page understanding signal.

**The current prompt is entirely objective-agnostic.** It describes the page generically: layout, state, content, visual-only elements, blockers, spatial relationships, hazards. The only goal-aware component is a bolted-on 8th section (`OBJECTIVE_CHECK`) that evaluates whether the **top-level user query** appears accomplished — but this is a binary check, not a scoping mechanism.

Consider an agent working on step 3 of 5 ("fill the shipping address form") on an e-commerce checkout page. The current perception might report:

```
1. LAYOUT: E-commerce checkout, 3-step wizard.
2. STATE: Step 2 (shipping) active, step 1 complete.
3. CONTENT: Product thumbnails in sidebar show item images.
4. VISUAL-ONLY: Trust badge "SSL Secured" in footer image.
5. BLOCKERS: None.
6. SPATIAL: Form center, order summary right sidebar.
7. HAZARDS: None.
8. OBJECTIVE_CHECK: NOT_DONE — Still on checkout, order not placed.
```

Of these ~150 tokens, only sections 2 and 5 are useful for the current subtask. The agent doesn't need to know about the trust badge, sidebar thumbnails, or footer layout to fill a shipping form. Meanwhile, it **does** need to know: which fields are empty vs pre-filled, whether the "Continue" button is enabled, and if there's a zip-code validation error — details the generic prompt doesn't prioritize.

### What the Research Says

All three major 2025 papers on web agent observation management converge on the same conclusion: **goal-conditioned observation filtering significantly improves agent performance.**

**Prune4Web** takes the strongest position. The planner decomposes the high-level task into subtasks, then each subtask generates a task-specific scoring program (keyword-weight pairs) that filters DOM elements. This reduces candidate elements 25-50x while maintaining grounding accuracy. The key insight: filtering happens at the **subtask level**, not the top-level goal.

**FocusAgent** uses a lightweight LLM as a retriever that takes the task goal + action history to decide which accessibility tree lines to keep. The ablation is definitive: goal-conditioned pruning (51.5%) vs generic/embedding-based (40%) on WorkArena L1. Including the task goal consistently outperforms neutral pruning across all benchmarks tested.

**AgentOccam** approaches it differently — the agent marks "pivotal nodes" as it acts, and when it branches to a new sub-plan, old observations are dismissed. Goal-conditioning is implicit (compartmentalized by subgoal) rather than explicit, but the principle is the same: perception should be relevant to the current objective.

**Gulli (Ch 17)** frames this economically: "A smaller model given a more substantial 'thinking budget' at inference time can occasionally surpass a much larger model." Applied to perception: a vision model given goal-scoped context produces more actionable output than one drowning in generic page description. The perception budget is fixed at ~150 tokens and 600 max_tokens — every token spent on irrelevant layout description is a token not spent on task-relevant detail.

**Rothman (Ch 3)** on Procedural RAG: "Dynamic instruction retrieval scoped to the current execution phase" — perception is effectively a form of dynamic context retrieval, and it should be phase-aware.

### What OpenSidebar Already Has

The infrastructure for goal-conditioned perception is **90% built**:

1. **`PerceptionInput.objective`** — Already accepts an objective string (currently `originalQuery`).
2. **`SubtaskSummary.description`** — The planner already produces human-readable subtask descriptions.
3. **`PlanStatus` in context** — The loop knows which subtask has `status === "running"` at any point.
4. **Fingerprint-based cache** — Already forces fresh perception on step advancement (`lastPerceptionFingerprint = ""`).
5. **`{{objectiveSection}}`** — The prompt template already has a conditional injection point.
6. **Tool profiles** — Steps already carry `toolProfile` (read_only, form_fill, navigate, full) that hints at the nature of the work.

The gap is narrow: the perception prompt doesn't know what the agent is trying to do *right now*, so it can't focus its limited token budget on what matters.

## Proposal

### Core Change: Two-Mode Perception Prompt

Replace the single generic perception prompt with a **dual-mode** prompt that adapts based on whether a subtask is active:

**Mode 1 — Orientation (no subtask):** Used on the first perception call before planning, or for simple one-shot queries. Generic 7-section format optimized for situational awareness. This is close to the current prompt but streamlined.

**Mode 2 — Focused (subtask active):** Used on all subsequent calls when a plan is active. The vision model receives the current subtask description and produces output scoped to that objective.

### Prompt Architecture

The perception prompt gains a `{{focusSection}}` that replaces the generic sections when a subtask is active:

**Orientation mode** (no subtask):
```
You are a perception module for a browser automation agent.
The agent has just arrived on this page and needs situational awareness.

Page: {{title}} ({{url}})
Scroll: {{scrollPosition}}
Interactive elements: {{elementSummary}}

Report (be terse, sentence fragments, no aesthetic commentary):
1. LAYOUT: Page type and visible structure (1 sentence).
2. STATE: Active controls, loading indicators, focused inputs.
3. BLOCKERS: Overlays/modals/banners. Classify each:
   NUISANCE [tagId] "desc" → click [dismissId]
   RELEVANT [tagId] "desc" → reason to keep
   PREREQ "desc" → what must happen first
   If none: "None."
4. VISUAL-ONLY: Text in images/canvas/charts/SVGs the DOM misses.
5. HAZARDS: Invisible text, animated distractors, suspicious duplicates. If none: "None."
```

**Focused mode** (subtask active):
```
You are a perception module for a browser automation agent.
The agent is executing a specific subtask. Focus your analysis on what matters for this step.

CURRENT SUBTASK: {{subtask}}
TOOL PROFILE: {{toolProfile}}

Page: {{title}} ({{url}})
Scroll: {{scrollPosition}}
Interactive elements: {{elementSummary}}

Report (be terse, sentence fragments, no aesthetic commentary):
1. SUBTASK_STATE: What is the current progress toward completing this subtask?
   Describe ONLY what you observe that is relevant to "{{subtask}}".
2. ACTIONABLE: Which visible elements should the agent interact with next
   to advance this subtask? List by [tagId] with brief reason.
3. BLOCKERS: Anything preventing subtask progress. Classify each:
   NUISANCE [tagId] "desc" → click [dismissId]
   RELEVANT [tagId] "desc" → reason to keep
   PREREQ "desc" → what must happen first
   If none: "None."
4. VISUAL-ONLY: Task-relevant text in images/canvas/charts/SVGs the DOM misses.
   Skip visual content unrelated to the current subtask.
5. COMPLETION_SIGNAL: Is this subtask visually complete?
   DONE — evidence | NOT_DONE — what remains | UNCLEAR — why
```

### Data Flow Changes

```
AgentLoop.refreshPerception()
  │
  ├── Resolve current subtask:
  │     planStatus = this.context.getPlanStatusRaw()
  │     running = planStatus?.subtasks.find(s => s.status === "running")
  │     subtask = running?.description || null
  │     toolProfile = running?.toolProfile || null
  │
  ├── Call perceive({
  │     ...existing fields,
  │     objective: this.originalQuery,
  │     subtask: subtask,           // NEW
  │     toolProfile: toolProfile,   // NEW
  │   })
  │
  └── perception.ts selects prompt mode:
        if (input.subtask) → focused template
        else               → orientation template
```

### Interface Changes

```typescript
// perception.ts
export interface PerceptionInput {
  screenshotDataUrl: string;
  elements: TaggedElement[];
  url: string;
  title: string;
  scroll: { y: number; maxY: number };
  /** Top-level user objective (for orientation mode fallback) */
  objective?: string;
  /** Current subtask description — triggers focused mode */
  subtask?: string;
  /** Tool profile hint (read_only, form_fill, navigate, full) */
  toolProfile?: string;
}
```

```typescript
// PerceptionResult gains structured completion signal
export interface PerceptionResult {
  interpretation: string;
  usage?: TokenUsage;
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
  /** Replaces objectiveCheck — now scoped to subtask when available */
  completionSignal?: CompletionSignal;
}

export type CompletionSignalStatus = "done" | "not_done" | "unclear";

export interface CompletionSignal {
  status: CompletionSignalStatus;
  evidence: string;
  /** Whether this is a subtask-level or objective-level signal */
  scope: "subtask" | "objective";
}
```

### Agent System Prompt Update

The `## Reading Page Interpretation` section in `system.md` must be updated to explain both modes:

```markdown
## Reading Page Interpretation
Page Interpretation adapts to context:
- **Orientation mode** (no active subtask): LAYOUT, STATE, BLOCKERS, VISUAL-ONLY, HAZARDS.
  Use this to understand what page you're on and identify obstacles.
- **Focused mode** (subtask active): SUBTASK_STATE, ACTIONABLE, BLOCKERS, VISUAL-ONLY, COMPLETION_SIGNAL.
  SUBTASK_STATE tells you progress. ACTIONABLE lists next elements to interact with.
  COMPLETION_SIGNAL tells you if the subtask is visually done — trust it before calling done().
Trust VISUAL-ONLY for content that DOM inspection misses.
If interpretation seems stale after dynamic changes, call read_page.
```

### Caching Strategy

**Cache key remains unchanged** — URL + element count + element signature hash. Rationale:

1. Step advancement already forces a cache bust (`lastPerceptionFingerprint = ""`).
2. Same page + same elements + different subtask → this only happens when a step completes without any DOM change. In this case, the forced refresh on step advancement handles it.
3. Adding subtask to the cache key would increase cache misses ~2-3x on multi-step tasks with no practical benefit, since the step-advancement bust already covers the transition.

### What Changes in Each File

| File | Change | Risk |
|------|--------|------|
| `perception.ts` | Add `subtask`/`toolProfile` to `PerceptionInput`, branch prompt selection, replace `ObjectiveCheck` with `CompletionSignal` | Medium — prompt change affects all perception output |
| `prompts/runtime/perception/interpret_page.md` | Split into orientation + focused templates (or use conditional `{{focusSection}}`) | Medium — prompt engineering is the core risk |
| `loop.ts` | Thread current subtask description + toolProfile into `perceive()` call | Low — 5-line change at call site |
| `context.ts` | Update `## Reading Page Interpretation` documentation | Low |
| `prompts/runtime/agent/system.md` | Update perception reading instructions | Low |
| `prompts/manifest.json` | Bump version, add new prompt if split into two files | Low |
| `types/index.ts` | Add `CompletionSignal` type if not inlined in perception.ts | Low |
| Tests | Update perception tests for dual-mode behavior | Low |

## Dangers

### D1: Focused mode misses critical off-task signals

**Risk: HIGH.** If the vision model is told to focus on "fill shipping form," it might not report a session-expiry modal, a CAPTCHA, or a price-change banner that appeared. These are task-blocking but not task-scoped.

**Mitigation:** BLOCKERS section is present in **both** modes and is explicitly NOT scoped to the subtask. The instruction says "Anything preventing subtask progress" — this naturally captures off-task blockers because they prevent progress. HAZARDS is also retained. The key: never tell the vision model to ignore non-task content; instead, tell it to *prioritize* task content while still reporting blockers.

### D2: Subtask descriptions may be vague or misleading

**Risk: MEDIUM.** The planner generates subtask descriptions like "Complete the checkout process." If the description is too vague, focused perception adds no value over generic — or worse, the vision model hallucinates specificity.

**Mitigation:** The planner prompt (`decompose_system.md`) already requires concrete `objective` fields. If a subtask description is too short (<10 chars) or too generic, fall back to orientation mode. The focused mode should degrade gracefully, not catastrophically.

### D3: COMPLETION_SIGNAL false positives trigger premature step advancement

**Risk: MEDIUM.** If the vision model says "DONE" for a subtask and the loop trusts it, the agent might skip verification. For example, a form submission that shows a loading spinner might look "done" visually before the confirmation page loads.

**Mitigation:** COMPLETION_SIGNAL is an **advisory signal**, not a control signal. The actual step advancement is gated by `advanceCompletedSubtasks()` which requires the agent LLM to explicitly call tools or `done()`. The planner's `verifyAfter` gates provide a second check. The signal helps the agent *decide* to advance, but doesn't *force* advancement.

### D4: Two prompt modes increase maintenance surface

**Risk: LOW.** Instead of one perception prompt, there are now two code paths. Prompt drift between modes could cause inconsistent behavior.

**Mitigation:** Both modes share the same structural principles (terse, section-based, blocker classification). The focused mode is a strict subset — it removes generic sections and adds task-scoped ones. Keep both in the same prompt file with conditional blocks rather than two separate files.

### D5: Vision model may not reliably follow the focused format

**Risk: LOW-MEDIUM.** Smaller vision models (Llama 4 Scout) might not consistently produce the SUBTASK_STATE/ACTIONABLE/COMPLETION_SIGNAL format, especially for unusual subtask descriptions.

**Mitigation:** The parsing is already lenient (regex-based extraction). If COMPLETION_SIGNAL is missing, treat it as `unclear`. The agent LLM already has the full element list and plan status — perception supplements but doesn't replace the agent's own reasoning.

### D6: Increased prompt length for focused mode

**Risk: LOW.** The focused prompt includes the subtask description and tool profile, adding ~30-50 tokens to the input. With max_tokens=600 and temperature=0.1, this is well within budget.

**Mitigation:** Subtask descriptions are capped by the planner. Tool profile is a single word. Total input increase is negligible.

## Opportunities

### O1: Higher signal-to-noise in perception output

The primary win. Instead of spending 150 tokens on generic layout description, the vision model spends them on "which form fields are empty, is the submit button enabled, is there a validation error." This directly reduces the reasoning burden on the agent LLM.

### O2: ACTIONABLE section creates implicit tool-call suggestions

The focused mode's ACTIONABLE section lists elements by tag ID with reasons. This is effectively a grounded recommendation: "click [23] — the 'Continue' button is now enabled." The agent LLM doesn't have to scan 50 elements to find the right one — perception already did the visual grounding.

### O3: COMPLETION_SIGNAL enables faster step transitions

Currently the agent must reason about whether a subtask is done based on the generic page interpretation + its own judgment. A focused COMPLETION_SIGNAL gives it a visual ground-truth check: "the confirmation message is visible, the form is gone." This should reduce unnecessary extra turns after a subtask is actually complete.

### O4: Tool profile hint improves perception relevance

Telling the vision model `TOOL PROFILE: form_fill` helps it understand the *type* of interaction expected. For a form_fill step, it knows to look for input fields, validation errors, and submit buttons. For a navigate step, it looks for links, breadcrumbs, and search bars. This aligns perception output with the tools actually available to the agent.

### O5: Natural integration with plan monitoring

The `monitor_step_system.md` planner prompt already checks alignment between perception and expected state. Focused perception produces subtask-specific state descriptions that are directly comparable to the `expectedState.description` from the planner — a better input for the monitor than generic page layout.

### O6: Reduced perception→agent reasoning chain

With generic perception, the agent LLM must: (1) read generic page description, (2) recall current subtask from plan status, (3) filter relevant details mentally, (4) decide action. With focused perception: (1) read subtask-scoped description with actionable elements, (2) decide action. This shortens the reasoning chain by removing the mental filtering step.

## Migration Plan

### Phase 1: Dual-mode prompt (this RFC)
- Add `subtask` and `toolProfile` fields to `PerceptionInput`
- Implement prompt branching in `perceive()`
- Thread subtask from `planStatus` into `perceive()` call in `loop.ts`
- Update `interpret_page.md` with both modes
- Update `system.md` reading instructions
- Ship behind no flag — the change is safe because:
  - No subtask (one-shot queries) → orientation mode → equivalent to current behavior
  - With subtask → focused mode → strictly more informative

### Phase 2: Tune and validate (follow-up)
- Run eval pipeline on recorded traces: compare generic vs focused perception
- Measure: turns-to-completion, step-advancement accuracy, false-positive rate on COMPLETION_SIGNAL
- Tune prompt wording based on eval results
- Consider adding `previousStepResult` to focused mode context for continuity

### Phase 3: Element-level scoping (future, optional)
- Inspired by Prune4Web: instead of sending all 50 elements to the vision model, pre-filter elements by subtask relevance
- This is a separate concern from prompt scoping and can be layered on later
- Requires element scoring infrastructure that doesn't exist yet
