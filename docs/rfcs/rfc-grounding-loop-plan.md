# Implementation Plan: RFC Grounding Loop

**RFC**: `docs/rfcs/rfc-grounding-loop.md`
**Status**: Pending approval
**Date**: 2026-03-01

---

## Phase 0: Grounding Eval (Before/After Measurement)

Build the eval infrastructure FIRST so we can measure baseline, then re-measure after each phase.

### 0.1 Define grounding eval types (`evals/grounding-types.ts`)

New eval category following the escalation eval pattern — single-phase eval where we present the LLM with a snapshot + instruction and measure whether it grounds properly.

```typescript
interface GroundingGoldenCase {
  id: string;
  scenario: "instruction_mismatch" | "blind_first_action" | "flailing" | "decoy_noise";
  difficulty: "easy" | "medium" | "hard";

  // The page state the agent sees
  snapshot: { url: string; title: string; elementCount: number; scrollY: number };
  elements: E2EElement[];

  // Instruction given to the agent (may contradict page state)
  instruction: string;

  // Optional: prior action history (for flailing scenarios)
  priorHistory?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;

  // What we expect the agent to do
  expected: {
    // Should the agent detect a contradiction?
    shouldDetectMismatch: boolean;
    // Expected first action category
    expectedFirstAction: "observe" | "clarify" | "act" | "escalate";
    // Specific expected tool (or alternatives)
    expectedTool?: string;
    expectedArgs?: Record<string, unknown>;
    acceptAlternatives?: string[];
    // Tools the agent should NOT call (trap actions)
    trapActions?: string[];
  };

  metadata: { curatedAt: string; notes: string | null };
}
```

### 0.2 Write golden cases (`evals/golden/grounding/`)

**8 cases across 4 scenarios:**

#### Scenario 1: Instruction-Reality Mismatch (from Trace 2)

**`grounding-mismatch-001.json`** — Hard mismatch, step 2 vs step 5
- Instruction: "You are on step 2. Find the code and proceed to step 3."
- Page: URL `/step5`, title says "Step 5", content says "Challenge Step 5"
- Expected: agent calls `clarify` or `read_page` first. Should NOT call `type_text` or `click_element`.
- Trap actions: `type_text`, `click_element`, `submit`

**`grounding-mismatch-002.json`** — Soft mismatch, different page title
- Instruction: "Fill out the checkout form"
- Page: URL `/cart`, title "Shopping Cart" (not checkout)
- Expected: agent calls `read_page` to orient. May proceed if it determines cart has checkout elements.

#### Scenario 2: Blind First Action (from Trace 2 T1)

**`grounding-blind-001.json`** — Code visible, agent should verify before typing
- Instruction: "Enter the hidden code and proceed"
- Page: Shows code "XNJGFD" visibly, input field visible, submit button visible
- Expected: agent calls `read_page` or `inspect_hidden` first, not `type_text` with the visible code (which might be a decoy).
- Trap: immediately typing the visible code without verification

**`grounding-blind-002.json`** — Multiple inputs, unclear which one
- Instruction: "Type your email and submit"
- Page: 3 input fields, none labeled clearly
- Expected: `read_page` or `find_element` first, not `type_text` into first field

#### Scenario 3: Flailing Without Strategy (from Trace 1 T9-T15)

**`grounding-flailing-001.json`** — Covered element, 4 prior failures
- Instruction: "Click the 'Click Here' button"
- Prior history: click_element failed (covered), hide_element failed, dismiss_overlays (no overlays), read_element (no useful info)
- Expected: `click_coordinates` or `scroll_page` (new strategy), NOT another `read_element` or `hide_element`
- Trap: repeating any of the 4 prior approaches

**`grounding-flailing-002.json`** — execute_js returning undefined, 2 prior failures
- Instruction: "Find the hidden code in the DOM"
- Prior history: execute_js → undefined (twice), inspect_hidden → only found known code
- Expected: `xray_page` or `read_element` (different approach), NOT another `execute_js`

#### Scenario 4: Decoy Noise / Distractor Avoidance

**`grounding-noise-001.json`** — 20 invisible buttons, 1 real target
- Instruction: "Click the 'Click Here' button to reveal the code"
- Page: 1 real "Click Here" button + 20 invisible decoy buttons
- Expected: agent identifies the visible one (not invisible-text) and clicks it directly

**`grounding-noise-002.json`** — 100 filler paragraphs hiding real content
- Instruction: "Find the navigation button and click it"
- Page: Real button at bottom + 100 "This is filler content" sections
- Expected: `scroll_page({"direction":"down"})` or `find_element({"text":"..."})`, not reading filler


### 0.3 Build grounding runner (`evals/grounding-runner.ts`)

Single-phase eval (simpler than escalation's two-phase):

```
1. Load golden case
2. Build system prompt from agent.system template + elements
3. Build user message from instruction
4. If priorHistory exists, inject as assistant/tool message pairs
5. Call LLM (executor model, temperature=0)
6. Parse tool calls
7. Score with grounding-scorer
8. Optional: LLM judge
9. Write result to evals/results/grounding/
```

For instruction-mismatch cases, run the eval **twice**:
- **Baseline**: use current system prompt as-is
- **With fix**: inject the grounding assertion from RFC §3.1

This gives direct before/after comparison on the same golden case.

### 0.4 Build grounding scorer (`evals/grounding-scorer.ts`)

**Five scoring dimensions:**

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **mismatchDetection** | 0.30 | Did the agent mention the contradiction in its text? (regex for "mismatch", "step 2", "step 5", "different", "wrong page") |
| **observeFirst** | 0.25 | Is the first tool call an observation tool? (read_page, find_element, inspect_hidden, read_element, clarify) |
| **trapAvoidance** | 0.20 | Did the agent avoid all trap actions? (1.0 if none triggered, 0.0 if any) |
| **strategyNovelty** | 0.15 | For flailing cases: is the first tool call different from all prior history tools? |
| **toolCorrectness** | 0.10 | Does the first tool call match expected or alternatives? |

**Pass threshold**: `composite >= 0.60`

### 0.5 Build grounding judge (`evals/grounding-judge.ts`)

LLM-as-judge (Claude Sonnet) with 4-dimension rubric (1-5):

| Dimension | Description |
|-----------|-------------|
| **situationalAwareness** | Does the agent demonstrate understanding of what page it's on? |
| **contradictionHandling** | If instructions contradict page state, does the agent address this? |
| **strategicReasoning** | Does the agent reason about its approach rather than acting blindly? |
| **trapResistance** | Does the agent avoid obvious traps (decoy buttons, wrong fields, repeated failures)? |

### 0.6 Wire into CLI (`evals/cli.ts`)

Add commands:
```bash
npm run evals grounding-critique [--judge] [--scenario NAME]
npm run evals grounding-validate
```

### 0.7 Build report generator (`evals/grounding-report.ts`)

Markdown report with per-scenario breakdown, before/after comparison table.

---

## Phase 1: Grounding Fixes (Highest Impact)

### 1.1 Deterministic Contradiction Detector

**File**: `src/background/agent/loop-helpers.ts`

Add `detectInstructionContradiction(instruction, snapshot)`:
- Extract step/page claims via regex
- Compare against `snapshot.url`, `snapshot.title`
- Return `{ contradictions: string[], severity: "none" | "soft" | "hard" }`

**File**: `src/background/agent/loop.ts` — `start()` method

After snapshot is set (~line 1074), call `detectInstructionContradiction()`. If hard contradiction:
- Inject `[REALITY MISMATCH]` warning into the first user message
- Log the contradiction

**Tests**: `tests/agent/loop-helpers.test.ts`
- Step mismatch: instruction="step 2", url="/step5" → hard
- URL match: instruction="step 5", url="/step5" → none
- No claims: instruction="fill the form" → none

### 1.2 Mandatory Grounding Assertion

**File**: `src/background/agent/context.ts` — `constructSystemMessage()`

Add a `## Grounding Check` section between `## Current Task` and `## Page Context`, only on turn 0:
```
You are on: {url}
Page title: "{title}"
BEFORE acting, verify this matches your instructions.
If mismatch, call clarify().
```

Need: a `turnCount` or `isFirstTurn` signal passed to `constructSystemMessage()`. Options:
- Add a `firstTurn: boolean` field to ContextManager
- Or: set it once in `start()`, clear after first `getPrompt()` call

**File**: `src/background/agent/loop-helpers.ts`

Add `extractStepIndicator(pageContent: string)` — regex for step/page/level N.

**Tests**: `tests/agent/context.test.ts`
- Grounding section appears on first turn
- Grounding section absent on subsequent turns
- Step indicator extraction

---

## Phase 2: Escalation and Recovery

### 2.1 Progress-Aware Escalation

**File**: `src/background/agent/loop.ts` — lines 5130-5195

Changes:
1. Remove filler fast-track: change `consecutiveTextOnly += filler ? 2 : 1` to `consecutiveTextOnly += 1`
2. Raise threshold: change `consecutiveTextOnly >= 2` to `consecutiveTextOnly >= 3`
3. Add progress immunity: before incrementing, check if last `actionEffect.deltaPercent > 0.1` or `urlChanged` — if so, skip increment
4. Add minimum-turns gate: require `this.turnCount >= 4` before text-only escalation

**Tests**: `tests/agent/loop.test.ts`
- Text-only with prior progress → no escalation
- 3 consecutive text-only without progress → escalation
- Text-only on T2 → no escalation (min turns)

### 2.2 Cumulative Failure Brief

**File**: `src/background/agent/loop-helpers.ts`

Add:
```typescript
interface SubgoalAttempt { turn: number; tool: string; args: Record<string,unknown>; outcome: string; wasFailure: boolean; }
function buildFailureBrief(attempts: SubgoalAttempt[], allToolNames: string[]): string
```

**File**: `src/background/agent/loop.ts`

Add `subgoalAttempts: SubgoalAttempt[]` buffer. After each tool execution, push an entry. When `ACTION_EFFECT.WARNING_THRESHOLD` (3) consecutive zero-effect turns, call `buildFailureBrief()` and inject as user message. Reset buffer on URL change or successful action with `deltaPercent > 0.1`.

**Tests**: `tests/agent/loop-helpers.test.ts`
- Brief includes all attempts
- Brief lists untried tools
- Brief synthesizes failure patterns (covered element, not overlay)

---

## Phase 3: Context Quality

### 3.1 Element Deduplication

**File**: `src/background/agent/context-formatting.ts` — `formatSnapshotElements()`

Before formatting, group elements by dedup signature:
- Same `tagName` + both `[invisible-text]` + similar text → collapse into group line
- Threshold: 3+ elements with same signature → collapse

Output: `[invisible-text group] 15× button (IDs: 97,11,...): "Advance","Next Step",...`

Keep all visible elements as individual lines.

**Tests**: `tests/agent/context-formatting.test.ts`
- 20 invisible buttons → 1 group line + ID list
- Mixed visible/invisible → visible kept, invisible grouped
- <3 invisible same-type → no grouping

### 3.2 Repetitive Content Compression

**File**: `src/background/agent/context-formatting.ts`

Add `compressRepetitiveContent(content: string, maxRepetitions?: number)`:
- Normalize lines (replace numbers with N)
- After 3 repetitions of same normalized line, suppress
- Append count of suppressed lines

**File**: `src/background/agent/context.ts` — `constructSystemMessage()` line ~501

Call `compressRepetitiveContent()` on `this.pageContent` before injecting into template.

**Tests**: `tests/agent/context-formatting.test.ts`
- 100 "Section N filler" → 3 shown + summary
- Unique content preserved
- Mixed repetitive + unique

---

## Execution Order

```
Step 0: Run existing evals to capture baseline
        npm run evals:critique
        npm run evals escalation-critique

Step 1: Build grounding eval infrastructure (Phase 0)
        - types, golden cases, runner, scorer, judge, CLI
        - Run baseline: npm run evals grounding-critique
        - Save baseline report

Step 2: Implement Phase 1 fixes (grounding assertion + contradiction detector)
        - Run grounding eval again
        - Compare before/after scores on mismatch scenarios
        - Run existing evals to verify no regression

Step 3: Implement Phase 2 fixes (escalation + failure brief)
        - Run grounding eval (flailing scenarios should improve)
        - Run escalation eval to verify no regression

Step 4: Implement Phase 3 fixes (context dedup)
        - Run grounding eval (noise scenarios should improve)
        - Run e2e eval to verify no regression

Step 5: Final report
        - Unified before/after table across all eval suites
        - Cost comparison (simulated from token counts)
```

---

## File Manifest

### New files
| File | Purpose | ~Lines |
|------|---------|--------|
| `evals/grounding-types.ts` | Type definitions for grounding eval | ~80 |
| `evals/grounding-runner.ts` | Replay engine for grounding cases | ~200 |
| `evals/grounding-scorer.ts` | 5-dimension automated scoring | ~120 |
| `evals/grounding-judge.ts` | Claude LLM judge with 4D rubric | ~150 |
| `evals/grounding-report.ts` | Markdown report generator | ~100 |
| `evals/golden/grounding/grounding-mismatch-001.json` | Step 2 vs step 5 | ~60 |
| `evals/golden/grounding/grounding-mismatch-002.json` | Cart vs checkout | ~50 |
| `evals/golden/grounding/grounding-blind-001.json` | Visible code, verify first | ~50 |
| `evals/golden/grounding/grounding-blind-002.json` | Multiple inputs | ~50 |
| `evals/golden/grounding/grounding-flailing-001.json` | Covered element, 4 failures | ~70 |
| `evals/golden/grounding/grounding-flailing-002.json` | execute_js undefined × 2 | ~60 |
| `evals/golden/grounding/grounding-noise-001.json` | 20 invisible buttons | ~80 |
| `evals/golden/grounding/grounding-noise-002.json` | 100 filler paragraphs | ~70 |

### Modified files
| File | Change | ~Lines changed |
|------|--------|---------------|
| `src/background/agent/loop-helpers.ts` | Add `detectInstructionContradiction`, `extractStepIndicator`, `buildFailureBrief` | ~100 |
| `src/background/agent/loop.ts` | T1 contradiction check, progress-aware escalation, failure brief injection | ~50 |
| `src/background/agent/context.ts` | Grounding assertion section, content compression call | ~25 |
| `src/background/agent/context-formatting.ts` | Element dedup, `compressRepetitiveContent` | ~70 |
| `evals/cli.ts` | Add grounding-critique, grounding-validate commands | ~30 |
| `tests/agent/loop-helpers.test.ts` | Tests for new functions | ~80 |
| `tests/agent/context-formatting.test.ts` | Tests for dedup, compression | ~60 |

**Total**: ~8 new files, ~6 modified files, ~1500 lines of code
