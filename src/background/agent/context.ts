import { LLMMessage } from "../llm/types";
import { DomSnapshot, TaggedElement } from "../../types";
import { logger } from "../../utils";

const FAST_PERSONA = `You are a sharp, resourceful web automation expert who thrives on solving problems efficiently. You move fast, think clearly, and always know which tool to reach for next.`;

const SMART_PERSONA = `You are a seasoned systems thinker with decades of experience debugging the web's trickiest edge cases. You take a step back, reason through root causes, and find solutions others miss.`;

/** Tools whose results carry reference data worth preserving longer in history. */
const DISCOVERY_TOOLS: ReadonlySet<string> = new Set([
  "inspect_hidden",
  "take_screenshot",
  "execute_js",
  "memory_search",
  "transcribe_audio",
  "get_cookies",
  "read_pdf",
  "search_history",
  "get_bookmarks",
  "read_element",
  "inspect_react",
  "inspect_react_tree",
]);

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
  subtasks: { description: string; status: string; completedAtUrl?: string }[];
  currentIndex: number;
}

// --- System prompt template ---
// IMPORTANT: Block ordering is designed for LLM prefix caching.
// Block 1 (static rules) MUST come first so the prefix is stable across turns.
// Do NOT move persona or dynamic content above the static rules.
const SYSTEM_PROMPT_TEMPLATE = `You are OpenSidebar, an autonomous browser agent.

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
- If a page returns 404 or "Page not found", do NOT keep trying. Navigate back or call done() explaining the page doesn't exist.
- Tag IDs ([N] in Visible Elements) are integers — use them in tool params like id, sourceId, targetId.
- Work autonomously — do not ask the user for permission between steps.

## Tool Tips
- type_text auto-focuses; pressEnter: true submits forms in one step.
- hide_element removes overlays/modals blocking interaction (rejects non-overlay elements).
- scroll_page with optional id for container scrolling.
- press_key for keyboard shortcuts or key-based inputs.
- drag_and_drop between [draggable] elements by tag ID.
- draw_stroke on canvas elements with start/end coordinates.
- select_option for <select> dropdowns — pass visible option text.
- take_screenshot when the page doesn't match expectations.
- Batch independent actions in one turn (e.g. fill all form fields).
- Memory: memory_search to recall, memory_add to save important facts.
- escalate when stuck on riddles, puzzles, math, or multi-step logic.
- Investigation: When stuck or content may be hidden/missing, use inspect_hidden, execute_js, or take_screenshot to gather evidence before retrying. Check get_cookies or execute_js for auth/session state.
- xray_page toggles a CSS override that forces ALL hidden elements visible (display:none, opacity:0, visibility:hidden). Use when inspect_hidden finds content you need to interact with. Call again to disable. Triggers a snapshot refresh so new elements get tagged.
- fast_forward accelerates all page timers (setTimeout/setInterval) to fire instantly. Use when content appears after a countdown or timed delay. Call again to restore normal timing.
- read_element reads attributes (href, src, value) cheaply — verify link targets before navigating.
- React: When React tools appear, inspect_react reads component state/props, react_set_input handles controlled inputs, inspect_react_tree shows the component hierarchy. Use wait_for_react after actions that trigger async state changes.
- Audio/video: You CANNOT hear or watch media directly. Use transcribe_audio to get a text transcript of spoken content. If transcription isn't available, try read_page or take_screenshot after clicking play — some challenges reveal text visually.

{{persona}}
{{planStatus}}
{{planInstructions}}
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
  private storageKey: string;
  private modelTier: "fast" | "smart" = "fast";

  public setModelTier(tier: "fast" | "smart"): void {
    this.modelTier = tier;
  }

  /** Dynamically adjust the context window size (e.g. expand on escalation). */
  public setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }

  /** Get the current max context token budget. */
  public getMaxContextTokens(): number {
    return this.maxContextTokens;
  }

  constructor(maxContextTokens: number = 32000, workspaceId?: string | null) {
    this.maxContextTokens = maxContextTokens;
    this.storageKey = workspaceId
      ? `agent_context:${workspaceId}`
      : "agent_context";
  }

  private capturedOverlays: string[] = [];

  public setPlanStatus(
    subtasks: {
      description: string;
      status: string;
      completedAtUrl?: string;
    }[],
    currentIndex: number,
  ): void {
    this.planStatus = { subtasks, currentIndex };
  }

  public clearPlanStatus(): void {
    this.planStatus = null;
  }

  private formatPlanStatus(): string {
    if (!this.planStatus) return "";
    const { subtasks, currentIndex } = this.planStatus;
    const total = subtasks.length;

    // Compact path extractor
    const urlPath = (url?: string): string => {
      if (!url) return "";
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    };

    if (currentIndex >= total) {
      // All steps done — compact summary
      const doneList = subtasks
        .map(
          (s, i) =>
            `${i + 1}-${s.description}${s.completedAtUrl ? `(${urlPath(s.completedAtUrl)})` : ""}`,
        )
        .join(", ");
      return `## Plan [${total}/${total}] ALL DONE\nDone: ${doneList}\nCall done() now with a summary.`;
    }

    const currentDesc = subtasks[currentIndex]?.description || "Unknown";

    // Compact done list (only completed steps)
    const doneSteps = subtasks.slice(0, currentIndex);
    const doneList =
      doneSteps.length > 0
        ? doneSteps
            .map(
              (s, i) =>
                `${i + 1}-${s.description}${s.completedAtUrl ? `(${urlPath(s.completedAtUrl)})` : ""}`,
            )
            .join(", ")
        : "";

    const nextStep =
      currentIndex + 1 < total ? subtasks[currentIndex + 1] : null;

    let block = `## Plan [${currentIndex + 1}/${total}] "${currentDesc}"\n`;
    if (doneList) {
      block += `Done: ${doneList}\n`;
      block += `Do NOT revisit completed step URLs.\n`;
    }
    if (nextStep) {
      block += `Next: ${currentIndex + 2}. ${nextStep.description}\n`;
    }
    block += `Execute now. Call update_plan() when done.`;
    return block;
  }

  public setSnapshot(snapshot: DomSnapshot) {
    this.snapshot = snapshot;
    if (snapshot.capturedTexts && snapshot.capturedTexts.length > 0) {
      // Append new texts, avoiding exact immediate duplicates if possible,
      // but simple append is safer for now to preserve history.
      // We limit to last 50 entries to avoid infinite growth.
      this.capturedOverlays.push(...snapshot.capturedTexts);
      if (this.capturedOverlays.length > 50) {
        this.capturedOverlays = this.capturedOverlays.slice(-50);
      }
      this.saveState().catch(() => {});
    }
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

  /**
   * Builds the LLM prompt with sliding window context management.
   *
   * Algorithm:
   * 1. Reserve output tokens (1000) for LLM response
   * 2. Always preserve the first user message (Goal Amnesia Prevention)
   * 3. Fill remaining budget with most recent messages from the end
   * 4. Group tool results with their corresponding assistant messages
   * 5. Sanitize: drop orphaned tool results whose assistant was dropped
   *
   * @returns Array of messages ready for LLM consumption
   */
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

    const sanitized = finalMessages
      .filter((msg) => {
        // Drop tool results without a matching assistant tool_call
        if (msg.role === "tool" && msg.tool_call_id) {
          return toolCallIdsInPrompt.has(msg.tool_call_id);
        }
        return true;
      })
      .map((msg) => {
        // Strip tool_calls from assistant if ANY result is missing
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const allResultsPresent = msg.tool_calls.every((tc) =>
            toolResultIdsInPrompt.has(tc.id),
          );
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

    // Persona: fast vs smart model framing (placed after static rules for prefix caching)
    content = content.replace(
      "{{persona}}",
      `## Persona\n${this.modelTier === "smart" ? SMART_PERSONA : FAST_PERSONA}`,
    );

    // Multi-Step Planning: only include when a plan is active
    if (this.planStatus) {
      content = content.replace(
        "{{planInstructions}}",
        `## Multi-Step Planning
When an Active Plan is shown above:
1. Focus ONLY on the current step. Ignore future steps.
2. Execute the current step using the appropriate tool(s).
3. When the step is done, call update_plan({subtasks, currentIndex: NEXT_INDEX, lastResult: "what you did"}).
   - currentIndex = the 0-based index of the NEXT step to execute.
   - lastResult = brief description of what you accomplished.
4. The system will confirm and show the next step. Then execute it.
5. Only call done() when ALL steps show as completed.

Do NOT call done() until every planned step is complete.
`,
      );
    } else {
      content = content.replace("{{planInstructions}}", "");
    }

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

      // Surviving overlay warnings (overlays that auto-dismissal couldn't remove)
      if (
        this.snapshot.survivingOverlays &&
        this.snapshot.survivingOverlays.length > 0
      ) {
        const warnings = this.snapshot.survivingOverlays
          .map(
            (o) =>
              `WARNING: Overlay [${o.tagId}] covers ${o.coveragePercent}% of viewport — use click_element or hide_element to dismiss.`,
          )
          .join("\n");
        content = content.replace(
          "## Viewport Text",
          warnings + "\n\n## Viewport Text",
        );
      }

      // Archivist: surface text from persisted captured overlays
      if (this.capturedOverlays.length > 0) {
        const archived = this.capturedOverlays
          .map((t, i) => `[Dismissed Overlay ${i + 1}]: ${t}`)
          .join("\n\n");
        content = content.replace(
          "## Viewport Text",
          `## Dismissed Overlay Content\nThe following text was extracted from overlays/modals that were automatically dismissed during this session. Review for any important information.\n${archived}\n\n## Viewport Text`,
        );
      } else if (
        // Fallback for immediate snapshot if persistence hasn't caught up (rare)
        this.snapshot.capturedTexts &&
        this.snapshot.capturedTexts.length > 0
      ) {
        const archived = this.snapshot.capturedTexts
          .map((t, i) => `[Overlay ${i + 1}]: ${t}`)
          .join("\n\n");
        content = content.replace(
          "## Viewport Text",
          `## Dismissed Overlay Content\nThe following text was extracted from overlays/modals that were automatically dismissed. Review for any important information.\n${archived}\n\n## Viewport Text`,
        );
      }

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
    const textTokens = Math.ceil((this.snapshot.viewportText || "").length / 4);
    const planTokens = this.planStatus
      ? Math.ceil(this.formatPlanStatus().length / 4)
      : 0;
    const baseTokens = (this.planStatus ? 550 : 420) + planTokens; // ~fixed template overhead (lower without planning section)
    const historyTokens = this.history.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg),
      0,
    );

    const totalEstimate = baseTokens + elemTokens + textTokens + historyTokens;
    const utilization = totalEstimate / this.maxContextTokens;

    if (utilization < 0.5) return CompressionLevel.NONE;
    if (utilization < 0.7) return CompressionLevel.LIGHT;
    if (utilization < 0.85) return CompressionLevel.MEDIUM;
    return CompressionLevel.HEAVY;
  }

  /** Maximum items shown per group before collapsing the rest into a summary. */
  private static readonly GROUP_COLLAPSE_THRESHOLD = 8;

  /**
   * Apply compression to elements based on current level.
   * Groups elements by semantic category (inputs, buttons, links, other)
   * and collapses excess items in large groups to reduce noise.
   */
  private formatElementsWithCompression(
    elements: TaggedElement[],
    level: CompressionLevel,
  ): string {
    let processed = elements;

    if (level === CompressionLevel.HEAVY) {
      // Keep only top 10 by navigation relevance
      processed = this.selectRelevantElements(elements, 10);
    } else if (level === CompressionLevel.NONE && processed.length > 60) {
      // Hard cap at 60 elements even at NONE to prevent pathological 3000+ token lists
      processed = this.selectRelevantElements(elements, 60);
    }

    // Determine text/attr compression per level
    const textLimit =
      level === CompressionLevel.HEAVY
        ? 15
        : level === CompressionLevel.MEDIUM
          ? 20
          : level === CompressionLevel.LIGHT
            ? 40
            : Infinity;
    const attrFilter: ((k: string) => boolean) | null =
      level === CompressionLevel.HEAVY
        ? (k) => ["role", "type", "description"].includes(k)
        : level === CompressionLevel.MEDIUM
          ? (k) =>
              ["id", "role", "type", "href", "label", "description"].includes(k)
          : null;

    // Categorize elements into semantic groups
    const groups = this.groupElementsByCategory(processed);
    const sections: string[] = [];

    for (const { label, items } of groups) {
      if (items.length === 0) continue;

      const formatted = items.map((el) => {
        const text =
          textLimit === Infinity ? el.text : el.text.slice(0, textLimit);
        return this.formatElementCompact(el, text, attrFilter);
      });

      // Collapse large groups: show first N items + summary of the rest
      const threshold = ContextManager.GROUP_COLLAPSE_THRESHOLD;
      if (items.length > threshold) {
        const shown = formatted.slice(0, threshold);
        const collapsed = items.slice(threshold);
        const sampleLabels = [
          ...new Set(collapsed.map((el) => el.text.slice(0, 20))),
        ].slice(0, 4);
        shown.push(
          `  ... and ${collapsed.length} more (${sampleLabels.join(", ")}, ...)`,
        );
        sections.push(`${label} (${items.length}):\n${shown.join("\n")}`);
      } else {
        sections.push(`${label} (${items.length}):\n${formatted.join("\n")}`);
      }
    }

    return sections.join("\n\n");
  }

  /**
   * Group elements into semantic categories for structured display.
   * Order: inputs/forms first (most actionable), then buttons, links, other.
   */
  private groupElementsByCategory(
    elements: TaggedElement[],
  ): { label: string; items: TaggedElement[] }[] {
    const inputs: TaggedElement[] = [];
    const buttons: TaggedElement[] = [];
    const links: TaggedElement[] = [];
    const other: TaggedElement[] = [];

    for (const el of elements) {
      if (
        ["input", "textarea", "select"].includes(el.tagName) ||
        el.role === "textbox" ||
        el.role === "combobox" ||
        el.role === "searchbox"
      ) {
        inputs.push(el);
      } else if (
        el.tagName === "button" ||
        el.role === "button" ||
        el.attributes.type === "submit" ||
        el.attributes.type === "button"
      ) {
        buttons.push(el);
      } else if (el.tagName === "a" || el.role === "link") {
        links.push(el);
      } else {
        other.push(el);
      }
    }

    return [
      { label: "Inputs & Forms", items: inputs },
      { label: "Buttons", items: buttons },
      { label: "Links & Navigation", items: links },
      { label: "Other", items: other },
    ];
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
    const role = el.role && el.role !== el.tagName ? ` (${el.role})` : "";
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

  private findToolNameForResult(toolCallId: string | undefined): string | null {
    if (!toolCallId) return null;
    for (let j = this.history.length - 1; j >= 0; j--) {
      const msg = this.history[j];
      if (msg.role === "assistant" && msg.tool_calls) {
        const tc = msg.tool_calls.find((c) => c.id === toolCallId);
        if (tc) return tc.function.name;
      }
    }
    return null;
  }

  private compressToolResultsBeforeIndex(beforeIndex: number): void {
    const ACTION_MAX = 150;
    const ACTION_SNIPPET = 100;
    const DISCOVERY_MAX = 500;
    const DISCOVERY_SNIPPET = 400;

    for (let i = 0; i <= beforeIndex; i++) {
      const msg = this.history[i];
      if (msg.role === "tool" && msg.content) {
        if (Array.isArray(msg.content)) {
          msg.content = "[screenshot truncated]";
          continue;
        }
        const toolName = this.findToolNameForResult(msg.tool_call_id);
        const isDiscovery = toolName !== null && DISCOVERY_TOOLS.has(toolName);
        const maxLen = isDiscovery ? DISCOVERY_MAX : ACTION_MAX;
        const snippetLen = isDiscovery ? DISCOVERY_SNIPPET : ACTION_SNIPPET;

        if (typeof msg.content === "string" && msg.content.length > maxLen) {
          const firstLine = msg.content.split("\n")[0].slice(0, snippetLen);
          msg.content = firstLine + " [truncated]";
        }
      }
    }
  }

  public async loadState() {
    try {
      const data = await chrome.storage.session.get(this.storageKey);
      if (data[this.storageKey]) {
        this.history = data[this.storageKey].history || [];
        this.planStatus = data[this.storageKey].planStatus || null;
        this.capturedOverlays = data[this.storageKey].capturedOverlays || [];
        logger.info("agent", "Context loaded from session storage", {
          historyLength: this.history.length,
          hasPlan: !!this.planStatus,
          storageKey: this.storageKey,
        });
      }
    } catch (e) {
      logger.warn("agent", "Failed to load context", { error: e });
    }
  }

  public async saveState() {
    try {
      await chrome.storage.session.set({
        [this.storageKey]: {
          history: this.history,
          planStatus: this.planStatus,
          capturedOverlays: this.capturedOverlays,
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
    this.capturedOverlays = [];
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
    // We don't overwrite capturedOverlays here because they should
    // persist independently or be loaded via loadState().
    // If we wanted to sync them from `savedState` (AgentLoopState),
    // we'd need to add them to AgentLoopState too.
    // For now, loadState() handles the session persistence, so we are good.
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
