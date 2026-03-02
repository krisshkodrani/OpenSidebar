# RFC: Grounding Loop — Situational Awareness and Failure Recovery

**Status**: Draft
**Author**: (system)
**Date**: 2026-03-01
**Traces**: `fdff73ae-659c-4231-b028-8a0da7a5d9f7`, `f86910a7-249a-4145-8f99-d1907b15ecaa`

---

## 1. Problem Statement

Two recorded sessions reveal a family of related failures that share a single root cause: **the agent acts without grounding its actions in observed reality**. It follows instructions, follows heuristics, and follows escalation rules — but it does not verify that its model of the world matches the actual world before committing to action.

### Trace 1 (`fdff73ae`): "Reveal code, proceed to step 2"

- **Outcome**: Completed in 22 turns (1.4 min, $0.046). Should have been ~6–8 turns.
- **Waste**: 12 turns of unproductive exploration. The page text said *"click here 2 more times to reveal"* — the agent ignored this plain-text instruction and instead tried `xray_page`, `hide_element`, `dismiss_overlays`, three `read_element` calls, before finally using `click_coordinates` to bypass a covering div.
- **Escalation**: Executor emitted a text-only response at T3 → immediate escalation to planner at T4. The executor was on the right track (had found the button, clicked it). The planner then ran for 18 turns at ~10× latency.

### Trace 2 (`f86910a7`): "Find code on step 2, proceed to step 3"

- **Outcome**: User-stopped after 11 turns (51s, $0.024). Total failure.
- **Core defect**: The instruction said *"you are now in step 2"* but the browser was on `/step5`. The agent never noticed. Its very first action (T1) was `type_text` — typing a code visible on the step-5 page — before ever reading the page. It then searched for "step 2" content on a step-5 page for 9 more turns.
- **Near-miss**: The planner at T4 actually *detected* the mismatch in its Think block (*"The instruction says we're supposed to be on step 2, not step 5"*) but rationalized it away (*"The current page might be a distraction"*) and continued.

Both traces share the same structural deficiencies: no mandatory observation before first action, no hard contradiction detection between instructions and page state, no cumulative failure analysis during flailing, and excessive context noise from decoy elements.

---

## 2. Root Cause Analysis

We identify five root causes. Each is grounded in agent design literature and traced to specific code paths.

### 2.1 No Observe-Before-Act Gate

**Evidence**: Trace 2 T1 — `type_text({"id":194,"text":"XNJGFD"})` executed as the very first action, before any `read_page`. Trace 1 T3 — clicked element `[87]` labeled "Proceed Forward" when the target was "Click Here" (different element); the agent didn't verify the click result matched its intent.

**Code path**: `AgentLoop.start()` (`loop.ts:935–1118`) receives an optional `initialSnapshot` and sets it in `ContextManager` at line 1074. The snapshot's elements and page content appear in the system prompt via `constructSystemMessage()` (`context.ts:448–591`). But the first LLM call (`loop.ts:2467`) receives this context passively — there is no mechanism requiring the LLM to *acknowledge* the page state before acting. The system prompt says "Observe → Think → Act → Verify" (line 9 of `agent/system.md`) but this is advisory, not enforced.

**Literature**: The *Observe-Think-Act* pattern requires that "the agent must first understand the interface state before planning actions" (Designing Multi-Agent Systems [DMS], §5.2, lines 2387–2390). The *Critical Observation Loop* (DMS §5.5.3, lines 2504–2523) is explicit: *"When a computer use agent clicks a button, it must observe what happened. Did a new page load? Did a form appear? An explicit `observe_page` tool captures both the textual structure and visual appearance of the current page state after every action."* The *ReAct Framework* (Agentic Design Patterns [ADP], Ch.17, lines 2953–2964) mandates that *"thoughts should be interleaved with every action to ensure a logical flow of information gathering and reasoning."*

The current architecture provides observation *data* (the snapshot is in the system prompt) but does not enforce observation *behavior* (the LLM can skip reading it and act on the instruction alone).

### 2.2 Instruction-Reality Mismatch Goes Undetected

**Evidence**: Trace 2 — instruction says "step 2", URL is `/step5`, page content says "Challenge Step 5", code shown is for step 6. The `Pre-execution advisory` system *could* detect this, but it only runs for retried/rerouted nodes (`orchestrator/index.ts:1764–1765`: `if (node.retries > 0 || node.handoffFromNodeId)`). On first execution, no advisory runs. The `buildAssumptionDriftSignal` function (`handoff.ts:228–263`) returned *"No assumption drift evaluation available"* because the planner had no explicit assumptions.

**Code path**: `buildExecutorInstruction()` (`handoff.ts:99–162`) includes the soft directive *"Validate planner assumptions against current page and adjust steps if reality changed"* (line 136). But the executor model (fast, less capable) simply ignored it. The planner model at T4 noticed the mismatch in its Think block but rationalized it away — a classic case of what the Context Engineering book calls *"filling blanks from training-data probability distributions rather than available evidence"* (Context Engineering [CE], Ch.1, lines 350–353).

**Literature**: The *Grounded Reasoning* template (CE, Ch.8, lines 5045–5067) establishes that *"a critical test of AI integrity is groundedness — the engine should correctly report that it lacks necessary context rather than fabricating a response."* The template *"deliberately challenges the agent with tasks outside its knowledge base scope. A successful outcome is an honest 'I don't have that information' rather than a fabricated answer."*

The *Human-in-the-Loop Escalation Policies* pattern (ADP, Ch.13, lines 2224–2234) says agents should escalate *"when task instructions no longer match reality"* — not rationalize the mismatch away. The *Clarification Request* pattern (DMS §4.13.2, lines 2307–2309) says agents should *"pause and ask the user for clarification rather than proceeding with assumptions."*

### 2.3 Premature and Misdirected Escalation

**Evidence**: Both traces escalated from executor to planner at T3/T4 via the text-only escalation path (`loop.ts:5157–5195`). The executor emitted a text-only response (no tool calls), which triggered `consecutiveTextOnly >= 2` (line 5159, with filler fast-tracking at line 5136: `consecutiveTextOnly += filler ? 2 : 1`). Since the executor was on tier 0 and `cooldownRemaining <= 0`, it escalated immediately.

In Trace 1, the executor had been making progress (found button, clicked it, page updated). One text-only response shouldn't undo that progress. In Trace 2, escalating to the planner on the wrong page just produced more expensive wrong actions.

**Code path**: The text-only escalation (`loop.ts:5130–5195`) is aggressive by design — filler text increments the counter by 2 (line 5136), meaning a single filler response can trigger escalation since `consecutiveTextOnly` goes from 0 to 2, meeting the `>= 2` threshold at line 5159. There is no consideration of whether the executor was *making progress* before the text-only response. The existing progress tracking (`actionEffect.deltaPercent`, `urlChanged`) at the stagnation monitor level (line 4928+) runs separately and doesn't gate text-only escalation.

**Literature**: The *Scaling Inference Law* (ADP, Ch.17, lines 2919–2931) demonstrates that *"superior results can frequently be achieved from a comparatively smaller LLM by augmenting the computational investment at inference time rather than immediately switching to a larger model."* The *Exception Handling and Recovery* pattern (ADP, Ch.12, lines 2157–2171) defines a graduated response: *"retry → fallback → degradation → escalation"* where escalation is *"the last resort for complex or severe cases, not the first response to difficulty."*

The current text-only escalation is not graduated — it is a one-strike-and-out mechanism. One filler response → immediate expensive model switch. The *Resource-Aware Optimization* pattern (ADP, Ch.16, lines 2754–2770) recommends a *"Critique Agent"* that *"further evaluates response quality and refines the routing logic over time"* — the escalation decision should consider recent progress, not just the latest turn.

### 2.4 No Strategy Learning from Failed Attempts (Flailing)

**Evidence**: Trace 1 T9–T15: seven turns trying different approaches to reach a covered button:

| Turn | Tool | Result | Learning Applied? |
|------|------|--------|-------------------|
| T9 | `click_element [134]` | "Covered by [135]" | — |
| T10 | `hide_element [135]` | Element not found | No — didn't note why |
| T11 | `read_page` | Same state | No — repeated observation |
| T12 | `dismiss_overlays` | "No overlays" | No — didn't conclude [135] isn't an overlay |
| T13 | `read_element [134] aria-label` | None | No — fishing randomly |
| T14 | `read_element [134] data-os-tag` | Just the tag | No — no strategy |
| T15 | `read_element [134] class` | CSS classes | No — still fishing |

Each turn tried a different tool but none built on the failure of the previous one. The agent never synthesized: *"[135] is not a modal (dismiss_overlays says no overlays) and not removable (hide_element failed) → it is regular page content → use `click_coordinates` to bypass."*

Trace 2 T5–T7: two `execute_js` calls returning `undefined` with no adaptation. The tool result even warned: *"Do NOT retry the same script"* — the agent ignored this and wrote another complex script.

**Code path**: The loop has three relevant failure-tracking mechanisms:
1. `FAILED_ACTION_MEMORY` (`constants.ts:166–171`): blocks *exact* repeats of failed tool calls. But all seven approaches in T9–T15 used different tools/args, so none were blocked.
2. `STAGNATION_DETECTION` (`constants.ts:173–181`): triggers reflection at 3 identical outcomes, pivot at 5. But all seven produced *different* outcome fingerprints.
3. `recentOutcomes` sliding window (`loop.ts:2218`): same problem — different outcomes don't trigger the window.

None of these mechanisms synthesize *across* failures to detect the meta-pattern: "multiple approaches to the same sub-goal have all failed."

**Literature**: The *Reflection Pattern* (ADP, Ch.4, lines 656–674) requires that *"the effectiveness of the Reflection pattern is significantly enhanced when the LLM keeps a memory of the conversation. Without memory, each reflection is a self-contained event; with memory, reflection becomes a cumulative process where each cycle builds upon the last."* The current failed-action memory tracks individual failures but does not produce a *cumulative narrative* that the LLM can reason over.

The *Intelligent Retry with Enhanced Context* pattern (DMS §7.5.3, lines 3242–3258) mandates that retries include *"failure analysis: Previous attempt failed because X. Try improving Y and Z."* The *Step Progress Evaluation* pattern (DMS §7.5.2, lines 3206–3240) requires *"structured output"* from evaluation — *"Without structured output, the LLM might return vague assessments like 'looks pretty good' — responses that can't drive retry logic."*

The `extractAttemptSummary()` function (`loop-helpers.ts`) and `summarizeHistory()` (`context-formatting.ts:73–131`) already produce exactly this kind of structured summary — but they are only invoked on escalation or trajectory distillation, not as a mid-session reflection tool.

### 2.5 Context Noise — Decoy Elements Dilute Attention

**Evidence**: Trace 1 T4 — the `read_page` result lists 31 elements, of which 22 are white-on-white buttons with generic labels ("Advance", "Next Step", "Proceed Forward", "Keep Going", etc.). These are decoy elements with `text-color: rgb(255, 255, 255)` and `bg-color: rgb(255, 255, 255)` — literally invisible. Each consumes a line in the element list.

Trace 2 T2 — the `read_page` result includes 100 "Section N: This is filler content. Keep scrolling to find the navigation button" paragraphs. The `pageContent` field was thousands of tokens of repetitive noise. The `pageContentCharLimits` in `context.ts:495–500` allows up to 60,000 characters at `NONE` compression — far more than needed for filler.

**Code path**: `formatSnapshotElements()` (`context-formatting.ts:60–67`) maps *every* element through `formatElementCompact()` with no deduplication. The function does flag `[invisible-text]` when `textColor === bgColor` (line 40–41), which is good — but it still renders each invisible element as a separate line. The `formatElementsWithCompression()` method (`context.ts:692–758`) groups elements by semantic category and collapses groups larger than 8 items (line 742), but this is per-category — if there are 20 invisible buttons, they appear as "Buttons (22): [first 8] ... and 14 more". The filler sections in `pageContent` have no deduplication at all.

**Literature**: The *Context Explosion and Attention Window Displacement* problem (DMS §4.12, lines 2228–2230): *"A research agent that works perfectly on 5-step tasks starts hallucinating on step 8 of a 10-step workflow — not because the model degraded, but because 45K tokens of accumulated tool results pushed critical instructions out of the attention window."*

The *Context Engineering* book (CE, Ch.1, lines 350–353): *"A prompt opens a door to random chance; a context provides a structured blueprint for a predictable outcome."* The `prompt-management-notes.md` from the project's own literature notes: *"Context load should prioritize actionable state and suppress repetitive low-signal content."*

The *Context Isolation* pattern (DMS §4.12.3, lines 2250–2271) advocates that *"specialist agents operate in their own context bubble, returning only condensed summaries."* The same principle applies to page content: the snapshot should be a condensed summary of the page, not a raw dump of every element and every paragraph.

---

## 3. Proposed Solutions

### 3.1 Mandatory Grounding Assertion (Observe-Before-Act Gate)

**What**: On the first turn of any new session, inject a synthetic grounding assertion into the system prompt that forces the LLM to acknowledge the page state before acting.

**Where**: `ContextManager.constructSystemMessage()` (`context.ts:~440`), conditional on turn count = 0 (first turn).

**Mechanism**: Add a `## Grounding Check` section between `## Current Task` and `## Page Context`:

```
## Grounding Check
You are currently on: {url}
Page title: "{title}"
Step/page identifier from content: "{extracted_step_indicator}"

BEFORE taking any action, verify:
1. Does this page match what your instructions expect?
2. If there is a mismatch (e.g., instructions say "step 2" but page shows "step 5"),
   call clarify() to ask the user — do NOT proceed with assumptions.
```

The `{extracted_step_indicator}` is extracted deterministically from the page content via regex (e.g., `/(step|page|level|phase)\s*(\d+)/i`). This is cheap, runs in the content script or context manager, and provides a concrete anchor for contradiction detection.

**Architectural enforcement**: In `loop.ts`, the first turn's LLM call should have a post-hoc check: if the LLM's first action is a DOM-modifying tool (not `read_page`, `find_element`, or other observation tools), and this is T1 with `clearHistory=true`, inject a warning message: *"You acted without observing. Next turn, verify page state matches your instructions."* This is a soft gate — it doesn't block the action (which might be correct) but ensures the LLM self-corrects on the next turn.

**Why this works**: The *Grounded Reasoning* template (CE, Ch.8) shows that explicitly presenting the agent with a grounding challenge reduces hallucination. By making the page state structurally prominent (not buried in a 2000-token element list), the LLM cannot skip over it. The `clarify` tool already exists (added 2026-03-01) and is the right mechanism for instruction-reality mismatches — this change just ensures the agent knows to use it.

**Scope**: Modify `context.ts` (add grounding section to template), add a `extractStepIndicator()` utility (new, ~20 lines), modify `loop.ts` T1 check (~15 lines).

### 3.2 Deterministic Contradiction Detector

**What**: Before the first LLM call, run a lightweight, deterministic check comparing instruction claims against observed page state. If a contradiction is detected, inject a prominent `[REALITY MISMATCH]` warning or auto-invoke `clarify`.

**Where**: New function `detectInstructionContradiction(instruction: string, snapshot: DomSnapshot)` in `loop-helpers.ts`. Called from `AgentLoop.start()` after snapshot is set, before the first `loop()` iteration.

**Mechanism**:
1. Extract claims from the instruction using regex patterns:
   - Step/page indicators: `/(on|at|in)\s+(step|page|level)\s*(\d+)/i`
   - URL expectations: `/(url|page|site|domain)[:\s]+(\S+)/i`
   - Element expectations: `/(button|link|field|input)\s+["']([^"']+)["']/i`
2. Compare against snapshot: `snapshot.url`, `snapshot.title`, `snapshot.pageContent`
3. If step number in instruction ≠ step number on page → contradiction
4. Return `{ contradictions: string[], severity: "none" | "soft" | "hard" }`

**Hard contradiction** (auto-clarify): instruction says "step 2", page says "step 5" — these are mutually exclusive. Inject:
```
[REALITY MISMATCH — HARD]
Your instructions assume you are on step 2, but the current page is step 5 (URL: /step5).
You MUST call clarify() to ask the user how to proceed. Do NOT assume the page is wrong.
```

**Soft contradiction** (warning only): instruction mentions an element not found on the page. Inject a warning but allow the agent to proceed.

**Why this works**: This is the deterministic layer that prompt engineering cannot provide. The planner in Trace 2 T4 *noticed* the contradiction but rationalized it away — that is expected LLM behavior under ambiguity. A deterministic check is immune to rationalization. The *Reliability and Robustness Under Interface Changes* pattern (DMS §5.6.6, lines 2574–2579) explicitly requires *"adapting to interface changes... implementing robust error handling and recovery mechanisms to gracefully manage unexpected states."* A regex-based contradiction detector is simple, fast (~1ms), and high-precision for the most common failure mode.

**Extending the advisory system**: The existing `Pre-execution advisory` mechanism (orchestrator/index.ts:1764–1800) already provides this for retried nodes. This proposal extends it to *all* first executions by moving the contradiction logic into the loop itself, independent of the orchestrator. The advisory LLM call is expensive (~$0.002); the deterministic regex check is free.

**Scope**: New function in `loop-helpers.ts` (~40 lines), call site in `loop.ts` `start()` (~10 lines).

### 3.3 Progress-Aware Escalation

**What**: Make the text-only escalation decision consider recent progress, not just the latest turn. If the executor was making progress (DOM changes, URL changes) in the last N turns, a single text-only response should not trigger escalation.

**Where**: `loop.ts` lines 5130–5195 (text-only escalation block).

**Current behavior**: A single filler text-only response sets `consecutiveTextOnly += 2` (line 5136), immediately meeting the `>= 2` threshold (line 5159) and triggering escalation.

**Proposed behavior**:
1. **Progress immunity**: If the last `actionEffect` had `deltaPercent > 0.1` or `urlChanged === true`, suppress text-only escalation for this turn. The executor was making progress — one text-only response is likely a transient reasoning step, not a sign of failure.
2. **Graduated counting**: Remove the filler fast-track (`filler ? 2 : 1`). Use `+1` uniformly. Raise the escalation threshold from 2 to 3. This means escalation requires 3 consecutive text-only turns, giving the executor more runway.
3. **Cost-benefit check**: Before escalating, check `this.turnCount`. If `turnCount <= 3`, the executor has barely started — escalation is premature. Require at least 4 turns before text-only escalation is eligible.

**Why this works**: The *Scaling Inference Law* (ADP, Ch.17) shows that giving a smaller model more attempts often outperforms switching to a larger model. The *Exception Handling and Recovery* pattern (ADP, Ch.12) mandates graduated responses. The current one-strike escalation is the opposite of graduated.

The cost math supports this: Trace 1's executor turns cost ~$0/turn (Groq, free tier) with ~600ms latency. The planner turns cost ~$0.003/turn with ~5000ms latency. Three wasted executor turns cost $0 and 1.8s. One wasted planner turn costs $0.003 and 5s. The expected value of patience with the executor is positive.

**Scope**: Modify `loop.ts` text-only handling block (~20 lines changed).

### 3.4 Cumulative Failure Brief (Mid-Session Reflection)

**What**: After N consecutive failed or zero-effect actions targeting the same sub-goal, inject a structured failure summary into the conversation that synthesizes what was tried, why it failed, and what hasn't been tried.

**Where**: New function `buildFailureBrief()` in `loop-helpers.ts`. Called from the main loop after zero-effect actions, injected as a user message.

**Mechanism**:

Track a `subgoalAttempts` buffer that accumulates entries of the form:
```typescript
interface SubgoalAttempt {
  turn: number;
  tool: string;
  args: Record<string, unknown>;
  outcome: string;        // first line of tool result
  wasFailure: boolean;    // error, intercepted, no effect
  snapshotFp: string;     // page state fingerprint
}
```

When `ACTION_EFFECT.WARNING_THRESHOLD` (3) consecutive zero-effect turns are detected (already tracked at `loop.ts` via `zeroEffectConsecutive`), call `buildFailureBrief(subgoalAttempts)` which produces:

```
[FAILURE ANALYSIS — 5 consecutive attempts with no page change]
Approaches tried:
  T9: click_element [134] → blocked by covering element [135]
  T10: hide_element [135] → element not found
  T11: read_page → no new information
  T12: dismiss_overlays → "no overlays found" (element [135] is NOT an overlay)
  T13-15: read_element [134] × 3 → attribute fishing, no actionable result

Synthesis:
- Element [135] covers [134] but is not an overlay and cannot be hidden
- Consider: click_coordinates to bypass, scroll_page to reposition, or escalate

What has NOT been tried: click_coordinates, scroll_page, press_key, navigate
```

The synthesis section is not LLM-generated — it uses deterministic heuristics:
- If `dismiss_overlays` returned "no overlays" → note "element is NOT an overlay"
- If `hide_element` failed → note "element cannot be hidden"
- If `click_element` was intercepted → note "element is covered"
- List tools from `ToolName` enum that haven't been tried on this sub-goal

**Why this works**: The *Intelligent Retry with Enhanced Context* pattern (DMS §7.5.3) requires *"failure analysis: Previous attempt failed because X. Try improving Y and Z."* The *Reflection Pattern* (ADP, Ch.4) requires *"cumulative process where each cycle builds upon the last."* The existing `extractAttemptSummary()` function already produces similar output but is only called on escalation. By calling it earlier and more frequently, we give the LLM the structured feedback it needs to reason about failure patterns.

The *Tree-of-Thought* framework (ADP, Ch.17, lines 2827–2832) enables *"backtracking, self-correction, and exploration of alternative solutions"* — but only if the agent has visibility into which branches have been explored. The failure brief provides exactly this visibility.

**Scope**: New function in `loop-helpers.ts` (~60 lines), new `subgoalAttempts` buffer in `loop.ts` (~20 lines), injection call (~10 lines).

### 3.5 Proactive Context Deduplication

**What**: Reduce context noise by deduplicating elements and compressing repetitive page content at *ingestion* time, before it enters the system prompt.

**Where**: `formatSnapshotElements()` (`context-formatting.ts:60–67`) and `constructSystemMessage()` (`context.ts:494–515`).

#### 3.5a Element Deduplication

**Current**: Each element gets its own line, even if 20 buttons share the same visual properties (white-on-white, invisible).

**Proposed**: In `formatSnapshotElements()`, detect groups of elements that share the same signature:
- Same `tagName`
- Both have `[invisible-text]` flag (text-color = bg-color)
- Different IDs but similar labels

Collapse such groups:
```
[invisible-text group] 15× button (IDs: 97,11,60,7,...): "Advance","Next Step","Proceed Forward","Keep Going",...
```

This preserves the information (the agent knows there are 15 invisible buttons and their labels) without consuming 15 context lines. For Trace 1, this would reduce the element list from 31 lines to ~12 lines, saving ~400 tokens per system prompt.

The `[invisible-text]` flag is already computed in `formatElementCompact()` (line 40–41). This change extends the flag from annotation to compression.

#### 3.5b Repetitive Content Compression

**Current**: `pageContent` is truncated at a character limit (60K at NONE compression, `context.ts:496`) but not deduplicated. Trace 2 had 100 "Section N: This is filler content..." paragraphs consuming thousands of tokens.

**Proposed**: Before injecting `pageContent` into the template, run a deduplication pass:

```typescript
function compressRepetitiveContent(content: string, maxRepetitions: number = 3): string {
  const lines = content.split('\n');
  const seen = new Map<string, number>(); // normalized line → count
  const output: string[] = [];
  let suppressedCount = 0;

  for (const line of lines) {
    const normalized = line.replace(/\d+/g, 'N').trim(); // "Section 42" → "Section N"
    const count = (seen.get(normalized) || 0) + 1;
    seen.set(normalized, count);

    if (count <= maxRepetitions) {
      output.push(line);
    } else if (count === maxRepetitions + 1) {
      suppressedCount++;
      output.push(`[... ${normalized} repeated — omitting further instances]`);
    } else {
      suppressedCount++;
    }
  }

  if (suppressedCount > 0) {
    output.push(`\n[${suppressedCount} repetitive lines omitted]`);
  }
  return output.join('\n');
}
```

This would compress Trace 2's 100 filler sections to: 3 examples + `[... Section N This is filler content. repeated — omitting further instances]` + `[97 repetitive lines omitted]` — saving ~3000 tokens.

**Why this works**: The *Context Engineering* principle (CE, Ch.1) distinguishes between "prompts" (which "open a door to random chance") and "contexts" (which provide "a structured blueprint"). Raw page dumps are prompts — they include everything and let the LLM figure out what matters. Deduplicated, annotated page content is a context — it surfaces signal and suppresses noise.

The *Compaction* principle (DMS §4.12.3, lines 2235–2241) warns that *"overly aggressive compaction loses critical details, while conservative compression fails to reclaim sufficient tokens."* The proposed approach is conservative — it only compresses provably repetitive content (same line normalized for numbers), preserving unique content intact.

**Scope**: New `compressRepetitiveContent()` in `context-formatting.ts` (~30 lines), modify `formatSnapshotElements()` for element dedup (~40 lines), call sites in `context.ts` (~5 lines).

---

## 4. Implementation Order and Dependencies

```
Phase 1 — Grounding (highest impact, lowest risk)
  3.2 Deterministic Contradiction Detector     [~50 lines, loop-helpers.ts + loop.ts]
  3.1 Mandatory Grounding Assertion             [~35 lines, context.ts + new utility]

Phase 2 — Escalation and Recovery
  3.3 Progress-Aware Escalation                 [~20 lines, loop.ts]
  3.4 Cumulative Failure Brief                  [~90 lines, loop-helpers.ts + loop.ts]

Phase 3 — Context Quality
  3.5a Element Deduplication                    [~40 lines, context-formatting.ts]
  3.5b Repetitive Content Compression           [~35 lines, context-formatting.ts + context.ts]
```

Phase 1 addresses the most severe failure (acting on wrong page) with minimal code change. Phase 2 prevents wasted turns. Phase 3 improves signal-to-noise for all sessions.

No changes cross module boundaries (all changes are within `src/background/agent/`). No new dependencies. No changes to the content script, side panel, or messaging protocol.

---

## 5. Testing Strategy

### Unit tests

| Test | File | Validates |
|------|------|-----------|
| `detectInstructionContradiction` | `tests/agent/loop-helpers.test.ts` | Step mismatch, URL mismatch, no contradiction |
| `extractStepIndicator` | `tests/agent/loop-helpers.test.ts` | Regex extraction from page content |
| `compressRepetitiveContent` | `tests/agent/context-formatting.test.ts` | Dedup with 3-repetition threshold, preserves unique lines |
| `buildFailureBrief` | `tests/agent/loop-helpers.test.ts` | Synthesis from SubgoalAttempt[], untried tool suggestions |
| Element dedup in `formatSnapshotElements` | `tests/agent/context-formatting.test.ts` | Invisible group collapsing, preserves visible elements |

### Eval validation

Re-run `npm run evals:critique` against the existing golden cases after implementation. The changes should not regress existing scores because:
- Grounding assertions are additive (more context, not less)
- Escalation changes make the executor run longer, not shorter — golden cases that expect executor behavior should still pass
- Context deduplication preserves all semantic information

### Trace replay

Replay traces `fdff73ae` and `f86910a7` with the changes applied:
- Trace 2 should trigger the contradiction detector at T0 and clarify before acting
- Trace 1 should not escalate at T3 (progress immunity) and should inject a failure brief at ~T12 instead of flailing through T15

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Grounding assertion is too verbose, wastes tokens | Low | Low | Section is ~80 tokens. Removed after T1 (only first turn). |
| Contradiction detector has false positives | Medium | Medium | Only hard-contradict on step numbers (high precision). Soft warnings for others. `clarify` tool lets user override. |
| Slower escalation causes more wasted executor turns | Low | Low | Executor turns are free (Groq) and fast (~600ms). Expected cost of patience is negative. |
| Failure brief becomes stale | Low | Low | Buffer resets on page navigation (URL change) or successful action. |
| Element dedup removes useful information | Low | Medium | Only collapses `[invisible-text]` elements. Preserves IDs and labels in summary. Agent can call `read_element` for details. |

---

## 7. Success Metrics

After implementation, re-run the challenge benchmark with these targets:

| Metric | Before (Trace 1/2) | Target |
|--------|-------------------|--------|
| Turns to complete step 1 challenge | 22 | ≤ 10 |
| Instruction-reality mismatch detection | 0% (never detected) | 100% (always clarified) |
| Wasted planner turns (flailing) | 12 | ≤ 3 |
| Cost per simple task | $0.046 | ≤ $0.015 |
| First action on wrong page | 100% (Trace 2) | 0% |

---

## 8. References

| Citation | Source | Section |
|----------|--------|---------|
| Observe-Think-Act pattern | Designing Multi-Agent Systems | §5.2, lines 2387–2390 |
| Critical Observation Loop | Designing Multi-Agent Systems | §5.5.3, lines 2504–2523 |
| ReAct Framework | Agentic Design Patterns | Ch.17, lines 2953–2964 |
| Grounded Reasoning template | Context Engineering | Ch.8, lines 5045–5067 |
| Context Engineering principles | Context Engineering | Ch.1, lines 350–353 |
| Scaling Inference Law | Agentic Design Patterns | Ch.17, lines 2919–2931 |
| Exception Handling and Recovery | Agentic Design Patterns | Ch.12, lines 2157–2171 |
| Resource-Aware Optimization | Agentic Design Patterns | Ch.16, lines 2754–2770 |
| Reflection Pattern | Agentic Design Patterns | Ch.4, lines 656–674 |
| Intelligent Retry with Enhanced Context | Designing Multi-Agent Systems | §7.5.3, lines 3242–3258 |
| Step Progress Evaluation | Designing Multi-Agent Systems | §7.5.2, lines 3206–3240 |
| Tree-of-Thought reasoning | Agentic Design Patterns | Ch.17, lines 2827–2832 |
| Context Explosion / Attention Displacement | Designing Multi-Agent Systems | §4.12, lines 2228–2230 |
| Context Isolation (agents-as-tools) | Designing Multi-Agent Systems | §4.12.3, lines 2250–2271 |
| Compaction trade-offs | Designing Multi-Agent Systems | §4.12.3, lines 2235–2241 |
| HITL Escalation Policies | Agentic Design Patterns | Ch.13, lines 2224–2234 |
| Clarification Request pattern | Designing Multi-Agent Systems | §4.13.2, lines 2307–2309 |
| Implicit vs Explicit Planning | Designing Multi-Agent Systems | §5.2.1, lines 2400–2406 |
| Action Disambiguation | Designing Multi-Agent Systems | §5.6.3, lines 2563–2564 |
| Reliability Under Interface Changes | Designing Multi-Agent Systems | §5.6.6, lines 2574–2579 |
| Prompt management notes | books/notes/prompt-management-notes.md | Insight 3 |
