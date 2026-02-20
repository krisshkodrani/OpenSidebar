# RFC: Multi-Turn Conversation Resilience

## Status
Proposed

## References
- **Paper**: Laban et al., "LLMs Get Lost In Multi-Turn Conversation" (arXiv:2505.06120, May 2025)
- **Dataset**: Microsoft/lost_in_conversation (GitHub / HuggingFace)
- **Book**: Denis Rothman, *Context Engineering for Multi-Agent Systems* (Packt, 2025)
- **Internal**: Context Engineering RFCs (`docs/rfc/context/`), esp. RFC 3 (Plan-State Chaining), RFC 9 (Summarizer Role — descoped)

## Context

### The Empirical Evidence (Paper)

Laban et al. (2025) conducted large-scale experiments (200K+ simulated conversations, 15 LLMs, 6 tasks) demonstrating that **all state-of-the-art LLMs suffer ~39% performance degradation in multi-turn settings**. The degradation decomposes into a minor aptitude loss (−16%) and a massive reliability crisis (+112% unreliability). Reasoning models (o3, R1) are not immune. Temperature tuning is ineffective.

Every OpenSidebar agent session is a multi-turn conversation where information arrives incrementally (DOM snapshots, tool results, page transitions). This is precisely the "sharded" condition that triggers degradation. The paper identifies four pathologies that map directly to agent loop failure modes we already observe:

| Paper Pathology | OpenSidebar Manifestation |
|---|---|
| **Premature answer generation** | Agent commits to tool sequence before understanding page |
| **Anchoring to early outputs** | Repeats failed approach instead of pivoting |
| **Loss of middle turns** | DOM snapshots from turns 4-12 vanish from attention |
| **Answer bloat / verbosity** | Text-only responses grow longer and less actionable |

The paper tested two mitigations — **Recap** (consolidate all info in a final turn) recovering ~16pp, and **Snowball** (repeat all prior info each turn) recovering ~6pp. Neither fully restores single-turn performance, but both help.

### The Architectural Framework (Book)

Rothman (2025) approaches the same problem from the design side, advocating that context must be treated as an **engineered system** with explicit structure, role boundaries, and deliberate information flow. The book's core lessons that intersect with the paper:

1. **Context reduction is first-class, not cosmetic.** Compression/summarization is central to reliability — not a token-saving optimization. The paper now provides the empirical proof: without active context management, you lose 39% of model capability.

2. **Specialized roles with explicit handoff contracts.** A robust system uses orchestrator + planner + executor + verifier, not a monolithic loop. Each role operates in a short context window. The paper's translation anomaly (zero degradation for episodic tasks) validates this — short, independent conversations stay in the low-degradation zone.

3. **Summarizer as a core component.** The book prescribes a dedicated summarizer role for token/cost control. We descoped this (Context RFC 9) in favor of EXTREME deterministic compression. The paper's findings challenge that decision — deterministic truncation preserves *structure* but loses *meaning*, and the paper shows semantic preservation is what matters for multi-turn reliability.

4. **Plan-state chaining carries forward context explicitly.** The book's RFC 3 captures subtask results inline in the system prompt. This is independently the same pattern the paper identifies as "episodic" — each step carries its own context rather than relying on history recall.

### Cross-Source Convergence

Both sources arrive at the same conclusions from different directions:

| Principle | Paper Evidence | Book Prescription | OpenSidebar Status |
|---|---|---|---|
| Proactive summarization | Recap recovers ~16pp | Summarizer is a core role | Partial — only at escalation |
| Repeat critical info each turn | Snowball recovers ~6pp | Plan-state chaining | Partial — plan state yes, goal no |
| Short independent conversations | Episodic tasks = zero degradation | Role separation, handoff contracts | Partial — BRAINS→HANDS, subtasks |
| Structured handoffs on failure | "Consolidate before retrying" | `NodeHandoffArtifact` pattern | Missing — no fresh-start mechanism |
| Semantic > deterministic compression | Temperature/concat don't help | Summarizer, not just truncation | Gap — EXTREME uses truncation only |

OpenSidebar already implements partial versions of these patterns. This RFC proposes targeted improvements to close the remaining gaps, informed by both sources.

## Problem

Three specific failure modes stem from multi-turn degradation:

**P1: Goal Amnesia.** The original user query gets buried in conversation history. While the sliding window always preserves the first user message, it competes with 30+ subsequent messages for attention. The paper's "loss of middle turns" finding extends to loss of the *original intent* when it's just one message among many.

**P2: Late Distillation.** Context distillation only fires at escalation (5+ stale turns). By then the model has already spent multiple turns in a degraded state, compounding errors. The paper shows degradation begins at turn 2 and worsens monotonically — waiting for stuck detection means the damage is already done.

**P3: Non-Episodic Subtasks.** The guardian decomposes tasks into subtasks, but doesn't enforce independence between them. The paper found that *episodic* tasks (like translation) show zero degradation because each turn is self-contained. Non-episodic tasks (where earlier outputs constrain later ones) degrade worst. Our subtask boundaries don't optimize for this. The book's plan-state chaining (Context RFC 3) partially addresses this by carrying subtask results forward, but the guardian prompt doesn't explicitly optimize for episodic decomposition.

**P4: Lossy Deterministic Compression.** Our compression pipeline (LIGHT→MEDIUM→HEAVY→EXTREME) uses character truncation, message dropping, and fixed-format timelines. The book prescribed a dedicated summarizer role; we descoped it (Context RFC 9) because 3 deterministic mechanisms already existed and an LLM summarizer adds 2-4 expensive calls per session. The paper's findings challenge this: it shows that deterministic approaches (temperature tuning, concatenation) are insufficient for multi-turn resilience — what matters is *semantic* preservation of causal chains. Our `summarizeHistory()` produces `T3: click {id: 5} → "Clicked element"` which preserves structure but loses the *why* — the causal relationship between actions. The paper's Recap works because it preserves meaning, not just tokens.

**P5: Invisible Failure Modes.** The paper identifies four specific pathologies (premature generation, anchoring, middle-turn loss, verbosity) but our trace system doesn't tag which pathology caused a given failure. The book's glass-box principle demands that failure reasons be traceable and diagnosable. Without pathology tagging, we can't measure whether our mitigations target the right failure mode.

## Non-Goals

- Replacing the two-tier escalation architecture (the paper validates it)
- Changing LLM providers or models
- Modifying the tool system or tool definitions
- Addressing single-turn accuracy (the paper confirms aptitude is mostly preserved)
- Full LLM-based summarizer role (too expensive — see Decision Log for cost analysis)
- Multi-agent role separation of the core loop (aspirational but requires major rearchitecture)

## Solution

Six changes, ordered by expected impact and implementation cost:

### S1: Periodic Context Distillation ("Rolling Recap")

**Insight**: Don't wait for stuck detection. Distill proactively on a schedule.

**Paper basis**: Recap mitigation recovered ~16pp. Degradation is monotonic from turn 2.
**Book basis**: Lesson #4 — context reduction is first-class, not cosmetic. The descoped summarizer role (Context RFC 9) was replaced by EXTREME compression, but the paper shows deterministic truncation is insufficient.

Introduce a `rollingDistill()` method on `ContextManager` that periodically compresses older history into a structured summary, keeping recent turns verbatim. This implements the paper's "Recap" pattern *continuously* rather than only at escalation — and partially revives the book's summarizer role prescription without the LLM cost.

**Trigger**: Every `ROLLING_DISTILL_INTERVAL` turns (proposed: 8), if total message count exceeds `ROLLING_DISTILL_MIN_MESSAGES` (proposed: 12).

**Behavior**:
1. Preserve the last `ROLLING_DISTILL_KEEP_RECENT` messages (proposed: 6) verbatim
2. Compress all earlier messages (except the original query) into a **causal-chain-aware** summary (see S5)
3. Replace the compressed messages with a single `user` message containing the summary
4. This is lighter than `distillForEscalation()` — no tier switch, no persona change, just history compaction

**Why 8 turns?** The paper shows degradation is monotonic from turn 2 onward with steepest decline in turns 3-6. At 8 turns, we're well past the danger zone but have enough material to summarize meaningfully. The 6 verbatim recent messages ensure the model has full-fidelity access to its current working context.

### S2: Pinned Goal Reminder ("Snowball for Intent")

**Insight**: Repeat the user's original query prominently in the system prompt every turn.

**Paper basis**: Snowball recovered ~6pp. "Loss of middle turns" — models overweight first/last, lose middle.
**Book basis**: Plan-state chaining (Context RFC 3) already pins plan status in the system prompt. Extending this to the original query is the natural next step.

The paper's "Snowball" pattern (repeating all prior info each turn) is token-expensive, but repeating *just the original query* is nearly free and directly combats goal amnesia. Combined with plan-state chaining (which already carries subtask results), this ensures both the *goal* and *progress toward it* are structurally present every turn.

**Behavior**: Inject the original user query into the system prompt as a dedicated section, separate from conversation history. This is different from the sliding window's first-message preservation — it makes the goal a *structural* part of the prompt rather than a historical message.

```
## Current Task
The user asked: "{originalQuery}"
Stay focused on this goal. Do not deviate unless the user explicitly changes direction.
```

**Token cost**: Negligible — typically 20-50 tokens. The query is already in history; duplicating it in the system prompt adds minimal overhead but dramatically increases attention weight since system prompt tokens receive higher attention scores in most architectures.

### S3: Fresh-Start Recovery ("Conversation Reset")

**Insight**: When stuck, starting a new conversation with distilled context beats persisting in a degraded one.

**Paper basis**: Central end-user recommendation — "consolidate before retrying." The paper's most reliable configuration is "single-turn with full context."
**Book basis**: Explicit handoff contracts (`NodeHandoffArtifact`) for structured role transitions. The book's orchestrator hands off between planner→executor→verifier with typed artifacts — fresh-start is a handoff from "degraded self" to "fresh self."

**Behavior**: When the progress tracker triggers escalation AND the agent has already been escalated once in this session (`escalationCycles >= 2`), instead of another in-conversation escalation:

1. Build a structured `FreshStartBrief` (modeled on the book's handoff artifact pattern):
   - `originalQuery`: the user's task
   - `planState`: current subtask progress with captured results (from plan-state chaining)
   - `attemptLog`: distilled timeline of what was tried (from `summarizeHistory()`)
   - `failures`: ring buffer of failed actions with error messages
   - `currentPage`: URL + title + element summary
2. **Clear** the conversation history entirely
3. Rebuild with: system prompt + serialized brief as a single user message + current DOM snapshot
4. Resume on the smart tier with a fresh context window

This is stronger than escalation — it eliminates the accumulated noise, anchoring effects, and attention-diluting history that the paper shows compounds with each turn. By structuring the brief as a typed artifact (not a text blob), we preserve the book's principle of verifiable handoffs.

**Guard rails**:
- Maximum `MAX_FRESH_STARTS` per session (proposed: 2) to prevent infinite restart loops
- Only available after `MIN_TURNS_BEFORE_RESET` (proposed: 10) — don't reset before giving the model a fair chance
- The brief includes explicitly what was tried and what failed, so the model doesn't repeat the same strategy
- Trace event `fresh_start_recovery` emitted with the full brief for glass-box observability

### S4: Episodic Subtask Enforcement

**Insight**: Structure guardian plan decomposition to maximize subtask independence.

**Paper basis**: Translation task anomaly — zero degradation when each turn is episodic (self-contained). Non-decomposable tasks degrade worst.
**Book basis**: Plan-state chaining (Context RFC 3) captures subtask results so later steps can reference them structurally. The episodic directive extends this by ensuring the *descriptions themselves* are self-contained, not just the result chain.

The paper's translation task anomaly is key — zero degradation when each turn is episodic. Combined with the book's plan-state chaining (which carries forward completed subtask results in the system prompt), we can make each subtask effectively a "fresh mini-conversation" that doesn't depend on recalling history.

**Behavior**: Add a structural directive to the guardian's plan decomposition prompt:

```
Decompose the task into INDEPENDENT subtasks where possible.
Each subtask should be completable using only:
  - The current DOM state
  - The original user query
  - Its own subtask description
  - Results from completed prior subtasks (these are provided automatically)
Avoid subtasks that reference outputs of other subtasks by position ("the result from step 2").
Instead, describe the expected state: e.g., "Navigate to the URL that was found" →
"Navigate to the search results page for 'wireless headphones'."
If a subtask truly depends on a prior subtask's runtime output (e.g., a generated code),
note this explicitly as: [DEPENDS: step N output].
```

This doesn't guarantee full independence (some tasks are inherently sequential), but it prompts the guardian to make each subtask's description self-contained — carrying forward the necessary context rather than relying on the model to recall it from conversation history. Plan-state chaining ensures that even when dependencies exist, the completed results are structurally present in the system prompt rather than buried in history.

### S5: Causal-Chain-Aware Summarization

**Insight**: Deterministic summarization that preserves *why*, not just *what*.

**Paper basis**: The paper proves deterministic approaches (temperature, concatenation) are insufficient. Semantic preservation is what makes Recap work.
**Book basis**: The descoped summarizer role (Context RFC 9) was the right instinct. This is a lightweight compromise — smarter deterministic summarization that captures causal chains without LLM cost.

**Problem with current `summarizeHistory()`**: It produces flat timelines:
```
T3: click {id: 5} → "Clicked element"
T4: read_page {} → "[1] nav... [2] search..."
```

This loses the causal relationship — *why* was [5] clicked? *What* did the page read reveal?

**Improved format**: Group consecutive action→observation pairs and annotate causality:

```
T3-4: click [5] (search button) → page updated: search input [2] appeared, nav menu [1] visible
T5-6: type [2] "wireless headphones" → search results loaded: 12 product cards visible
T7: click [3] (first result "Sony WH-1000XM5") → ERROR: element not found after page transition
```

**Rules for causal grouping**:
1. A DOM-modifying tool call + the next `read_page`/snapshot = one group
2. The group summary includes: action taken, target element (resolved to readable name), outcome (what changed or what error)
3. Sequential discovery tools (`read_page`, `inspect_hidden`) that don't follow an action remain standalone
4. Errors are preserved verbatim — they're the most important signal for avoiding repeated strategies

**Token cost**: Zero LLM cost. This is still deterministic — just smarter pattern matching over the structured tool call/result pairs we already have. Roughly the same output length as current `summarizeHistory()` but with more information density per token.

**Relationship to Context RFC 9 (Summarizer Descope)**: This is the middle ground. We don't revive the full LLM summarizer role (2-4 expensive calls per session), but we make the deterministic summarizer meaningfully better at preserving semantics. If this proves insufficient, a targeted LLM summarizer that fires only at fresh-start boundaries (S3) could be reconsidered — that's 1-2 calls per session at most, not the 2-4 per session that justified the original descope.

### S6: Pathology-Tagged Trace Events

**Insight**: Tag each detected failure mode with the specific paper pathology for diagnosis and measurement.

**Paper basis**: Four identified pathologies — premature generation, anchoring, middle-turn loss, verbosity.
**Book basis**: Glass-box principle — failure reasons must be traceable and diagnosable. The book's trace event system already supports typed events (`safety_gate_blocked`, `moderation_preflight`, etc.).

**Behavior**: Add a new `TraceEvent` type `multi_turn_pathology` with a `pathology` field:

| Detection Signal | Tagged Pathology | Existing Mechanism |
|---|---|---|
| Dead-end detection fires (same outcome N times) | `anchoring` | `DEAD_END_DETECTION` in loop.ts |
| Redundant action detection fires | `anchoring` | `REDUNDANT_ACTION` in loop.ts |
| Text-only response with no tool calls | `premature_generation` or `verbosity` | Text-only handler in loop.ts |
| Rolling distillation discards >60% of messages | `middle_turn_loss` | S1 trigger (new) |
| Fresh-start recovery triggered | `compound_degradation` | S3 trigger (new) |
| Goal drift: LLM response doesn't reference any keyword from original query | `middle_turn_loss` | New heuristic (simple keyword overlap check) |

These events are diagnostic only — they don't change agent behavior. They enable:
- Aggregate analysis: "What % of sessions hit anchoring vs. middle-turn loss?"
- Mitigation validation: "Did S1 reduce middle-turn-loss events?"
- Per-session diagnosis: "This session failed because of anchoring at turn 7"

## Implementation

### S1: Rolling Distillation

**File**: `src/background/agent/context.ts`

Add constants:

```typescript
const ROLLING_DISTILL = {
  INTERVAL: 8,          // distill every N turns
  MIN_MESSAGES: 12,     // don't distill if fewer messages
  KEEP_RECENT: 6,       // preserve last N messages verbatim
  MAX_SUMMARY_ENTRIES: 15,  // cap timeline entries
} as const;
```

Add method to `ContextManager`:

```typescript
rollingDistill(): boolean {
  const messages = this.getMessages();
  if (messages.length < ROLLING_DISTILL.MIN_MESSAGES) return false;

  // Find the split point: preserve last KEEP_RECENT messages
  const splitIdx = messages.length - ROLLING_DISTILL.KEEP_RECENT;
  if (splitIdx <= 1) return false; // nothing to compress (index 0 is original query)

  // Summarize older messages (skip index 0 = original query)
  const olderMessages = messages.slice(1, splitIdx);
  const summary = summarizeCausalChain(olderMessages, ROLLING_DISTILL.MAX_SUMMARY_ENTRIES);

  if (!summary) return false;

  // Replace older messages with a single summary message
  const summaryMessage: LLMMessage = {
    role: "user",
    content: `[Context recap — turns 1-${splitIdx}]\n${summary}\n[End recap]`,
  };

  // Rebuild: [original query, summary, ...recent messages]
  const original = messages[0];
  const recent = messages.slice(splitIdx);
  this.replaceHistory([original, summaryMessage, ...recent]);

  return true;
}
```

**File**: `src/background/agent/loop.ts`

Call `rollingDistill()` from the main loop, after tool execution completes each turn:

```typescript
// After processing tool results, check if periodic distillation is needed
if (turnCount > 0 && turnCount % ROLLING_DISTILL.INTERVAL === 0) {
  const didDistill = context.rollingDistill();
  if (didDistill) {
    logger.info("Rolling distillation applied", { turn: turnCount });
  }
}
```

### S2: Pinned Goal Reminder

**File**: `src/background/agent/context.ts`

In `buildSystemPrompt()`, after the plan status section, inject the goal reminder:

```typescript
if (this.originalQuery) {
  parts.push(
    `\n## Current Task\nThe user asked: "${this.originalQuery}"\n` +
    `Stay focused on this goal. Do not deviate unless the user explicitly changes direction.`
  );
}
```

**File**: `src/background/agent/loop.ts`

Set `context.originalQuery` at the start of the loop (it's already available via `getOriginalQuery()`). This may already be wired — verify the field is populated when `buildSystemPrompt()` runs.

### S3: Fresh-Start Recovery

**File**: `src/background/agent/loop.ts`

Add the `FreshStartBrief` type (modeled on the book's `NodeHandoffArtifact` pattern):

```typescript
interface FreshStartBrief {
  originalQuery: string;
  planState: string | null;      // from plan-state chaining (subtask progress + results)
  attemptLog: string;            // from summarizeCausalChain()
  failures: string[];            // from failed-action memory ring buffer
  currentPage: {
    url: string;
    title: string;
    elementCount: number;
  };
  freshStartNumber: number;      // 1-indexed, for the model to know this is a retry
  totalTurnsSoFar: number;
}
```

Add constants:

```typescript
const FRESH_START = {
  MAX_PER_SESSION: 2,
  MIN_TURNS_BEFORE_RESET: 10,
  TRIGGER_ESCALATION_CYCLE: 2,  // activate on 2nd+ escalation cycle
} as const;
```

Add fresh-start logic to the escalation handler:

```typescript
let freshStartCount = 0;

// Inside the escalation handler, before standard escalation:
if (
  escalationCycles >= FRESH_START.TRIGGER_ESCALATION_CYCLE &&
  freshStartCount < FRESH_START.MAX_PER_SESSION &&
  turnCount >= FRESH_START.MIN_TURNS_BEFORE_RESET
) {
  freshStartCount++;

  // Build structured brief (book's handoff artifact pattern)
  const brief: FreshStartBrief = {
    originalQuery,
    planState: context.getPlanStatus(),
    attemptLog: summarizeCausalChain(context.getMessages(), 20),
    failures: failedActionMemory.map(f => `${f.tool}(${f.argsKey}) → ${f.error}`),
    currentPage: { url: currentUrl, title: currentTitle, elementCount: prevElementCount },
    freshStartNumber: freshStartCount,
    totalTurnsSoFar: turnCount,
  };

  // Emit trace event (book's glass-box principle)
  trace.recordEvent({
    type: "fresh_start_recovery",
    pathology: "compound_degradation",
    brief,
  });

  logger.info("Fresh-start recovery triggered", {
    cycle: escalationCycles,
    freshStart: freshStartCount,
    turn: turnCount,
  });

  // Serialize brief into a structured prompt
  const briefText = [
    `## Fresh Start #${brief.freshStartNumber} (after ${brief.totalTurnsSoFar} turns)`,
    `**Task:** ${brief.originalQuery}`,
    brief.planState ? `**Plan progress:**\n${brief.planState}` : null,
    `**What was tried:**\n${brief.attemptLog}`,
    brief.failures.length > 0
      ? `**Failed approaches (DO NOT repeat):**\n${brief.failures.map(f => `- ${f}`).join("\n")}`
      : null,
    `**Current page:** ${brief.currentPage.url} — "${brief.currentPage.title}" (${brief.currentPage.elementCount} elements)`,
    `\nYou are starting fresh. Try a DIFFERENT strategy than what was attempted above.`,
  ].filter(Boolean).join("\n\n");

  // Clear and rebuild
  context.clearHistory();
  context.addMessage({ role: "user", content: briefText });

  // Reset all loop state
  progress.reset();
  failedActionMemory.length = 0;
  consecutiveTextOnly = 0;
  deadEndWindow.length = 0;

  // Stay on smart tier
  if (escalationTier === 0) {
    await escalateModel(tabId, prevElementCount);
  }

  continue; // restart the loop iteration
}
```

### S4: Episodic Subtask Directive

**File**: `src/prompts/registry.ts` (or wherever the guardian plan prompt is defined)

Append to the plan decomposition section of the guardian prompt:

```typescript
const EPISODIC_SUBTASK_DIRECTIVE = `
SUBTASK INDEPENDENCE: Each subtask description must be self-contained.
- A subtask should be completable using only the DOM state and its own description.
- Do NOT write subtasks that reference "the result from step N" or "the value found above."
- Instead, inline the expected context: e.g., instead of "Click the link found in step 2",
  write "Click the 'Settings' link in the navigation menu."
- If a subtask truly depends on a prior subtask's runtime output (e.g., a generated code),
  note this explicitly as: [DEPENDS: step N output].
`;
```

### S5: Causal-Chain-Aware Summarization

**File**: `src/background/agent/context.ts`

Replace (or augment) `summarizeHistory()` with `summarizeCausalChain()`:

```typescript
/**
 * Causal-chain-aware summarization.
 * Groups action→observation pairs and preserves why, not just what.
 * Zero LLM cost — deterministic pattern matching over structured tool data.
 */
function summarizeCausalChain(messages: LLMMessage[], maxEntries: number): string {
  const entries: string[] = [];
  let i = 0;

  while (i < messages.length && entries.length < maxEntries) {
    const msg = messages[i];

    // Look for assistant message with tool calls
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const toolCall = msg.tool_calls[0]; // primary action
      const toolName = toolCall.function?.name ?? "unknown";
      const args = safeParseArgs(toolCall.function?.arguments);

      // Look ahead for the corresponding tool result
      const nextMsg = messages[i + 1];
      const result = nextMsg?.role === "tool"
        ? nextMsg.content?.slice(0, 120) ?? ""
        : "";

      // Resolve element references to readable names
      const target = resolveElementRef(toolName, args);
      const isError = result.toLowerCase().startsWith("error");

      // Group format: "T3-4: click [5] (search button) → page updated: search input appeared"
      if (toolName === "wait") {
        i += nextMsg?.role === "tool" ? 2 : 1;
        continue; // skip noise tools
      }

      const turnLabel = nextMsg?.role === "tool" ? `T${i}-${i + 1}` : `T${i}`;
      const entry = isError
        ? `${turnLabel}: ${toolName} ${target} → ERROR: ${result.slice(7, 100)}`
        : `${turnLabel}: ${toolName} ${target} → ${result.slice(0, 100)}`;

      entries.push(entry);
      i += nextMsg?.role === "tool" ? 2 : 1;
    } else {
      i++;
    }
  }

  return entries.join("\n");
}

/** Resolve tool args to a human-readable target description */
function resolveElementRef(toolName: string, args: Record<string, unknown>): string {
  const id = args.id ?? args.element_id;
  const text = args.text ?? args.value ?? args.query ?? "";
  const textSnippet = typeof text === "string" && text.length > 0
    ? ` "${text.slice(0, 40)}"`
    : "";

  if (id !== undefined) return `[${id}]${textSnippet}`;
  if (args.url) return `(${String(args.url).slice(0, 60)})`;
  return textSnippet || JSON.stringify(args).slice(0, 50);
}
```

**Key differences from current `summarizeHistory()`**:
- Groups action + observation into one entry (halves the line count)
- Preserves element IDs with text snippets for readability
- Marks errors explicitly (most important signal)
- Skips noise tools (`wait`)
- Same token budget, higher information density

### S6: Pathology-Tagged Trace Events

**File**: `src/background/agent/trace.ts`

Add pathology event type:

```typescript
interface PathologyEvent extends TraceEvent {
  type: "multi_turn_pathology";
  pathology: "anchoring" | "premature_generation" | "verbosity"
           | "middle_turn_loss" | "compound_degradation";
  trigger: string;      // what detection mechanism fired
  turn: number;
  details?: string;
}
```

**File**: `src/background/agent/loop.ts`

Add pathology tagging to existing detection mechanisms (zero new detection logic — piggyback on what's already there):

```typescript
// In dead-end detection handler (existing):
trace.recordEvent({
  type: "multi_turn_pathology",
  pathology: "anchoring",
  trigger: "dead_end_detection",
  turn: turnCount,
  details: `Same outcome ${count}x: ${normalizedOutcome.slice(0, 80)}`,
});

// In redundant action handler (existing):
trace.recordEvent({
  type: "multi_turn_pathology",
  pathology: "anchoring",
  trigger: "redundant_action",
  turn: turnCount,
  details: `${toolName}(${argsKey}) repeated on same page state`,
});

// In text-only response handler (existing):
trace.recordEvent({
  type: "multi_turn_pathology",
  pathology: consecutiveTextOnly >= 2 ? "verbosity" : "premature_generation",
  trigger: "text_only_response",
  turn: turnCount,
  details: `${consecutiveTextOnly} consecutive text-only responses`,
});

// In rolling distillation (S1, new):
const compressionRatio = (messages.length - ROLLING_DISTILL.KEEP_RECENT) / messages.length;
if (compressionRatio > 0.6) {
  trace.recordEvent({
    type: "multi_turn_pathology",
    pathology: "middle_turn_loss",
    trigger: "rolling_distill_heavy",
    turn: turnCount,
    details: `Compressed ${Math.round(compressionRatio * 100)}% of history`,
  });
}
```

**File**: `scripts/trace-query.ts`

Add a `pathologies` command to the trace CLI:

```typescript
// bun run traces pathologies [sessionId]
// Output: count of each pathology type, per-session or aggregate
```

## Testing

### Unit Tests

**S1 — Rolling distillation**:
- Test that `rollingDistill()` is a no-op when `messages.length < MIN_MESSAGES`
- Test that original query (index 0) is always preserved
- Test that last `KEEP_RECENT` messages are preserved verbatim
- Test that intermediate messages are replaced with a single summary
- Test that calling `rollingDistill()` twice in succession doesn't over-compress

**S2 — Pinned goal**:
- Test that `buildSystemPrompt()` includes the "Current Task" section when `originalQuery` is set
- Test that the section is absent when `originalQuery` is null/empty

**S3 — Fresh-start recovery**:
- Test that fresh start triggers only when `escalationCycles >= 2`
- Test that `MAX_PER_SESSION` is respected
- Test that `MIN_TURNS_BEFORE_RESET` is respected
- Test that history is fully cleared and rebuilt with structured `FreshStartBrief`
- Test that failed-action memory is included in the brief
- Test that plan-state is carried forward when active
- Test that a `fresh_start_recovery` trace event is emitted

**S4 — Episodic directive**:
- Test that the guardian prompt includes the episodic subtask directive
- Eval: compare subtask descriptions with/without directive for cross-reference patterns

**S5 — Causal-chain summarization**:
- Test that action + tool_result pairs are grouped into single entries
- Test that element IDs are resolved to readable `[N] "text"` format
- Test that errors are preserved verbatim with `ERROR:` prefix
- Test that noise tools (`wait`) are skipped
- Test that `maxEntries` cap is respected
- Test round-trip: build messages with known tool calls, verify summary captures causal chain

**S6 — Pathology trace events**:
- Test that dead-end detection emits `anchoring` pathology event
- Test that redundant action emits `anchoring` pathology event
- Test that text-only response emits `premature_generation` or `verbosity`
- Test that rolling distillation with >60% compression emits `middle_turn_loss`
- Test that fresh-start emits `compound_degradation`

### Eval Pipeline

Use the existing eval infrastructure (`bun run evals`) to measure:

1. **Baseline**: Run current eval suite, record per-case pass rates and turn counts
2. **Post-S1+S5**: Re-run, compare turn counts (expect fewer total turns due to less drift) and inspect distilled summaries for causal chain quality
3. **Post-S1+S2+S5**: Re-run, compare pass rates (expect improvement on longer sessions)
4. **Post-all**: Full suite, compare recovery rates on `error_recovery` and `edge_*` golden files
5. **Pathology analysis**: After S6, run `bun run traces pathologies` on eval sessions to establish baseline pathology distribution

**New eval cases** to add:
- `multi_turn_goal_drift.json`: Task requiring 10+ turns where the original goal could be forgotten
- `multi_turn_recovery.json`: Task where the first strategy fails and the agent must pivot
- `multi_turn_long_session.json`: Task requiring 15+ turns to validate rolling distillation and causal-chain summarization

### Manual Testing

- Run the agent on a complex multi-step task (e.g., multi-page checkout flow)
- Verify rolling distillation fires at turn 8 and 16 (visible in logs)
- Verify the pinned goal section appears in every system prompt (inspect via trace)
- Verify fresh-start recovery fires after repeated stuck detection (requires a genuinely hard page)
- Verify causal-chain summaries are more readable than flat timelines (compare in trace viewer)
- Verify pathology events appear in traces and are queryable via `bun run traces pathologies`

## Impact

### Performance
- **S1**: Reduces context window usage over long sessions. After distillation at turn 8, history shrinks from ~12 messages to ~8 (1 original + 1 summary + 6 recent). Saves ~2000-4000 tokens per cycle.
- **S2**: Adds ~30-50 tokens per turn. Negligible.
- **S3**: One-time cost of building `FreshStartBrief` + full history rebuild. Net token savings since the fresh context is much smaller than the accumulated history.
- **S4**: Adds ~100 tokens to the guardian prompt. One-time per session.
- **S5**: Same output length as current `summarizeHistory()` but with 2x information density per token (action+observation grouped). Zero additional cost.
- **S6**: Negligible — one `recordEvent()` call piggybacks on existing detection logic.

### Reliability
- The paper predicts that Recap-style mitigation (S1) should recover ~16pp of the 39% multi-turn degradation
- Snowball-for-intent (S2) should recover an additional ~3-5pp for goal-related failures
- Fresh-start (S3) effectively converts a degraded multi-turn session into a "single-turn with context" — the paper's most reliable configuration
- Causal-chain summarization (S5) makes S1 and S3 more effective by preserving *why* actions were taken, not just *what* was done — the paper shows semantic preservation is what makes Recap work
- Episodic subtasks (S4) combined with plan-state chaining (book RFC 3) should approach the paper's translation anomaly — near-zero degradation per subtask
- Pathology tagging (S6) enables data-driven prioritization of future mitigations
- The combination targets the full ~39% gap, though we expect diminishing returns as mitigations overlap

### Risks
- **S1 over-compression**: Rolling distillation could discard still-relevant details from older turns. Mitigated by the `KEEP_RECENT` parameter and the existing `DISCOVERY_TOOLS` preservation logic.
- **S3 information loss**: A fresh start discards the raw history entirely. The structured `FreshStartBrief` may miss nuances. Mitigated by including plan state, causal-chain summary, and failed-action log, and by limiting to `MAX_PER_SESSION = 2`. The book's handoff artifact pattern ensures the brief is structured and complete rather than ad-hoc.
- **S4 rigidity**: Forcing episodic subtasks may be unnatural for inherently sequential tasks. Mitigated by the `[DEPENDS: step N output]` escape hatch and by plan-state chaining carrying forward completed results.
- **S5 edge cases**: Causal grouping assumes tool calls are followed by tool results. Malformed or missing results could break grouping. Mitigated by fallback to flat format when pairing fails.
- **S6 false positives**: Pathology classification is heuristic (e.g., text-only → "premature_generation" may actually be the model asking a clarifying question). These are diagnostic tags, not behavioral triggers, so false positives have low cost.

## Rollout Plan

| Phase | Changes | Validation | Book/Paper Basis |
|---|---|---|---|
| **1** | S2 (pinned goal) + S6 (pathology tracing) | Trace inspection, smoke test | Snowball + glass-box |
| **2** | S5 (causal-chain summarization) | Unit tests, inspect summaries in traces | Summarizer role (revised) |
| **3** | S1 (rolling distillation, uses S5) | Unit tests + eval suite comparison | Recap + context reduction |
| **4** | S4 (episodic subtasks) | Eval suite + manual review of generated plans | Translation anomaly + plan-state chaining |
| **5** | S3 (fresh-start recovery, uses S5) | Manual testing on hard tasks | Handoff contracts + "consolidate before retrying" |

**Rationale for order**: S2 and S6 are trivial and immediately useful (S6 establishes the baseline pathology distribution before other changes land). S5 is a prerequisite for S1 and S3 — both consume its output. S1 is the highest-impact change. S4 improves plan quality independent of other changes. S3 is the most complex and benefits from all prior changes being in place.

## Decision Log

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Distillation interval | 8 turns | 4 turns, 12 turns | Paper shows steep degradation at 3-6 turns; 8 gives buffer without over-compressing |
| Recent messages preserved | 6 | 3, 10 | 6 covers ~3 tool-call rounds (assistant+tool_result pairs); enough working context |
| Fresh-start trigger | 2nd escalation cycle | 1st, 3rd | 1st cycle is normal recovery; by 2nd, in-conversation repair has demonstrably failed |
| Fresh-start brief format | Typed `FreshStartBrief` struct | Free-text distillation | Book's handoff artifact pattern — structured > ad-hoc for verifiability and completeness |
| Goal pinning location | System prompt | History injection | System prompt gets higher attention weight; doesn't consume history budget. Book's plan-state chaining validates system-prompt-level context injection |
| Subtask directive | Prompt addition | Structural validation | Prompt guidance is simpler and doesn't require parsing plan output |
| Summarizer role | Causal-chain deterministic (S5) | Full LLM summarizer, EXTREME compression only | Book prescribed LLM summarizer (2-4 calls/session, ~$0.02-0.08 cost). Paper shows deterministic is insufficient. S5 is the middle ground — smarter deterministic, zero LLM cost. If S5 proves insufficient, targeted LLM summarizer at fresh-start boundaries (1-2 calls max) can be reconsidered |
| Pathology detection | Piggyback on existing mechanisms | New dedicated detector | All four pathologies already have detection signals in the loop (dead-end, redundant action, text-only). Adding trace events costs nothing; building new detectors adds complexity for uncertain value |
