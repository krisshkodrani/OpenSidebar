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

const SYSTEM_PROMPT_TEMPLATE = `
You are OpenSidebar, an autonomous browser agent.
You can interact with the web page using the provided tools.

## Instructions
1. Analyze the user request and the current page context.
2. If you need to browse, click, or type, use the appropriate tools.
3. If the user asks a question about the page, read the page content first.
4. **Memory**: You have a long-term memory.
    - Use 'memory_search' to recall user preferences, project details, or past conversations.
    - Use 'memory_add' to save important facts, preferences, or summaries for future use.
5. When you have completed the task or have a final answer, respond normally without tool calls.

## Workflow Tips
- **type_text** auto-focuses the target element. You do NOT need to click_element first.
- Use **pressEnter: true** with type_text to submit forms in one step instead of typing then clicking submit.
- If a click is intercepted by an overlay (cookie banner, modal), dismiss it with **hide_element** (preferred) or by clicking close/dismiss.
- **scroll_page** accepts an optional **id** to scroll within a container instead of the window.
- After navigation or clicking a link, call **read_page** to see updated page content.
- Elements are identified by their [N] tag. Use the exact integer from the Visible Elements list.
- Element attributes (type, name, placeholder, href) help you identify the right target.
- Use **press_key** for keyboard shortcuts or key-based challenges (e.g. pressing arrow keys, Enter, letters).
- Use **drag_and_drop** to drag a [draggable] element onto a drop target using their tag IDs.
- Use **draw_stroke** to draw on a canvas element — provide start and end coordinates relative to the canvas.

## Page Context
Title: {{title}}
URL: {{url}}
{{scrollIndicator}}

## Visible Elements
{{elements}}

## Viewport Text (Summary)
{{viewportText}}
`;

const SPEED_PROMPT_TEMPLATE = `
You are OpenSidebar, a speed-optimized autonomous browser agent.
Execute the user's request using tool calls as efficiently as possible.

RULES:
- ONLY emit tool calls. NEVER explain, ask questions, or output plain text.
- Emit MULTIPLE tool calls per turn when actions are independent (e.g. fill all form fields at once).
- type_text auto-focuses — do NOT click_element before typing.
- For forms: fill ALL fields in one turn. Use pressEnter:true on the LAST field OR click the submit button.
- If a click is intercepted (error says "covered by [N]"), use hide_element(N) to remove the overlay, then retry.
- If you see a modal/overlay/banner blocking the page, use hide_element on it immediately.
- scroll_page accepts optional id to scroll within a container instead of the window.
- press_key for keyboard shortcuts/events (e.g. "Enter", "ArrowDown", "Escape", letter keys).
- drag_and_drop with sourceId/targetId for draggable elements.
- draw_stroke on canvas with start/end coordinates (offsets from element top-left).
- select_option for <select> dropdowns — pass the visible option text.
- When done, call done with a summary.
- If stuck or unsure what the page looks like, call take_screenshot to see the visual layout.
- Page Text below contains current page content — do NOT call read_page unless you scrolled to a new position.

Title: {{title}}
URL: {{url}}
{{scrollIndicator}}

Elements:
{{elements}}

Page Text:
{{viewportText}}
`;

export class ContextManager {
  private history: LLMMessage[] = [];
  private snapshot: DomSnapshot | null = null;
  private maxHistory = 20;
  private maxContextTokens: number;
  private speedMode: boolean;

  constructor(maxContextTokens: number = 32000, speedMode: boolean = false) {
    this.maxContextTokens = maxContextTokens;
    this.speedMode = speedMode;
  }

  public setSnapshot(snapshot: DomSnapshot) {
    this.snapshot = snapshot;
  }

  public getCurrentUrl(): string {
    return this.snapshot?.url ?? "";
  }

  public addMessage(message: LLMMessage) {
    this.history.push(message);

    // Compress old tool results to save context budget
    if (message.role === "tool") {
      this.compressOldToolResults(this.speedMode ? 1 : 2);
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
        // Remove from history array so we don't duplicate processing (will re-add later if needed,
        // but actually we want to build from end, so let's just keep reference)
      } else {
        // Edge case: First message huge? Unlikely for initial prompt.
        // Just let sliding window handle it if it doesn't fit.
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

      // Grouping: If this is a tool result (role='tool'), verify if next (prev in time) is assistant with tool_calls
      if (msg.role === "tool") {
        // Look ahead in reversed array for the matching assistant message
        // The assistant message might be immediately next, or separated by other tool results (parallel calls)
        // Simple heuristic: If next is assistant with tool_calls, grab it too.

        // Check next message (i+1)
        if (i + 1 < reversedHistory.length) {
          const nextMsg = reversedHistory[i + 1];
          if (
            nextMsg.role === "assistant" &&
            nextMsg.tool_calls &&
            nextMsg.tool_calls.length > 0
          ) {
            // Check if this tool result belongs to one of the tool calls in nextMsg
            const calls = nextMsg.tool_calls;
            const myId = msg.tool_call_id;
            if (calls.some((c) => c.id === myId)) {
              // It's a match! Add to group.
              group.push(nextMsg);
              groupTokens += this.estimateMessageTokens(nextMsg);
              i++; // Skip next iteration since we consumed it
            }
          }
        }
      }
      // Conversely, if current is assistant with tool calls, we should have seen the results already (since we traverse reverse).
      // But if we selected results in previous iterations, they are already in selectedReverse.
      // If we encounter an assistant message with tool calls that hasn't been grouped with results (e.g. results were skipped or not found),
      // it's orphaned. A lonely tool call without result is invalid in many LLMs if it wasn't the last turn.
      // BUT: We are traversing from MOST RECENT.
      // SCENARIO:
      // [Assistant(call), Tool(result)] <- Most recent
      // Loop 1: msg=Tool(result). Next is Assistant(call). match! Group = [Tool, Assistant].
      // Loop 2: (skipped)
      //
      // SCENARIO: Parallel
      // [Assistant(call1, call2), Tool(result1), Tool(result2)]
      // Loop 1: msg=Tool(result2). Next is Tool(result1). Not assistant. Group=[Tool2].
      // Loop 2: msg=Tool(result1). Next is Assistant. match! Group=[Tool1, Assistant].
      // Problem: Assistant is added, but Tool2 is already added separately.
      // Result in prompt: [Assistant, Tool1] ... [Tool2] -> Order restored: [Assistant, Tool1, Tool2].
      // This works!

      // Caveat: If budget runs out between Tool2 and Tool1.
      // Loop 1: Tool2 fits. selectedReverse=[Tool2].
      // Loop 2: Tool1+Assistant fits?
      // If yes: selectedReverse=[Tool2, Tool1, Assistant]. Restore -> [Assistant, Tool1, Tool2]. Correct.
      // If no: Tool1+Assistant dropped. selectedReverse=[Tool2]. Restore -> [Tool2].
      // Orphaned result! Model sees: [System, User, ... Tool2]. Confusing but not fatal syntax error usually.
      // Better than Orphaned Call.

      if (availableTokens >= groupTokens) {
        selectedReverse.push(...group);
        availableTokens -= groupTokens;
      } else {
        // If the group doesn't fit, we stop.
        // This prevents partial groups at the boundary.
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

    return finalMessages;
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
    const template = this.speedMode ? SPEED_PROMPT_TEMPLATE : SYSTEM_PROMPT_TEMPLATE;
    let content = template;

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
      const level = this.speedMode ? CompressionLevel.LIGHT : this.getCompressionLevel();
      const elementsList = this.formatElementsWithCompression(
        this.snapshot.elements,
        level,
      );
      content = content.replace(
        "{{elements}}",
        elementsList || "No interactive elements found.",
      );

      // Viewport text
      if (this.speedMode) {
        // Speed mode: truncated viewport text so LLM can read task instructions
        const viewportText = (this.snapshot.viewportText || "").slice(0, 1500);
        content = content.replace("{{viewportText}}", viewportText);
      } else {
        let viewportText = this.snapshot.viewportText || "No text content.";
        if (level === CompressionLevel.HEAVY) {
          viewportText = ""; // Remove in heavy compression
        } else if (level === CompressionLevel.MEDIUM) {
          viewportText = viewportText.slice(0, 2000);
        } else if (level === CompressionLevel.LIGHT) {
          viewportText = viewportText.slice(0, 5000);
        }
        content = content.replace("{{viewportText}}", viewportText);
      }
    } else {
      content = content.replace("{{title}}", "No page loaded");
      content = content.replace("{{url}}", "about:blank");
      content = content.replace("{{scrollIndicator}}", "");
      content = content.replace("{{elements}}", "");
      content = content.replace("{{viewportText}}", "");
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
    const baseTokens = 350; // ~fixed template overhead
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
            attrFilter = (k) => ["id", "role", "type", "href"].includes(k);
            text = text.slice(0, 20);
            break;
          case CompressionLevel.HEAVY:
            attrFilter = (k) => ["role", "type"].includes(k);
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
    const maxLen = this.speedMode ? 80 : 150;
    const snippetLen = this.speedMode ? 60 : 100;
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
        // Snapshot might be too large/complex to persist effectively or stale,
        // but we can try if it's small. For now, let's skip snapshot persistence
        // to avoid quota issues and ensure fresh page reads.
        // this.snapshot = data.agent_context.snapshot || null;
        logger.info("agent", "Context loaded from session storage", {
          historyLength: this.history.length,
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
          // snapshot: this.snapshot
        },
      });
    } catch (e) {
      logger.warn("agent", "Failed to save context", { error: e });
    }
  }

  public clear() {
    this.history = [];
    this.snapshot = null;
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
