import { LLMMessage } from "../llm/types";
import { DomSnapshot, TaggedElement } from "../../types";
import { logger } from "../../utils";

export enum CompressionLevel {
  NONE = "none",
  LIGHT = "light",
  MEDIUM = "medium",
  HEAVY = "heavy",
}

export interface ContextMetrics {
  systemTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilization: number;
  elementCount: number;
  compressionLevel: CompressionLevel;
}

export interface PlanStatus {
  subtasks: { description: string; status: string }[];
  currentIndex: number;
}

const SYSTEM_PROMPT_TEMPLATE = `
You are OpenSidebar, an autonomous browser agent.

## Core Loop: Observe → Think → Act → Verify
Every turn, follow this cycle:
1. **Observe**: Read Visible Elements and Viewport Text. What state is the page in?
2. **Think** (2-3 lines):
   - What do I see? (key page state, relevant elements)
   - What will I do and why? (connect observation to action)
   - What should change? (predicted outcome to verify next turn)
3. **Act**: Call the appropriate tool(s).
4. **Verify** (next turn): Compare expected vs actual outcome.
   - Match → state what to do next.
   - Mismatch → state what went wrong, then try a different approach.

## Answering Questions
If the user asks a question about the page (e.g. "what is this?", "describe...", "tell me about..."),
answer it directly using done({"summary": "your answer"}) — do NOT start performing actions.
Only begin acting on the page if the user asks you to DO something (click, fill, navigate, solve, etc.).

## Rules
- Always include your Think reasoning WITH tool calls. Never call tools blindly.
- After navigation or page change, re-read page state before acting.
- If an action had no visible effect, do NOT repeat it. Try an alternative.
- If find_element fails or returns unexpected results, call read_page to see all available elements.
- If stuck for 2+ turns, take_screenshot to see what the page actually looks like.
- When a plan is provided, follow it step by step. Call update_plan after each step.
- Call done() ONLY when ALL planned steps are complete. Premature done() will be rejected.
- Work autonomously — do not ask the user for permission between steps.

{{planStatus}}
## Multi-Step Planning
When an Active Plan is shown above:
1. Focus ONLY on the current step. Ignore future steps.
2. Execute the current step using the appropriate tool(s).
3. When the step is done, call update_plan({subtasks, currentIndex: NEXT_INDEX, lastResult: "what you did"}).
   - currentIndex = the 0-based index of the NEXT step to execute.
   - lastResult = brief description of what you accomplished.
4. The system will confirm and show the next step. Then execute it.
5. Only call done() when ALL steps show as completed.

If no Active Plan is shown, the task is simple — act directly and call done() when finished.
Do NOT call done() until every planned step is complete.

## Tool Tips
- type_text auto-focuses; pressEnter: true submits forms in one step.
- hide_element to dismiss overlays/modals blocking interaction.
- scroll_page with optional id for container scrolling.
- press_key for keyboard shortcuts or key-based inputs.
- drag_and_drop between [draggable] elements by tag ID.
- draw_stroke on canvas elements with start/end coordinates.
- select_option for <select> dropdowns — pass visible option text.
- take_screenshot when the page doesn't match expectations.
- Batch independent actions in one turn (e.g. fill all form fields).
- Memory: memory_search to recall, memory_add to save important facts.
- escalate when stuck on riddles, puzzles, math, or multi-step logic.

## Common Patterns
- Login: type username → type password with pressEnter (or click submit).
- Search: type query into search input + pressEnter, or click search button.
- Forms: batch all field fills in one turn, then submit.
- Menus: hover to reveal dropdowns; check aria-expanded after.
- Overlays: dismiss blocking modals/banners before interacting with content below.
- Multi-page: track which step you're on; verify each before proceeding.
- Dynamic content: scroll or wait for lazy-loaded items to appear.
- Visual puzzles: take_screenshot when text alone is insufficient.

## Page Context
Title: {{title}}
URL: {{url}}
{{scrollIndicator}}

## Visible Elements
{{elements}}

## Viewport Text (Summary)
{{viewportText}}
`;

export class ContextManager {
  private history: LLMMessage[] = [];
  private snapshot: DomSnapshot | null = null;
  private maxHistory = 20;
  private maxContextTokens: number;
  private planStatus: PlanStatus | null = null;

  constructor(maxContextTokens: number = 32000) {
    this.maxContextTokens = maxContextTokens;
  }

  public setPlanStatus(subtasks: { description: string; status: string }[], currentIndex: number): void {
    this.planStatus = { subtasks, currentIndex };
  }

  public clearPlanStatus(): void {
    this.planStatus = null;
  }

  private formatPlanStatus(): string {
    if (!this.planStatus) return "";
    const { subtasks, currentIndex } = this.planStatus;
    const total = subtasks.length;

    if (currentIndex >= total) {
      // All steps done
      const lines = subtasks.map((s, i) => `  ${i + 1}. ${s.description} [done]`);
      return `## Active Plan\nAll ${total} steps completed.\n${lines.join("\n")}\nCall done() now with a summary of everything accomplished.`;
    }

    const currentDesc = subtasks[currentIndex]?.description || "Unknown";
    const completedLines = subtasks
      .slice(0, currentIndex)
      .map((s, i) => `  ${i + 1}. ${s.description} [done]`);
    const nextStep = currentIndex + 1 < total ? subtasks[currentIndex + 1] : null;

    let block = `## Active Plan\nStep ${currentIndex + 1} of ${total}: "${currentDesc}"\n`;
    if (completedLines.length > 0) {
      block += `Completed:\n${completedLines.join("\n")}\n`;
    }
    if (nextStep) {
      block += `Next: ${currentIndex + 2}. ${nextStep.description}\n`;
    }
    block += `Execute the current step now. Call update_plan() when done to advance.`;
    return block;
  }

  public setSnapshot(snapshot: DomSnapshot) {
    this.snapshot = snapshot;
  }

  public getSnapshot(): DomSnapshot | null {
    return this.snapshot;
  }

  public getCurrentUrl(): string {
    return this.snapshot?.url ?? "";
  }

  public addMessage(message: LLMMessage) {
    this.history.push(message);

    // Compress old tool results to save context budget
    if (message.role === "tool") {
      this.compressOldToolResults(2);
    }

    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }
    this.saveState().catch((err) =>
      logger.error("agent", "Auto-save failed", { error: err }),
    );
  }

  public getPrompt(): LLMMessage[] {
    const systemMessage = this.constructSystemMessage();

    // 1. Calculate budget
    const RESERVED_OUTPUT_TOKENS = 1000;

    const systemTokens = this.estimateMessageTokens(systemMessage);
    let availableTokens =
      this.maxContextTokens - systemTokens - RESERVED_OUTPUT_TOKENS;

    if (availableTokens < 0) {
      logger.warn("agent", "System prompt too large!", { systemTokens });
      availableTokens = 1000; // Emergency fallback
    }

    // 2. Always keep the first user message (Goal Amnesia Prevention)
    const finalMessages: LLMMessage[] = [];
    let firstUserMsg: LLMMessage | null = null;
    const remainingHistory = [...this.history];

    // Find and preserve first user message
    const firstUserIdx = remainingHistory.findIndex((m) => m.role === "user");
    if (firstUserIdx !== -1) {
      firstUserMsg = remainingHistory[firstUserIdx];
      const tokens = this.estimateMessageTokens(firstUserMsg);
      if (availableTokens >= tokens) {
        availableTokens -= tokens;
      } else {
        firstUserMsg = null;
      }
    }

    // 3. Fill from end (most recent)
    const reversedHistory = [...remainingHistory].reverse();
    const selectedReverse: LLMMessage[] = [];

    for (let i = 0; i < reversedHistory.length; i++) {
      const msg = reversedHistory[i];

      // Skip the first user message if we already reserved it
      if (firstUserMsg && msg === firstUserMsg) continue;

      const group: LLMMessage[] = [msg];
      let groupTokens = this.estimateMessageTokens(msg);

      if (msg.role === "tool") {
        if (i + 1 < reversedHistory.length) {
          const nextMsg = reversedHistory[i + 1];
          if (
            nextMsg.role === "assistant" &&
            nextMsg.tool_calls &&
            nextMsg.tool_calls.length > 0
          ) {
            const calls = nextMsg.tool_calls;
            const myId = msg.tool_call_id;
            if (calls.some((c) => c.id === myId)) {
              group.push(nextMsg);
              groupTokens += this.estimateMessageTokens(nextMsg);
              i++;
            }
          }
        }
      }

      if (availableTokens >= groupTokens) {
        selectedReverse.push(...group);
        availableTokens -= groupTokens;
      } else {
        break;
      }
    }

    // 4. Assemble
    finalMessages.push(systemMessage);

    if (firstUserMsg) {
      finalMessages.push(firstUserMsg);
    }

    // Add selected recent messages (re-reverse to restore order)
    finalMessages.push(...selectedReverse.reverse());

    // 5. Sanitize: drop orphaned tool results whose assistant was dropped by the window
    const toolCallIdsInPrompt = new Set<string>();
    for (const msg of finalMessages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) toolCallIdsInPrompt.add(tc.id);
      }
    }

    const toolResultIdsInPrompt = new Set<string>();
    for (const msg of finalMessages) {
      if (msg.role === "tool" && msg.tool_call_id) {
        toolResultIdsInPrompt.add(msg.tool_call_id);
      }
    }

    const sanitized = finalMessages.filter(msg => {
      // Drop tool results without a matching assistant tool_call
      if (msg.role === "tool" && msg.tool_call_id) {
        return toolCallIdsInPrompt.has(msg.tool_call_id);
      }
      return true;
    }).map(msg => {
      // Strip tool_calls from assistant if ANY result is missing
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const allResultsPresent = msg.tool_calls.every(tc => toolResultIdsInPrompt.has(tc.id));
        if (!allResultsPresent) {
          return { ...msg, tool_calls: undefined };
        }
      }
      return msg;
    });

    return sanitized;
  }

  private estimateMessageTokens(message: LLMMessage): number {
    let text = "";
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") text += part.text;
        else if (part.type === "image_url") text += " ".repeat(340); // ~85 tokens at 4 chars/token
      }
    } else {
      text = message.content || "";
    }
    if (message.tool_calls) {
      text += JSON.stringify(message.tool_calls);
    }
    // Metadata overhead
    text += `role:${message.role}`;
    if (message.name) text += message.name;
    if (message.tool_call_id) text += message.tool_call_id;

    return Math.ceil(text.length / 4);
  }

  private constructSystemMessage(): LLMMessage {
    let content = SYSTEM_PROMPT_TEMPLATE;

    if (this.snapshot) {
      content = content.replace("{{title}}", this.snapshot.title || "Unknown");
      content = content.replace("{{url}}", this.snapshot.url || "Unknown");

      // Scroll position indicator
      if (this.snapshot.scroll) {
        const { y, maxY } = this.snapshot.scroll;
        const pct = maxY > 0 ? Math.round((y / maxY) * 100) : 0;
        const moreBelow = y < maxY - 10;
        const moreAbove = y > 10;

        let indicator = `Scroll: ${y}/${maxY}px (${pct}% down)`;
        if (moreBelow) indicator += " — more content below";
        if (moreAbove && !moreBelow) indicator += " — at bottom of page";
        if (!moreAbove && !moreBelow) indicator += " — all content visible";

        content = content.replace("{{scrollIndicator}}", indicator);
      } else {
        content = content.replace("{{scrollIndicator}}", "");
      }

      // Format elements with progressive compression
      const level = this.getCompressionLevel();
      const elementsList = this.formatElementsWithCompression(
        this.snapshot.elements,
        level,
      );
      content = content.replace(
        "{{elements}}",
        elementsList || "No interactive elements found.",
      );

      // Viewport text — dynamic with compression level
      let viewportText = this.snapshot.viewportText || "No text content.";
      if (level === CompressionLevel.HEAVY) {
        viewportText = ""; // Remove in heavy compression
      } else if (level === CompressionLevel.MEDIUM) {
        viewportText = viewportText.slice(0, 2000);
      } else if (level === CompressionLevel.LIGHT) {
        viewportText = viewportText.slice(0, 3000);
      }
      content = content.replace("{{viewportText}}", viewportText);
      content = content.replace("{{planStatus}}", this.formatPlanStatus());
    } else {
      content = content.replace("{{title}}", "No page loaded");
      content = content.replace("{{url}}", "about:blank");
      content = content.replace("{{scrollIndicator}}", "");
      content = content.replace("{{elements}}", "");
      content = content.replace("{{viewportText}}", "");
      content = content.replace("{{planStatus}}", this.formatPlanStatus());
    }

    return {
      role: "system",
      content: content,
    };
  }

  /**
   * Get context metrics from an already-computed prompt array.
   * Avoids double-computing the prompt when the caller already has it.
   */
  public getPromptMetricsFrom(prompt: LLMMessage[]): ContextMetrics {
    const systemTokens =
      prompt.length > 0 ? this.estimateMessageTokens(prompt[0]) : 0;
    const historyTokens = prompt
      .slice(1)
      .reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);

    return {
      systemTokens,
      historyTokens,
      totalTokens: systemTokens + historyTokens,
      maxTokens: this.maxContextTokens,
      utilization: (systemTokens + historyTokens) / this.maxContextTokens,
      elementCount: this.snapshot?.elements.length || 0,
      compressionLevel: this.getCompressionLevel(),
    };
  }

  /**
   * Get current context budget metrics for telemetry.
   * Uses getPrompt() result which already includes compression.
   */
  public getPromptMetrics(): ContextMetrics {
    return this.getPromptMetricsFrom(this.getPrompt());
  }

  /**
   * Determine compression level based on estimated snapshot size.
   * Uses a lightweight estimate to avoid circular dependency with constructSystemMessage().
   */
  public getCompressionLevel(): CompressionLevel {
    if (!this.snapshot) return CompressionLevel.NONE;

    // Estimate tokens from elements + viewport text without building the full message
    const elemTokens = this.snapshot.elements.reduce((sum, el) => {
      // Compact format estimate: [N] tagName#id attrs "text" (role)
      const hasId = el.attributes.id ? `#${el.attributes.id}` : "";
      const otherAttrs = Object.entries(el.attributes)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const role = el.role && el.role !== el.tagName ? ` (${el.role})` : "";
      const line = `[${el.tag}] ${el.tagName}${hasId} ${otherAttrs} "${el.text}"${role}`;
      return sum + Math.ceil(line.length / 4);
    }, 0);
    const textTokens = Math.ceil(
      (this.snapshot.viewportText || "").length / 4,
    );
    const planTokens = this.planStatus
      ? Math.ceil(this.formatPlanStatus().length / 4)
      : 0;
    const baseTokens = 550 + planTokens; // ~fixed template overhead + active plan section
    const historyTokens = this.history.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg),
      0,
    );

    const totalEstimate =
      baseTokens + elemTokens + textTokens + historyTokens;
    const utilization = totalEstimate / this.maxContextTokens;

    if (utilization < 0.5) return CompressionLevel.NONE;
    if (utilization < 0.7) return CompressionLevel.LIGHT;
    if (utilization < 0.85) return CompressionLevel.MEDIUM;
    return CompressionLevel.HEAVY;
  }

  /**
   * Apply compression to elements based on current level.
   * Returns a formatted element list string.
   */
  private formatElementsWithCompression(
    elements: TaggedElement[],
    level: CompressionLevel,
  ): string {
    let processed = elements;

    if (level === CompressionLevel.HEAVY) {
      // Keep only top 10 by navigation relevance
      processed = this.selectRelevantElements(elements, 10);
    }

    return processed
      .map((el) => {
        let text = el.text;
        let attrFilter: ((k: string) => boolean) | null = null;

        switch (level) {
          case CompressionLevel.NONE:
            break;
          case CompressionLevel.LIGHT:
            text = text.slice(0, 40);
            break;
          case CompressionLevel.MEDIUM:
            attrFilter = (k) => ["id", "role", "type", "href", "label", "description"].includes(k);
            text = text.slice(0, 20);
            break;
          case CompressionLevel.HEAVY:
            attrFilter = (k) => ["role", "type", "description"].includes(k);
            text = text.slice(0, 15);
            break;
        }

        return this.formatElementCompact(el, text, attrFilter);
      })
      .join("\n");
  }

  /**
   * Format a single element in compact notation.
   * [N] tagName#id key=val key="multi word" "text" (role)
   */
  private formatElementCompact(
    el: TaggedElement,
    text: string,
    attrFilter: ((k: string) => boolean) | null,
  ): string {
    // Build tag + id shorthand
    const idVal = el.attributes.id;
    const head = idVal ? `${el.tagName}#${idVal}` : el.tagName;

    // Build remaining attributes (skip 'id' since it's in the head)
    const attrParts: string[] = [];
    for (const [k, v] of Object.entries(el.attributes)) {
      if (k === "id") continue;
      if (attrFilter && !attrFilter(k)) continue;
      // Quote only when value contains spaces
      attrParts.push(v.includes(" ") ? `${k}="${v}"` : `${k}=${v}`);
    }

    // Role: only show when different from tagName
    const role =
      el.role && el.role !== el.tagName ? ` (${el.role})` : "";
    const disabled = el.isDisabled ? " [disabled]" : "";
    const attrs = attrParts.length > 0 ? " " + attrParts.join(" ") : "";

    return `[${el.tag}] ${head}${attrs} "${text}"${role}${disabled}`;
  }

  /**
   * Select most relevant elements for heavy compression.
   * Prioritizes submit buttons, inputs, and navigation links.
   */
  private selectRelevantElements(
    elements: TaggedElement[],
    limit: number,
  ): TaggedElement[] {
    const scored = elements.map((el) => ({
      el,
      score: this.scoreElementRelevance(el),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.el);
  }

  private scoreElementRelevance(el: TaggedElement): number {
    let score = 0;
    if (/submit|login|sign|search|next|continue/i.test(el.text)) score += 3;
    if (["input", "textarea", "select"].includes(el.tagName)) score += 2;
    if (el.tagName === "a" && el.attributes.href) score += 1;
    return score;
  }

  /**
   * Compress old tool call/result pairs into one-line summaries.
   * Preserves the last `preserveRecent` tool interactions verbatim.
   */
  private compressOldToolResults(preserveRecent: number = 2): void {
    let toolResultCount = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === "tool") {
        toolResultCount++;
      }
      if (toolResultCount > preserveRecent) {
        this.compressToolResultsBeforeIndex(i);
        break;
      }
    }
  }

  private compressToolResultsBeforeIndex(beforeIndex: number): void {
    const maxLen = 150;
    const snippetLen = 100;
    for (let i = 0; i <= beforeIndex; i++) {
      const msg = this.history[i];
      if (msg.role === "tool" && msg.content) {
        if (Array.isArray(msg.content)) {
          msg.content = "[screenshot truncated]";
        } else if (msg.content.length > maxLen) {
          const firstLine = msg.content.split("\n")[0].slice(0, snippetLen);
          msg.content = firstLine + " [truncated]";
        }
      }
    }
  }

  public async loadState() {
    try {
      const data = await chrome.storage.session.get("agent_context");
      if (data.agent_context) {
        this.history = data.agent_context.history || [];
        this.planStatus = data.agent_context.planStatus || null;
        logger.info("agent", "Context loaded from session storage", {
          historyLength: this.history.length,
          hasPlan: !!this.planStatus,
        });
      }
    } catch (e) {
      logger.warn("agent", "Failed to load context", { error: e });
    }
  }

  public async saveState() {
    try {
      await chrome.storage.session.set({
        agent_context: {
          history: this.history,
          planStatus: this.planStatus,
        },
      });
    } catch (e) {
      logger.warn("agent", "Failed to save context", { error: e });
    }
  }

  public clear() {
    this.history = [];
    this.snapshot = null;
    this.planStatus = null;
    this.saveState().catch(() => {});
  }

  /** Clear conversation history but keep the current DOM snapshot intact.
   *  Used between subtasks so page state carries over. */
  public clearHistory() {
    this.history = [];
    this.saveState().catch(() => {});
  }

  /**
   * Restore conversation history from a saved state (after navigation).
   */
  public restoreFromState(messages: LLMMessage[]) {
    this.history = [...messages];
    this.saveState().catch(() => {});
    logger.info("agent", "Context restored from navigation state", {
      historyLength: this.history.length,
    });
  }

  /**
   * Get current message history for state persistence.
   */
  public getMessages(): LLMMessage[] {
    return [...this.history];
  }
}
