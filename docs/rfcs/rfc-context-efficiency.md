# RFC: Context Efficiency — Prompt-First Optimizations from Literature Review

**Status**: Draft
**Author**: (system)
**Date**: 2026-03-05
**Motivation**: Comparative analysis of Claude Code architecture + academic literature survey (2024-2026)

---

## 1. Problem Statement

A comparative study of Claude Code's architecture and recent academic literature (40+ papers, 2024-2026) reveals that OpenSidebar leaves significant performance on the table through suboptimal context management, missing prompt caching, and reliance on code-based solutions where prompt changes would be cheaper, more maintainable, and equally effective.

### Key Findings from Literature

1. **Observation masking > LLM summarization**: JetBrains/NeurIPS 2025 showed simple observation masking achieves 2.6% better solve rates at 52% lower cost than LLM summarization (arXiv:2508.21433).
2. **Prompt caching is architecture, not optimization**: "Don't Break the Cache" (arXiv:2601.06007) demonstrated 41-80% cost reduction and 13-31% latency improvement from strategic prompt prefix caching.
3. **Plans must survive compression**: HiAgent (ACL 2025) doubled success rate by chunking memory around subgoals that persist through compression (arXiv:2408.09559).
4. **Deterministic guards + prompt guidance is the optimal hybrid**: ToolSafe (arXiv:2601.10156) achieved 65% reduction in harmful tool invocations with 10% better task completion via "detect-and-guide" pre-conditions.
5. **Fewer well-chosen tools beat more tools**: AgentOccam (arXiv:2410.13825) improved WebArena scores by 29.4% through action space pruning.
6. **DOM attribute pruning saves 20-40% tokens**: D2Snap (arXiv:2508.04412) achieved 73% task success with ~1-3K tokens per page via aggressive attribute filtering.
7. **Selective perception beats per-turn perception**: The production browser agent study (arXiv:2511.19477) achieved ~85% through "hybrid context management combining accessibility tree snapshots with selective vision."

### Current State in OpenSidebar

| Area | Current | Gap |
|------|---------|-----|
| History compression | LLM-powered dynamic NONE→HEAVY | Observation masking is cheaper, more reliable |
| Prompt caching | Not utilized | OpenRouter supports cache_control; our static prefix (~8K tokens) never changes |
| Plan persistence | Embedded in conversation history | Lost during compression; should be in system prompt |
| Tool pre-conditions | Prompt-only ("check page before clicking") | No code enforcement; model ignores when rushed |
| DOM attributes | All attributes at NONE/LIGHT compression | Many attributes (data-*, text-color, bg-color) waste tokens |
| Perception frequency | 2-turn stale threshold for all actions | Routine actions (click, type) don't need fresh VLM |
| Time awareness | Turn count only | No elapsed time or per-action timing in prompt |
| Working memory | None — agent re-discovers state each turn | Key findings lost on compression |

### Cost Impact (Estimated)

Based on a typical 15-turn session with 35 tools at 32K context:
- **System prompt**: ~12K tokens/turn (tools ~8K + persona ~1K + rules ~3K)
- **DOM snapshot**: ~2-4K tokens/turn
- **History**: ~8-16K tokens/turn (grows, then compressed)
- **Perception**: ~1K tokens + Gemini API call per invocation

Conservative estimates from literature:
- Prompt caching on static prefix: **40-60% savings on 8K tokens/turn** = ~3-5K tokens saved/turn
- Observation masking: **30-50% savings on history** = ~3-8K tokens saved/turn
- Attribute pruning: **20-40% savings on DOM snapshot** = ~0.5-1.5K tokens saved/turn
- Selective perception: **Skip 30-40% of VLM calls** = ~$0.003-0.005 saved/session

Total estimated savings: **20-35% reduction in per-session token cost**.

---

## 2. Proposed Changes

Ten changes organized into four phases. Each change is annotated with its type (prompt/config/code) and estimated effort.

### Phase 0: Baseline Eval (Measure Before)

Before making any changes, capture baselines across existing eval suites to enable before/after comparison.

#### 0.1 Context Efficiency Eval Suite

**New eval category** measuring token efficiency and context quality. Golden cases test whether the agent produces equivalent behavior with less context.

**Golden cases** (8 cases, 4 scenarios):

| Case ID | Scenario | Tests |
|---------|----------|-------|
| `context-eff-obs-mask-001` | History with 10 tool results | Does observation masking preserve agent behavior? |
| `context-eff-obs-mask-002` | History with 20 tool results (heavy) | Does aggressive masking still work? |
| `context-eff-attr-prune-001` | Page with 40 elements, full attrs | Does attribute-pruned snapshot produce same tool calls? |
| `context-eff-attr-prune-002` | Page with 60 elements, many data-* | Does pruning data-* attributes change behavior? |
| `context-eff-plan-persist-001` | Mid-task with active plan, compressed history | Does agent remember current plan step? |
| `context-eff-plan-persist-002` | Post-escalation with plan, distilled trajectory | Does planner see the plan state? |
| `context-eff-time-aware-001` | Turn 12 of 20, 45s elapsed | Does agent show urgency/escalation awareness? |
| `context-eff-time-aware-002` | Turn 3 of 20, 8s elapsed | Does agent avoid premature escalation? |

**Scoring dimensions** (5):

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **behaviorPreservation** | 0.35 | Same tool calls as full-context baseline? |
| **tokenReduction** | 0.25 | Measured token count vs baseline |
| **planAwareness** | 0.20 | Agent references active plan step correctly? |
| **timeAwareness** | 0.10 | Agent demonstrates appropriate urgency? |
| **noRegression** | 0.10 | No new errors introduced? |

**Implementation files:**

| File | Purpose | ~Lines |
|------|---------|--------|
| `evals/context-efficiency-types.ts` | Type definitions | ~60 |
| `evals/context-efficiency-runner.ts` | Replay engine (A/B: baseline vs optimized prompt) | ~180 |
| `evals/context-efficiency-scorer.ts` | 5-dimension scoring | ~100 |
| `evals/golden/context-efficiency/*.json` | 8 golden cases | ~60 each |

**CLI commands:**
```bash
npm run evals -- context-efficiency-extract <sessionId>
npm run evals -- context-efficiency-critique [--judge]
```

#### 0.2 Run All Existing Baselines

```bash
npm run evals:critique                    # Core tool selection
npm run evals -- escalation-critique      # Escalation behavior
npm run evals -- perception-critique      # Perception quality
npm run evals -- grounding-critique       # Grounding (from prior RFC)
npm run evals -- context-efficiency-critique  # New: context efficiency
```

Save results to `evals/results/baseline-pre-context-efficiency/`.

---

### Phase 1: Prompt Structure & Caching (Highest Impact, Lowest Risk)

#### 1.1 Cache-Friendly Prompt Ordering

**Type**: Prompt restructure
**Effort**: Low (~20 lines changed)

**Problem**: The system prompt template (`prompts/runtime/agent/system.md`) interleaves static and dynamic content. Template variables like `{{persona}}`, `{{demoCatalog}}`, `{{demonstrations}}` are inserted between static rules, breaking potential prefix cache chains.

**Current template order** (system.md:1-139):
```
Static rules (lines 1-120)        ← cacheable
{{demoCatalog}}                    ← semi-static (changes per session, not per turn)
{{persona}}                        ← semi-static (changes on model tier switch only)
{{planStatus}}                     ← dynamic (changes per turn)
{{planInstructions}}               ← conditional (present/absent per plan)
{{demonstrations}}                 ← semi-static (set once per session)
## Page Context ({{title}}, {{url}})  ← dynamic
## Visible Elements ({{elements}})    ← dynamic (every turn)
## Page Content ({{pageContent}})     ← dynamic (every turn)
## Page Interpretation                ← dynamic (every turn)
```

**Proposed order**:
```
Static rules (lines 1-120)        ← cacheable block START
## Tool Call Examples               ← static
{{persona}}                        ← semi-static (rarely changes)
{{demoCatalog}}                    ← semi-static
                                   ← cacheable block END (cache_control breakpoint)
{{planStatus}}                     ← dynamic
{{planInstructions}}               ← conditional
{{demonstrations}}                 ← semi-static
## Working Notes                   ← dynamic (new, see 2.1)
## Page Context                    ← dynamic
## Visible Elements                ← dynamic
## Page Content                    ← dynamic
## Page Interpretation             ← dynamic
```

**Where**: `prompts/runtime/agent/system.md` (reorder template), `context.ts:452-700` (adjust replacement logic).

**Cache strategy**: Add `cache_control: { type: "ephemeral" }` on the last message in the static prefix when calling OpenRouter. The static block (~8K tokens) remains identical across all turns of a session, enabling 90% cost reduction on those tokens.

**Where (API call)**: `llm/client.ts` — in `complete()` and `completeStream()`, annotate the system message with cache breakpoint.

**Literature**: "Don't Break the Cache" (arXiv:2601.06007) — strategic cache boundary control outperforms naive full caching; excluding dynamic content from cached blocks provides consistent benefits.

#### 1.2 Plan State as System Prompt Block

**Type**: Prompt restructure
**Effort**: Low (~15 lines changed)

**Problem**: Plan state is injected into the system prompt via `{{planStatus}}` (context.ts:462-477), which is correct. But during history compression (`summarizeTrajectory()` at context.ts:1273-1298), the plan state is carried forward as part of the distilled history — not guaranteed to be in the system prompt of post-compression turns.

**Current flow**:
1. `setPlanStatus()` sets `this.planStatus` on ContextManager
2. `constructSystemMessage()` renders it via `formatPlanStatus()`
3. On `summarizeTrajectory()`, plan status is appended to the trajectory summary (context.ts:1286-1291)
4. After trajectory replacement, if `this.planStatus` is still set, it appears in the next system prompt

**Gap**: If `planStatus` is cleared or the ContextManager is reset (e.g., on navigation resume), the plan state from the trajectory summary is the only record — buried in a compressed user message, not prominently in the system prompt.

**Fix**: In `summarizeTrajectory()`, after distilling history, explicitly re-assert `this.planStatus` from the trajectory data if it was present. Add a guard in `constructSystemMessage()` that also checks the last trajectory summary for plan references.

**Where**: `context.ts:1286-1298` (trajectory summary), `context.ts:462-477` (plan rendering).

**Literature**: HiAgent (ACL 2025, arXiv:2408.09559) — chunking working memory around subgoals that persist through compression doubled success rate. Anthropic's "Effective Harnesses for Long-Running Agents" recommends JSON-structured task lists over prose for plan persistence.

#### 1.3 Observation Masking for History Compression

**Type**: Prompt + minor code
**Effort**: Low-Medium (~40 lines)

**Problem**: Dynamic compression (NONE→LIGHT→MEDIUM→HEAVY) uses increasingly aggressive text truncation on the full history. At HEAVY, `summarizeTrajectory()` invokes `summarizeHistory()` (context-formatting.ts:78-137) to produce `T{N}: tool args → outcome` entries. This is good, but it's only triggered at HEAVY level. At LIGHT/MEDIUM, full tool results (potentially 500+ tokens each) remain in history.

**Current compression in `getPrompt()`** (context.ts:660-695):
- LIGHT: preserves recent 3 messages, truncates older tool results
- MEDIUM: preserves recent 2 messages, more aggressive truncation
- HEAVY: calls `summarizeTrajectory()` to replace everything

**Proposed**: Add **observation masking** as the first compression tier, before LLM summarization:

```
NONE:     Full history, no changes
LIGHT:    Mask old tool outputs → "[T5: click_element {id:42} → success]"
MEDIUM:   Mask + truncate old assistant messages to 150 chars
HEAVY:    Full trajectory summarization (existing behavior)
```

The observation mask format is already produced by `summarizeHistory()`. The change is to apply it **per-message** at LIGHT/MEDIUM rather than as a wholesale replacement at HEAVY.

**Where**: `context.ts` — `getPrompt()` method (lines 660-695), add a `maskOldObservations()` step that replaces tool result content with structured one-liners for messages older than `preserveRecent` threshold.

**Mechanism**:
```typescript
function maskToolResult(msg: LLMMessage, turnNum: number): LLMMessage {
  if (msg.role !== "tool") return msg;
  const firstLine = msg.content.split("\n")[0].slice(0, 100);
  return { ...msg, content: `[T${turnNum}: ${firstLine}]` };
}
```

**Literature**: JetBrains/NeurIPS 2025 (arXiv:2508.21433) — "The Complexity Trap" showed observation masking achieves 2.6% better solve rates at 52% lower cost. The key: keep actions visible (the agent remembers what it did), mask only the verbose output (which the agent rarely re-reads).

---

### Phase 2: Context Quality (Medium Impact, Low Risk)

#### 2.1 Working Notes Scratchpad

**Type**: New tool + prompt section
**Effort**: Medium (~60 lines)

**Problem**: The agent re-discovers page state each turn. Key findings (like "the submit button is tag #42", "there are 3 hidden codes on this page", "the form has 5 required fields") are lost when history compresses. There is no persistent working memory that survives the sliding window.

**Proposed**: Add a `Working Notes` section to the system prompt and an `update_notes` tool that writes to it.

**System prompt addition** (in template, after `{{demonstrations}}`):
```
## Working Notes
{{workingNotes}}
```

**Tool definition** (in `definitions.ts`):
```typescript
export const UPDATE_NOTES_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.UPDATE_NOTES,
    description: "Save a brief note to your persistent working memory. Notes survive context compression and are visible every turn. Use for: key element IDs, discovered values, page structure findings, intermediate results. Max 500 chars.",
    parameters: {
      type: "object",
      properties: {
        note: { type: "string", description: "The note to save. Append to existing notes." }
      },
      required: ["note"]
    }
  }
};
```

**Loop interception** (in `loop.ts`, same pattern as `update_plan`):
- Intercept `update_notes` before executor dispatch
- Append note to `ContextManager.workingNotes` (new field, max 500 chars, ring-buffer style)
- Broadcast `AGENT_ACTIVITY` for UI feedback
- Return "Note saved." as tool result

**Where**:
- `types/tools.ts`: Add `UPDATE_NOTES = "update_notes"` to ToolName enum
- `tools/definitions.ts`: Add `UPDATE_NOTES_DEF`
- `tools/metadata.ts`: Add metadata (sequential, LOW risk, not domModifying)
- `tools/index.ts`: Register tool
- `background/agent/context.ts`: Add `workingNotes: string` field, render in `constructSystemMessage()`
- `background/agent/loop.ts`: Intercept and handle

**Prompt guidance** (add to system.md Rules section):
```
- Use `update_notes` to save important discoveries (key element IDs, hidden values, form structure). Notes persist across turns and survive context compression. Keep notes brief and actionable.
```

**Literature**: MemGPT/Letta (arXiv:2310.08560) — self-editable working memory blocks pinned to system prompt. Anthropic's "Effective Context Engineering" — "structured note-taking: agents maintain external memory files that persist across context resets." Google ADK — four-layer context with "working context" as the innermost layer.

#### 2.2 Attribute Pruning in DOM Snapshots

**Type**: Config change
**Effort**: Low (~15 lines)

**Problem**: `formatElementCompact()` (context-formatting.ts:17-59) includes all attributes at NONE/LIGHT compression. Many attributes provide no decision-relevant information:
- `text-color`, `bg-color`: Only useful for the `[invisible-text]` flag (already computed)
- `data-*` attributes: Internal framework state, not actionable
- `class`: CSS class names, rarely useful for action decisions
- `style`: Inline styles, not actionable

Each unnecessary attribute adds ~5-15 tokens per element. With 40-60 elements, this is 200-900 wasted tokens per turn.

**Proposed**: Whitelist only action-relevant attributes in the `attrFilter` passed to `formatElementCompact()`.

**Whitelist**:
```typescript
const ACTION_RELEVANT_ATTRS = new Set([
  "type", "href", "placeholder", "value", "aria-label", "role",
  "name", "action", "method", "target", "alt", "title",
  "min", "max", "pattern", "required", "checked", "selected",
  "disabled", "readonly", "multiple", "accept",
]);
```

**Where**: `context.ts` — `formatElementsWithCompression()` (line 798+). Pass the whitelist as `attrFilter` to `formatElementCompact()` at all compression levels. Currently only HEAVY/MEDIUM filter attributes (lines 812-819); extend to NONE/LIGHT.

**Current attribute filtering** (context.ts:812-838):
```
HEAVY:   [role, type, description]
MEDIUM:  [id, role, type, href, label, description]
LIGHT:   all attributes
NONE:    all attributes
```

**Proposed**:
```
HEAVY:   [role, type] (same)
MEDIUM:  [role, type, href, label, placeholder, value, aria-label] (expanded)
LIGHT:   ACTION_RELEVANT_ATTRS whitelist
NONE:    ACTION_RELEVANT_ATTRS whitelist (change from "all")
```

**Literature**: D2Snap (arXiv:2508.04412) — attribute downsampling below a semantic threshold preserves task performance. DEV Community token analysis — interactive-only references with minimal attributes save 51-79%.

#### 2.3 Conditional Perception Invocation

**Type**: Config tuning
**Effort**: Low (~10 lines)

**Problem**: The `PerceptionAgent` uses `STALE_THRESHOLD = 2` (perception-agent.ts:44) — after 2 turns with the same fingerprint, perception is re-invoked. For routine actions (click, type, scroll) that produce predictable DOM changes, this is unnecessarily frequent. Each perception call costs ~1K tokens + a Gemini 2.5 Flash API call (~$0.001).

**Proposed**: Differentiate stale threshold based on the last tool executed:

```typescript
const STALE_THRESHOLD_ROUTINE = 4;    // click, type, scroll, press_key, select_option
const STALE_THRESHOLD_NAVIGATION = 1; // navigate, go_back, create_tab, switch_tab
const STALE_THRESHOLD_DEFAULT = 2;    // everything else
```

**Where**: `perception-agent.ts` — `observe()` method. Add a `lastToolName` parameter (already available in the loop). Check the tool name against the routine set. If routine, use the extended threshold.

**Force-refresh triggers** (keep existing behavior):
- URL change
- Plan step change
- Escalation
- Agent stagnation signal
- Explicit `read_page` call

**Literature**: The production browser agent study (arXiv:2511.19477) achieved ~85% through "selective vision." D2Snap found text-only DOM achieved 63% vs 65% for screenshots, suggesting vision adds marginal value for routine actions.

#### 2.4 Time Awareness in System Prompt

**Type**: Prompt template change
**Effort**: Trivial (~5 lines)

**Problem**: The agent knows its turn count but not elapsed time or per-action timing. The production browser agent study (arXiv:2511.19477) identified time awareness as "critical — LLMs lack temporal perception." Without it, the agent cannot make informed decisions about when to escalate or give up.

**Proposed**: Add a dynamic line to the Page Context section:

```
Turn {{turnCount}}/{{maxTurns}} | Elapsed: {{elapsedSeconds}}s | Budget: {{remainingTurns}} turns left
```

**Where**: `context.ts` — `constructSystemMessage()`, in the Page Context block (around line 519). Template variables populated from existing state:
- `turnCount`: already tracked in AgentLoop
- `maxTurns`: from `RuntimeLimits`
- `elapsedSeconds`: `Math.round((Date.now() - this.startTime) / 1000)` (startTime already tracked)

No new data needed — just surfacing existing state in the prompt.

**Literature**: arXiv:2511.19477 — "LLMs lack temporal perception; the agent must understand elapsed time and action durations." Claude Code injects `assistant knowledge cutoff` and current date into its system prompt for temporal grounding.

---

### Phase 3: Tool Guards (Medium Impact, Medium Effort)

#### 3.1 Deterministic Tool Pre-conditions

**Type**: Code guards (~30 lines)
**Effort**: Low

**Problem**: Tool pre-conditions are entirely prompt-based. The system prompt says "check page state before acting" (system.md:10), "Act on visible elements directly" (system.md:39), but nothing enforces this. When the model is under token pressure or reasoning poorly, it ignores prompt guidance.

**Proposed**: Add lightweight validation in the tool executor layer that returns helpful error messages (detect-and-guide pattern, not detect-and-block).

**Pre-conditions**:

| Tool | Pre-condition | Error message |
|------|--------------|---------------|
| `click_element` | Tag ID exists in last snapshot | "Element [N] not found in current page. Call read_page to refresh, or check if the page changed." |
| `type_text` | Tag ID exists AND element is an input/textarea/contenteditable | "Element [N] is a {tagName}, not an input field. Look for an input or textarea element instead." |
| `select_option` | Tag ID exists AND element is a `<select>` | "Element [N] is a {tagName}, not a <select>. Use click_element for non-select dropdowns." |
| `read_element` | Tag ID exists in last snapshot | "Element [N] not found. The page may have changed — call read_page first." |
| `hover_element` | Tag ID exists in last snapshot | "Element [N] not found in current page." |

**Where**: `tools/index.ts` — in the tool executor dispatch, before sending `TOOL_EXECUTE` to content script. The snapshot is available via the agent loop's context manager.

**Implementation pattern**:
```typescript
function validateElementExists(id: number, snapshot: DomSnapshot): string | null {
  if (!snapshot?.elements?.some(el => el.tag === id)) {
    return `Element [${id}] not found in current page. Call read_page to refresh.`;
  }
  return null; // valid
}
```

**Literature**: ToolSafe (arXiv:2601.10156) — "detect-and-guide" achieved 65% reduction in harmful invocations + 10% better task completion. The key insight: feeding safety reasoning *back* to the agent improves both safety and performance. Blocking causes flailing; guidance enables self-correction. Claude Code's Edit tool errors if you haven't Read the file first — same principle.

---

### Phase 4: Composite Prompt Patterns (Low Effort, Incremental Gain)

#### 4.1 Composite Tool Patterns via Prompt Examples

**Type**: Prompt only
**Effort**: Trivial (~20 lines in system.md)

**Problem**: Common multi-step patterns (fill form field, interact with dropdown, handle date picker) require 3-4 tool calls. The agent sometimes gets the sequence wrong or uses unnecessary intermediate steps.

**Proposed**: Add a "Common Patterns" section to the system prompt with compact multi-step examples:

```markdown
## Common Patterns
- **Fill form field**: `type_text({"id": N, "text": "value", "pressEnter": false})` — clears and types in one call.
- **Non-native dropdown**: `click_element({"id": N})` to open → `find_element({"searchText": "option"})` → `click_element({"id": M})`.
- **Date picker**: Prefer `type_text({"id": N, "text": "2026-03-05"})` over clicking individual date cells. If that fails, use `click_coordinates` on the target cell.
- **Multi-field form**: Call multiple `type_text` in one turn (they execute in parallel), then `click_element` on submit.
- **Covered element**: Use `click_coordinates({"x": X, "y": Y})` immediately — do not try hide_element or dismiss_overlays first.
```

**Where**: `prompts/runtime/agent/system.md` — add after the existing "Tool Call Examples" section (line 112-119). This is in the static prefix, so it benefits from prompt caching.

**Literature**: Anthropic's "Building Effective Agents" — "Tool definitions deserve just as much prompt engineering attention as your overall prompts." AgentOccam (arXiv:2410.13825) — fewer, well-documented action patterns outperform more tools. SWE-Agent (NeurIPS 2024) — "ACI design matters more than scaffolding code."

---

## 3. Eval Strategy: Before/After Measurement

### 3.1 Pre-Implementation Baseline

Run all eval suites and save results:

```bash
# Existing suites
npm run evals:critique                         # → results/baseline-pre/critique.md
npm run evals -- escalation-critique --judge   # → results/baseline-pre/escalation.md
npm run evals -- perception-critique           # → results/baseline-pre/perception.md
npm run evals -- grounding-critique            # → results/baseline-pre/grounding.md

# New suite (build first in Phase 0)
npm run evals -- context-efficiency-critique   # → results/baseline-pre/context-efficiency.md
```

### 3.2 Post-Phase Measurements

After each phase, re-run all suites:

```
Phase 1 (Prompt Structure):
  npm run evals -- context-efficiency-critique   # Should show token reduction
  npm run evals:critique                         # Should show no regression

Phase 2 (Context Quality):
  npm run evals -- context-efficiency-critique   # Should show further improvement
  npm run evals -- perception-critique           # Verify perception still works
  npm run evals:critique                         # No regression

Phase 3 (Tool Guards):
  npm run evals:critique                         # Should show fewer wasted turns
  npm run evals -- grounding-critique            # Guard-related improvements

Phase 4 (Composite Patterns):
  npm run evals:critique                         # Should show fewer turns per task
```

### 3.3 New Eval Metrics to Track

Add to the context-efficiency runner:

| Metric | How Measured | Target |
|--------|-------------|--------|
| **Tokens per turn (system prompt)** | Count tokens in system message | ≤8K at NONE (down from ~12K) |
| **Tokens per turn (total)** | Count all message tokens | 20% reduction |
| **Cache hit rate** | OpenRouter `cached_tokens` in response | ≥60% of static prefix |
| **Perception calls per session** | Count VLM invocations | 30-40% reduction |
| **Tool pre-condition catches** | Count validation errors returned | >0 (guards are firing) |
| **Plan awareness after compression** | Agent references current step correctly | 100% (up from ~70%) |
| **Working notes utilization** | Agent calls update_notes ≥1x per session | >50% of sessions |

### 3.4 A/B Eval for Observation Masking

The context-efficiency runner supports A/B comparison:

```
For each golden case:
  1. Run with CURRENT compression (baseline)
  2. Run with observation masking (treatment)
  3. Compare: same tool calls? fewer tokens?
```

Pass criteria: treatment produces equivalent tool calls (toolNameScore ≥ 0.8) with measurably fewer tokens.

---

## 4. Implementation Order

```
Phase 0: Baseline Eval                              [~400 lines new]
  0.1  Build context-efficiency eval suite
  0.2  Write 8 golden cases
  0.3  Run all existing baselines, save results
  ─── CHECKPOINT: baseline captured ───

Phase 1: Prompt Structure & Caching                  [~90 lines changed]
  1.1  Reorder system.md template for caching
  1.2  Add cache_control to LLM client
  1.3  Harden plan persistence in compression
  1.4  Add observation masking at LIGHT/MEDIUM
  ─── RUN EVALS: verify no regression + measure savings ───

Phase 2: Context Quality                             [~100 lines new/changed]
  2.1  Add working notes scratchpad (new tool + prompt)
  2.2  Apply attribute whitelist at all compression levels
  2.3  Extend perception stale threshold for routine tools
  2.4  Add time awareness to system prompt
  ─── RUN EVALS: verify no regression + measure quality ───

Phase 3: Tool Guards                                 [~30 lines new]
  3.1  Add deterministic pre-conditions for element tools
  ─── RUN EVALS: verify fewer wasted turns ───

Phase 4: Composite Patterns                          [~20 lines prompt]
  4.1  Add Common Patterns section to system.md
  ─── RUN EVALS: final before/after comparison ───

Phase 5: Final Report
  Compare all baselines → generate unified report
```

---

## 5. File Manifest

### New Files

| File | Purpose | ~Lines |
|------|---------|--------|
| `evals/context-efficiency-types.ts` | Type definitions for context efficiency eval | ~60 |
| `evals/context-efficiency-runner.ts` | A/B replay engine (baseline vs optimized) | ~180 |
| `evals/context-efficiency-scorer.ts` | 5-dimension automated scoring | ~100 |
| `evals/golden/context-efficiency/context-eff-*.json` | 8 golden cases | ~60 each |

### Modified Files

| File | Changes | ~Lines |
|------|---------|--------|
| `prompts/runtime/agent/system.md` | Reorder for caching, add Common Patterns, Working Notes placeholder, time awareness | ~40 |
| `src/background/agent/context.ts` | Observation masking, plan persistence guard, attribute whitelist application, time/turn template vars, working notes rendering | ~60 |
| `src/background/agent/context-formatting.ts` | `maskToolResult()` helper | ~15 |
| `src/background/llm/client.ts` | Add `cache_control` breakpoint to system message | ~10 |
| `src/background/perception/perception-agent.ts` | Differentiated stale thresholds by tool type | ~15 |
| `src/background/tools/definitions.ts` | `UPDATE_NOTES_DEF` | ~15 |
| `src/background/tools/metadata.ts` | Metadata for `update_notes` | ~3 |
| `src/background/tools/index.ts` | Register `update_notes`, add element validation pre-conditions | ~40 |
| `src/background/agent/loop.ts` | Intercept `update_notes`, pass lastToolName to perception | ~20 |
| `src/types/tools.ts` | Add `UPDATE_NOTES` to ToolName enum | ~2 |
| `evals/cli.ts` | Add context-efficiency commands | ~20 |

**Total**: ~4 new files, ~11 modified files, ~950 lines of code (60% is eval infrastructure)

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prompt caching doesn't activate on OpenRouter | Medium | Medium | Monitor `cached_tokens` in responses. If zero, check cache_control format. Fallback: token savings from other changes still apply. |
| Observation masking loses critical context | Low | High | Preserve most recent 2-3 turns verbatim. The `summarizeHistory()` format retains tool name + args + outcome. A/B eval catches regressions. |
| Attribute pruning removes a decision-relevant attribute | Low | Medium | Whitelist is conservative (18 attributes). Any attribute needed can be retrieved via `read_element`. Eval golden cases test key scenarios. |
| Working notes tool distracts the agent | Low | Low | Tool is optional — agent uses it only when prompted or when it discovers something worth remembering. Keep description concise. Monitor utilization in evals. |
| Extended perception threshold causes stale observations | Medium | Medium | Force-refresh on URL change, plan step change, stagnation, and explicit read_page still triggers fresh perception. Only extends for routine actions where DOM changes are predictable. |
| Tool pre-condition errors cause loops | Low | Medium | Errors include guidance ("call read_page to refresh"). The agent already handles tool errors gracefully. Guard pattern is "detect-and-guide" not "detect-and-block." |

---

## 7. Success Metrics

After full implementation, compare baselines:

| Metric | Before (Estimated) | Target | How Measured |
|--------|-------------------|--------|-------------|
| System prompt tokens (NONE) | ~12K | ≤9K | Context metrics from eval runner |
| Total tokens per 15-turn session | ~180K | ≤130K (28% reduction) | Sum of all LLM call tokens |
| Cache hit rate (static prefix) | 0% | ≥50% | OpenRouter response `cached_tokens` |
| Perception calls per 15-turn session | ~12 | ≤8 (33% reduction) | Count VLM invocations in trace |
| Tool pre-condition catches | 0 | ≥1 per 5 sessions | Count validation errors |
| Plan awareness after compression | ~70% | 100% | Eval: agent references active step |
| Existing eval suite scores | Baseline | No regression (±2%) | Before/after comparison |
| Cost per 15-turn session | ~$0.08 | ≤$0.06 (25% reduction) | OpenRouter billing |

---

## 8. References

### Academic Papers

| Paper | Citation | Key Finding |
|-------|----------|-------------|
| The Complexity Trap | JetBrains, NeurIPS 2025 (arXiv:2508.21433) | Observation masking: +2.6% solve rate, -52% cost vs LLM summarization |
| Don't Break the Cache | arXiv:2601.06007 (Jan 2026) | Prompt caching: 41-80% cost reduction, 13-31% latency improvement |
| HiAgent | ACL 2025 (arXiv:2408.09559) | Subgoal-chunked memory: 2x success rate, 3.8 fewer steps |
| ACON | arXiv:2510.00615 (Oct 2025) | 26-54% token reduction preserving 95%+ accuracy |
| ToolSafe | arXiv:2601.10156 (Jan 2026) | Detect-and-guide: -65% harmful invocations, +10% task completion |
| AgentOccam | arXiv:2410.13825 | Action space pruning: +29.4% on WebArena |
| D2Snap | arXiv:2508.04412 | DOM downsampling: 73% success at 1-3K tokens/page |
| Building Browser Agents | arXiv:2511.19477 | Selective vision + AXTree: ~85% on WebGames |
| Agentic Plan Caching | NeurIPS 2025 (arXiv:2506.14852) | Plan template reuse: -50% cost, -27% latency |
| MemGPT | arXiv:2310.08560 | Self-editable working memory in system prompt |
| SWE-Agent | NeurIPS 2024 (arXiv:2405.15793) | ACI design > scaffolding code |
| Agent-E | arXiv:2407.13032 | Flexible DOM distillation: 73.2% on WebVoyager |
| LineRetriever | arXiv:2507.00210 | Planning-aware observation reduction: 73% fewer tokens |
| ColorBrowserAgent | arXiv:2601.07262 | Progressive progress summarization: 71.2% on WebArena |

### Industry Sources

| Source | Key Insight |
|--------|-------------|
| Anthropic, "Building Effective Agents" (2024) | "Start with raw API calls + system prompt + tool definitions" |
| Anthropic, "Effective Context Engineering" (2025) | Context engineering > prompt engineering for agents |
| Anthropic, "Effective Harnesses for Long-Running Agents" (2025) | JSON-structured task lists over prose for plan persistence |
| OpenRouter, Prompt Caching Guide | Sticky routing + cache_control for consistent cache hits |
| Claude Code System Prompts (Piebald-AI) | Minimal scaffold, prompt-driven behavior, tiered model usage |
| Speakeasy, Dynamic Toolsets (2025) | 96% token reduction with search/describe/execute (at 100+ tools) |
| Factory.ai, Context Compression Eval (2025) | Anchored structured summaries outperform naive compression |
