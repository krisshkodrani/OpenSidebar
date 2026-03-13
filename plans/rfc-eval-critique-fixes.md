# RFC: Eval Critique Fixes — Closing the Enforcement Gap

**Date**: 2026-03-12
**Status**: Draft
**Context**: `evals/reports/critique-2026-03-12T10-03-40-787Z.md` (3/13 pass, 23.1%)

## Problem

The main critique eval shows 23.1% pass rate across 13 golden cases. The judge produced 12 prompt-fix recommendations, but **8 of 12 are already documented** in the agent system prompt (`prompts/runtime/agent/system.md` v3). The model ignores them.

This is primarily an **enforcement gap**, not a documentation gap. Adding more text to the prompt won't help — the executor model (openai/gpt-oss-120b) doesn't reliably follow the existing rules. Fixes must be a mix of code-level guardrails in `loop.ts` and targeted prompt edits.

### Eval Results Summary

| Eval Suite | Pass Rate | Key Issue |
|------------|-----------|-----------|
| Main critique | 3/13 (23%) | find_element_loop, marathon_no_done, disabled_button all 0% |
| Escalation | 6/6 (100%) | Working perfectly |
| Grounding | 8/8 (100%) | Working perfectly |
| Tool confusion | 9/10 (90%) | select_option vs click_element only failure |

### Pathology Breakdown

| Pathology | Pass Rate | Root Cause |
|-----------|-----------|------------|
| find_element_loop | 0/2 | Model calls find_element for already-tagged elements |
| marathon_no_done | 0/2 | Model cycles 50+ turns without escalating |
| disabled_button | 0/2 | Model submits without inspecting hidden state |
| scope_overshoot | 1/3 | Model inspects/acts when goal already achieved |
| escalation_repeat | 1/2 | Model uses execute_js instead of xray_page |
| text_as_toolcall | 1/2 | Model outputs tool JSON as text, or uses find_element for tagged elements |

## Analysis: Judge Recommendations vs Existing Prompt

### Already in prompt (model ignores them)

| # | Recommendation | Existing Location | Lines |
|---|---------------|-------------------|-------|
| 5 | Never find_element for tagged elements | Rules (line 40), Anti-Patterns (line 59) | 2 mentions |
| 12 | Scan Visible Elements before find_element | Same as above | 2 mentions |
| 8 | Same action 3+ times → escalate | Rules (line 42), Anti-Patterns (line 61) | 2 mentions |
| 7 | 10+ turns without progress → escalate | Rules (line 42), Anti-Patterns (line 66) | 2 mentions |
| 2 | Track attempt history, don't repeat | Rules (line 42), System Behaviors (line 47) | 2 mentions |
| 10 | Check URL → call done() if goal reached | Rules (line 33) | 1 mention |
| 4 | Use xray_page before execute_js | Rules (line 43), Anti-Patterns (line 60) | 2 mentions |
| 9 | Check visible info before inspecting | Goal-Relevance Check (line 54) | 1 mention |

### Partially covered or missing

| # | Recommendation | Status |
|---|---------------|--------|
| 1 | Pre-filled values may be decoys → inspect_hidden | Partially (line 41 says "do not assume pre-filled values are correct" but no concrete action) |
| 6 | Use type_text not press_key for text entry | Implicit in Tool Descriptions but not an explicit anti-pattern |
| 3 | Use targeted execute_js for known attributes | Contradicts #4 (xray_page first); skip |
| 11 | Prioritize visible (non-invisible-text) buttons | New — not documented |

## Proposed Fixes

### Fix 1: Code-level find_element guard (loop.ts)

**Problem**: find_element called for elements already visible in the current snapshot.
**Pathologies**: find_element_loop (0/2), text_as_toolcall (1/2)
**Impact**: 4/13 failed cases

Intercept `find_element` calls in `loop.ts` before dispatching to the content script. If the `searchText` parameter matches (case-insensitive, substring) any element's text in the current DOM snapshot, **inject a nudge** into the conversation instead of executing the tool:

```typescript
// In loop.ts, before tool execution
if (toolName === 'find_element' && toolArgs.searchText) {
  const searchLower = toolArgs.searchText.toLowerCase();
  const match = this.context.currentSnapshot?.elements?.find(el =>
    el.text?.toLowerCase().includes(searchLower)
  );
  if (match) {
    // Block the call and nudge the model
    return {
      role: 'tool',
      content: `BLOCKED: Element matching "${toolArgs.searchText}" is already visible as [${match.id}] "${match.text}". Use click_element({"id": ${match.id}}) or type_text({"id": ${match.id}, ...}) directly. find_element is only for elements NOT in Visible Elements.`,
      tool_call_id: toolCallId,
    };
  }
}
```

This is a hard guardrail — the model can't waste turns on this anti-pattern regardless of whether it reads the prompt.

### Fix 2: Code-level repeat-action blocker (loop.ts)

**Problem**: Model repeats the exact same tool+args 3+ times (already tracked in `failedActions` but only for failed calls — successful calls that don't change state aren't tracked).
**Pathologies**: marathon_no_done (0/2), disabled_button (0/2)
**Impact**: 4/13 failed cases

The existing `failedActions` deduplication in System Behaviors (line 47) only blocks exact repeats of *failed* actions. Extend to also track *same-tool+same-args* calls regardless of success/failure. After 3 identical calls, inject an escalation nudge:

```typescript
// In loop.ts — track all tool calls, not just failed ones
private recentToolCalls: Array<{ name: string; argsHash: string }> = [];

// Before executing each tool call
const argsHash = hashArgs(toolName, toolArgs);
const repeatCount = this.recentToolCalls
  .slice(-20) // look at last 20 calls
  .filter(c => c.name === toolName && c.argsHash === argsHash)
  .length;

if (repeatCount >= 3) {
  return {
    role: 'tool',
    content: `BLOCKED: You have called ${toolName}(${JSON.stringify(toolArgs)}) ${repeatCount} times. This is cycling — call escalate({"reason": "Repeated ${toolName} ${repeatCount} times without progress"}) or try a fundamentally different approach.`,
    tool_call_id: toolCallId,
  };
}

this.recentToolCalls.push({ name: toolName, argsHash });
```

### Fix 3: Code-level turn-budget escalation (loop.ts)

**Problem**: Model continues cycling at 50+ turns without calling escalate().
**Pathologies**: marathon_no_done (0/2)
**Impact**: 2/13 failed cases

The stagnation monitor already nudges at 6 stagnant turns and escalates at 12, but it uses *snapshot fingerprinting* — if the page changes slightly each turn (e.g., different error message), stagnation isn't detected. Add an absolute turn-count escalation:

```typescript
// In the main loop, after each turn
if (this.turnCount > 0 && this.turnCount % 15 === 0) {
  // Inject a hard reminder every 15 turns
  this.injectFeedback(
    `SYSTEM: You have used ${this.turnCount} turns. ` +
    `If you are not making clear progress toward the success criteria, ` +
    `call escalate() NOW. Do not continue if stuck.`
  );
}
```

### Fix 4: Prompt edit — press_key anti-pattern

**Problem**: Model uses `press_key("a", ["ctrl"])` or `press_key` for text entry instead of `type_text`.
**Pathologies**: find_element_loop case 002
**Impact**: 1/13 failed cases

Add to Anti-Patterns section:

```markdown
- **press_key for text entry**: Never use `press_key` to type text character-by-character or with Ctrl+A/Ctrl+V. Use `type_text({"id": N, "text": "...", "pressEnter": true})` for all text input. `press_key` is only for special keys (Enter, Escape, Tab, arrows).
```

### Fix 5: Prompt edit — visible-state check before action

**Problem**: Model calls inspect_hidden/xray_page when the answer is already visible on the page.
**Pathologies**: scope_overshoot (1/3)
**Impact**: 2/13 failed cases

Strengthen the Goal-Relevance Check section (currently line 53-54):

```markdown
## Goal-Relevance Check
Before calling a tool, ask TWO questions:
1. "Is the information I need already visible on this page?" — Check Visible Elements, Page Content, and form input values. If the answer or required value is already there, act on it directly (click submit, call done()).
2. "If this action succeeds, am I closer to the completion criteria?" — If unclear, prefer the most direct path.

When a form input already contains the required value and a submit button is visible, click submit immediately — do not inspect, re-read, or search for the value again.
```

### Fix 6: Prompt edit — done() on goal-reached URL

**Problem**: Model continues acting when the URL already shows the goal is reached (e.g., on step 6 when task was "proceed to step 6").
**Pathologies**: scope_overshoot case 001
**Impact**: 1/13 failed cases

The rule exists at line 33 but is buried in a long Rules list. Move it to a more prominent position and make it a **MUST**:

Add to the Core Loop, step 1 (Observe):

```markdown
1. **Observe**: Read Visible Elements, Page Content, and Page Interpretation. What state is the page in?
   - **Goal check**: Does the current URL or page heading already match the success criteria? If yes, call done() immediately — do not take any further actions.
```

### Fix 7: Tool-confusion fix — select_option hint

**Problem**: Model fails to use `select_option` for native `<select>` elements (tool-confusion eval, 1/10 fail).
**Pathologies**: tc-native-select-009
**Impact**: Tool-confusion eval only (not in main critique)

Add to Tool Descriptions:

```markdown
- Use `select_option` for native HTML `<select>` dropdowns (role=combobox, tagName=select). `click_element` cannot set a `<select>` value — you MUST use `select_option({"id": N, "value": "option text"})`.
```

## Implementation Plan

### Phase 1: Code guardrails (high impact, no prompt change risk)

1. **find_element blocker** (Fix 1) — `src/background/agent/loop.ts`
   - Add snapshot-aware interception before tool dispatch
   - Test: run find_element_loop golden cases, verify nudge injection

2. **Repeat-action blocker** (Fix 2) — `src/background/agent/loop.ts`
   - Extend existing `failedActions` tracking to all calls
   - Test: run marathon_no_done golden cases, verify blocking at 3 repeats

3. **Turn-budget reminder** (Fix 3) — `src/background/agent/loop.ts`
   - Add periodic feedback injection at 15-turn intervals
   - Test: verify stagnation escalation triggers sooner

### Phase 2: Prompt edits (low risk, targeted)

4. **press_key anti-pattern** (Fix 4) — `prompts/runtime/agent/system.md`
5. **Goal-Relevance Check rewrite** (Fix 5) — `prompts/runtime/agent/system.md`
6. **Goal check in Observe step** (Fix 6) — `prompts/runtime/agent/system.md`
7. **select_option hint** (Fix 7) — `prompts/runtime/agent/system.md`

### Phase 3: Validation

8. Re-run `npm run evals:critique` — target: >60% pass rate (up from 23%)
9. Re-run tool-confusion eval — target: 10/10 (up from 9/10)
10. Re-run escalation + grounding evals — verify no regression

## Risks

- **False positive blocking (Fix 1)**: find_element might be legitimately needed for a partial text match that doesn't exactly match any visible element's text. Mitigation: use substring matching and only block when confidence is high.
- **Aggressive repeat blocking (Fix 2)**: Some tools are correctly called multiple times with the same args (e.g., `scroll_page({"direction": "down"})`). Mitigation: exempt `scroll_page`, `read_page`, `dismiss_overlays` from repeat tracking.
- **Prompt regression**: Rewording existing sections might break behavior that currently works. Mitigation: keep edits minimal, run all 4 eval suites after changes.

## Non-Goals

- Switching executor model (out of scope — model choice is a separate decision)
- Adding new tools (unnecessary — existing tools cover all cases)
- Changing planner behavior (planner evals pass at 100%)
- Judge recommendation #3 (use execute_js for targeted attribute queries) — contradicts the existing investigation protocol and recommendation #4. Skip.

## Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| Main critique pass rate | 23% (3/13) | >60% (8+/13) |
| Tool confusion pass rate | 90% (9/10) | 100% (10/10) |
| Escalation pass rate | 100% | 100% (no regression) |
| Grounding pass rate | 100% | 100% (no regression) |
| Judge: Reasoning Quality | 2.7/10 | >5.0/10 |
| Judge: Anti-Pattern Avoidance | 3.9/10 | >6.0/10 |
