# RFC-025: Intelligent History Pruning ("Lessons Learned")

* **Status:** Draft
* **Created:** 2026-02-15
* **Context:** Improves agent reliability by preventing repetitive failure loops during long-running tasks (like the "30-step challenge").

## 1. Summary

This RFC proposes a mechanism to inject a **"Lesson Learned"** summary into the agent's context when a Strategy Pivot occurs.

Currently, when the agent gets stuck and triggers a reset (`strategyPivot`), it wipes the entire conversation history ("Amnesia"). This often causes the agent to immediately retry the exact same failed approach.

We will modify the reset logic to synthesize a brief summary of *why* the previous attempt failed and inject it as a **System Constraint** for the fresh attempt.

## 2. Motivation

In complex automation tasks, agents often fall into local minima:

1. **The Loop:** Agent tries to click a button  Fails  Retries  Fails  `strategyPivot` triggers.
2. **The Amnesia:** History is cleared. The agent sees the original goal again.
3. **The Repeat:** Lacking memory of the failure, the agent tries to click the button again.

By carrying over a "Negative Constraint" (e.g., *"Do not try to click element #45; it is unclickable. Use the search bar instead."*), we force the model to explore alternative paths immediately.

## 3. Technical Design

### 3.1 Failure Summarization (`src/background/agent/analysis.ts`)

We need a lightweight heuristic to extract the "Lesson." We don't want to burn tokens asking an LLM to summarize the failure if we can avoid it, but for high-quality pivots, a quick "Reflection" call is worth it.

```typescript
// src/background/agent/analysis.ts

export async function analyzeFailure(history: LLMMessage[]): Promise<string> {
  // Simple heuristic: Look for the last tool error
  const lastError = history
    .slice().reverse()
    .find(m => m.role === 'tool' && m.content.includes('Error'));

  if (lastError) {
    return `Previous attempt failed with error: ${lastError.content.slice(0, 200)}. Avoid the specific action that caused this.`;
  }

  // Advanced: Ask the LLM (if we have budget)
  // "Summarize why the last 3 steps failed in one sentence."
  return "Previous attempt failed to make progress. Try a completely different navigation path.";
}

```

### 3.2 Update Strategy Pivot (`src/background/agent/loop.ts`)

Modify the `strategyPivot` method to generate this lesson before clearing history.

```typescript
// src/background/agent/loop.ts

private async strategyPivot(reason: string) {
  logger.warn(`Pivoting strategy: ${reason}`);

  // 1. Analyze what went wrong
  const lesson = await analyzeFailure(this.history);
  
  // 2. Clear History (Amnesia)
  this.history = [];
  
  // 3. Re-inject System Prompt
  // (Assuming getSystemPrompt() is available)
  this.history.push({ role: "system", content: getSystemPrompt() });

  // 4. Inject the Lesson as a High-Priority User Instruction
  this.history.push({
    role: "user", 
    content: `IMPORTANT: We are restarting this task because the previous attempt failed.
    
    FAILURE CONTEXT: ${lesson}
    
    GOAL: ${this.userQuery}
    
    Please try a different approach.`
  });
  
  // 5. Reset State Flags
  this.consecutiveFailures = 0;
  this.pivotDone = true;
}

```

### 3.3 Semantic "Do Not" Constraints

To make the lesson effective, we should explicitly format it as a "Negative Constraint" in the prompt.

**Example Injection:**

> "CONSTRAINT: Do not use the `click_element` tool on the 'Sign Up' button if it failed twice. Check for iframes first."

## 4. Risks & Trade-offs

* **Hallucinated Lessons:** The analysis might blame the wrong tool.
* *Mitigation:* Keep the lesson generic ("Previous attempt failed") unless there is a specific explicit error message (e.g., "Element not visible").


* **Token Cost:** If we use an LLM call to generate the summary, it adds cost.
* *Decision:* Start with the heuristic approach (regex for "Error:" in tool outputs). Only escalate to LLM-based summary if the error is silent (e.g., stuck loop without exceptions).



## 5. Implementation Plan

1. **Create `src/background/agent/analysis.ts**`: Implement `analyzeFailure`.
2. **Modify `src/background/agent/loop.ts**`: Update `strategyPivot` to await the analysis and inject the result into the new history stack.
3. **Test**: Manually induce a failure (try to click a non-existent ID 3 times) and verify the next prompt contains the "Failure Context" block.

---

## Review & Status (2026-02-15)

### DONE

- **Failure summary extraction**: Implemented as `extractAttemptSummary()` in `loop.ts:119-195`. Heuristic extraction of failure context from conversation history — covers the RFC's `analyzeFailure()` proposal without the separate `analysis.ts` file.
- **Pivot message**: Implemented as `PIVOT_MESSAGE` template with dynamic failure context injection. Formats the lesson as a high-priority constraint, matching the RFC's "Negative Constraint" pattern.
- **Escalation nudge**: Implemented as `ESCALATION_NUDGE` and `DEESCALATION_NUDGE` constants. Used at both voluntary (`escalate` tool) and automatic escalation points.

### NOT RECOMMENDED

- **Persistent lessons across sessions**: The memory system already provides this via `memory_add`/`memory_search`. Adding another persistence layer for failure lessons is redundant — the agent can store important lessons in memory if needed.
- **Dedicated `analysis.ts` module**: `extractAttemptSummary()` is compact and well-placed in `loop.ts`. No benefit to extracting it into a separate file for a single function.

### MILD VALUE (not prioritized)

- **Failure categorization**: Could categorize errors into buckets (element_not_found, click_intercepted, navigation_timeout, text_not_visible) for more targeted pivot instructions. But the heuristic approach already captures the gist via raw error messages. ROI is low.

### OVERALL

This RFC is essentially complete. The core idea — carry failure context across strategy pivots instead of full amnesia — is fully implemented. Remaining ideas are diminishing returns.