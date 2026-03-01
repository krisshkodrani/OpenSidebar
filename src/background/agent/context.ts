import { LLMMessage } from "../llm/types";
import { DomSnapshot, TaggedElement } from "../../types";
import { logger } from "../../utils";
import { COMPRESSION_TRIGGERS } from "./constants";
import { sanitizeForPrompt } from "../security";
import { getPromptTemplate } from "../../prompts";

/**
 * Format a single element in compact notation.
 * [N] tagName#id key=val key="multi word" "text" (role) [position hint]
 *
 * Position hints (when viewportHeight is provided):
 * - No annotation: element is in the current viewport
 * - `^above`: element is above the viewport
 * - `v{N}px`: element is below the viewport by N pixels
 */
export function formatElementCompact(
  el: TaggedElement,
  text: string,
  attrFilter: ((k: string) => boolean) | null,
  viewportHeight?: number,
): string {
  const idVal = el.attributes.id;
  const head = idVal ? `${el.tagName}#${idVal}` : el.tagName;

  const attrParts: string[] = [];
  for (const [k, v] of Object.entries(el.attributes)) {
    if (k === "id") continue;
    if (attrFilter && !attrFilter(k)) continue;
    attrParts.push(v.includes(" ") ? `${k}="${v}"` : `${k}=${v}`);
  }

  const role = el.role && el.role !== el.tagName ? ` (${el.role})` : "";
  const disabled = el.isDisabled ? " [disabled]" : "";
  const attrs = attrParts.length > 0 ? " " + attrParts.join(" ") : "";

  // Flag elements where text color matches background color (invisible text)
  const textColor = el.attributes["text-color"];
  const bgColor = el.attributes["bg-color"];
  const invisible =
    textColor && bgColor && textColor === bgColor ? " [invisible-text]" : "";

  // Position hint: indicate if element is above or below the viewport
  let posHint = "";
  if (viewportHeight !== undefined && el.rect) {
    if (el.rect.y < 0) {
      posHint = " ^above";
    } else if (el.rect.y >= viewportHeight) {
      posHint = ` v${Math.round(el.rect.y - viewportHeight)}px`;
    }
  }

  return `[${el.tag}] ${head}${attrs} "${text}"${role}${disabled}${invisible}${posHint}`;
}

/**
 * Format all tagged elements from a snapshot into the compact text the agent sees.
 * Includes position hints when viewport height is available.
 */
export function formatSnapshotElements(
  elements: TaggedElement[],
  viewportHeight?: number,
): string {
  return elements
    .map((el) => formatElementCompact(el, el.text, null, viewportHeight))
    .join("\n");
}

/** Persona injected when the executor model is active (speed-optimised, action-biased). */
const EXECUTOR_PERSONA =
  "You are the execution model. Keep Think blocks to 2-3 lines. Prefer the most obvious action. Call one tool per turn unless batching independent fills. If an action fails twice, call escalate() instead of retrying.";

/** Persona injected when the planner model is active (reasoning-heavy, investigation-biased). */
const PLANNER_PERSONA =
  "You are the reasoning model, called when the executor model gets stuck. Before acting: (1) Analyze why previous attempts failed using the conversation history. (2) Use investigation tools (inspect_hidden, xray_page, execute_js, read_element) to gather missing information. (3) Formulate a strategy that differs from what was already tried. Make each turn count.";

/** Tools whose results carry reference data worth preserving longer in history compression. */
const REFERENCE_VALUE_TOOLS: ReadonlySet<string> = new Set([
  "inspect_hidden",
  "execute_js",
  "get_cookies",
  "search_history",
  "read_element",
  "recall_demo",
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

export interface PlanStatusGate {
  trigger: string;
  action: "call_done" | "advance_step";
  pattern?: string;
}

export interface PlanStatus {
  subtasks: {
    description: string;
    status: string;
    completedAtUrl?: string;
    result?: string;
    verificationGate?: PlanStatusGate;
    toolProfile?: string;
  }[];
  currentIndex: number;
}

// --- System prompt template ---
// IMPORTANT: Block ordering is designed for LLM prefix caching.
// Block 1 (static rules) MUST come first so the prefix is stable across turns.
// Do NOT move persona or dynamic content above the static rules.
const SYSTEM_PROMPT_TEMPLATE = getPromptTemplate("agent.system");

export class ContextManager {
  private history: LLMMessage[] = [];
  private snapshot: DomSnapshot | null = null;
  private maxHistory = 20;
  private maxContextTokens: number;
  private planStatus: PlanStatus | null = null;
  private demonstrations: string | null = null;
  private demoCatalog: string | null = null;
  private storageKey: string;
  private modelTier: "executor" | "planner" = "executor";
  private originalQuery: string | null = null;
  private pageInterpretation: string | null = null;
  private pageContent: string | null = null;

  public setModelTier(tier: "executor" | "planner"): void {
    this.modelTier = tier;
  }

  /** Pin the user's original query so it appears in every system prompt. */
  public setOriginalQuery(query: string): void {
    this.originalQuery = query;
  }

  /** Set the page interpretation from the perception layer. */
  public setPageInterpretation(interpretation: string | null): void {
    this.pageInterpretation = interpretation;
  }

  /** Inject a formatted demonstration into the system prompt context. */
  public setDemonstrations(demoText: string | null): void {
    this.demonstrations = demoText;
  }

  /** Set the compact demo catalog (one line per demo) for the system prompt prefix. */
  public setDemoCatalog(catalog: string | null): void {
    this.demoCatalog = catalog;
  }

  /** Dynamically adjust the context window size (e.g. expand on escalation). */
  public setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }

  /** Get the current max context token budget. */
  public getMaxContextTokens(): number {
    return this.maxContextTokens;
  }

  /** Get the total number of messages currently in conversation history. */
  public getHistoryLength(): number {
    return this.history.length;
  }

  constructor(
    maxContextTokens: number = 32000,
    workspaceId?: string | null,
    workerId?: string | null,
  ) {
    this.maxContextTokens = maxContextTokens;
    this.storageKey = workspaceId
      ? workerId
        ? `agent_context:${workspaceId}:${workerId}`
        : `agent_context:${workspaceId}`
      : "agent_context";
  }

  private capturedOverlays: string[] = [];
  /** Descriptions of nuisance popups auto-dismissed by perception triage */
  private triagedPopups: string[] = [];

  /** Record nuisance popups that were auto-dismissed by perception triage. */
  public addTriagedPopups(descriptions: string[]): void {
    this.triagedPopups.push(...descriptions);
    // Cap to prevent unbounded growth
    if (this.triagedPopups.length > 20) {
      this.triagedPopups = this.triagedPopups.slice(-20);
    }
  }

  public setPlanStatus(
    subtasks: {
      description: string;
      status: string;
      completedAtUrl?: string;
      result?: string;
      verificationGate?: PlanStatusGate;
      toolProfile?: string;
    }[],
    currentIndex: number,
  ): void {
    this.planStatus = { subtasks, currentIndex };
  }

  public clearPlanStatus(): void {
    this.planStatus = null;
  }

  /** Get the raw plan status (for verification gate access). */
  public getPlanStatusRaw(): PlanStatus | null {
    return this.planStatus;
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

    const formatDoneItem = (
      s: PlanStatus["subtasks"][number],
      i: number,
    ): string => {
      const url = s.completedAtUrl ? `(${urlPath(s.completedAtUrl)})` : "";
      const result = s.result ? ` → ${s.result.slice(0, 150)}` : "";
      return `${i + 1}-${s.description}${url}${result}`;
    };

    if (currentIndex >= total) {
      // All steps done — compact summary
      const doneList = subtasks.map(formatDoneItem).join(", ");
      return `## Plan [${total}/${total}] ALL DONE\nDone: ${doneList}\nCall done() now with a summary.`;
    }

    const currentDesc = subtasks[currentIndex]?.description || "Unknown";

    // Compact done list (only completed steps)
    const doneSteps = subtasks.slice(0, currentIndex);
    const doneList =
      doneSteps.length > 0 ? doneSteps.map(formatDoneItem).join(", ") : "";

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
    // Append verification gate for current subtask
    const currentSubtask = subtasks[currentIndex];
    if (currentSubtask?.verificationGate) {
      const gate = currentSubtask.verificationGate;
      const actionLabel =
        gate.action === "call_done" ? "call done()" : "advance to next step";
      block += `\nVERIFY: ${gate.trigger} → ${actionLabel}`;
    }

    block += `\nExecute now and mark this subtask complete when verified.`;
    return block;
  }

  public setSnapshot(snapshot: DomSnapshot) {
    this.snapshot = snapshot;
    this.pageContent = snapshot.pageContent ?? null;
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

    // Turn-count compression triggers
    const len = this.history.length;
    if (
      len === COMPRESSION_TRIGGERS.LIGHT_TURN_COUNT ||
      len === COMPRESSION_TRIGGERS.MEDIUM_TURN_COUNT ||
      len === COMPRESSION_TRIGGERS.HEAVY_TURN_COUNT ||
      (len > COMPRESSION_TRIGGERS.HEAVY_TURN_COUNT &&
        (len - COMPRESSION_TRIGGERS.HEAVY_TURN_COUNT) %
          COMPRESSION_TRIGGERS.HEAVY_RECOMPRESS_INTERVAL ===
          0)
    ) {
      const level = this.getCompressionLevel();
      this.compressHistoryByLevel(level);
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

    // Persona: executor vs planner model framing (placed after static rules for prefix caching)
    content = content.replace(
      "{{persona}}",
      `## Persona\n${this.modelTier === "planner" ? PLANNER_PERSONA : EXECUTOR_PERSONA}`,
    );

    // Multi-Step Planning: only include when a plan is active
    if (this.planStatus) {
      content = content.replace(
        "{{planInstructions}}",
        `## Multi-Step Planning
When an Active Plan is shown above:
1. Focus ONLY on the current step. Ignore future steps.
2. Execute the current step using the appropriate tool(s).
3. Verify the expected result is visible before proceeding.
4. Only call done() when ALL steps are completed.

Do NOT call done() until every planned step is complete.
`,
      );
    } else {
      content = content.replace("{{planInstructions}}", "");
    }

    // Inject demo catalog (compact list of available demonstrations, in static prefix)
    if (this.demoCatalog) {
      content = content.replace(
        "{{demoCatalog}}",
        `## Available Demonstrations\nUse recall_demo to retrieve step-by-step instructions for any of these:\n${this.demoCatalog}\n`,
      );
    } else {
      content = content.replace("{{demoCatalog}}", "");
    }

    // Inject demonstration context (if any)
    content = content.replace("{{demonstrations}}", this.demonstrations || "");

    // Pinned goal: keeps original query visible in every system prompt
    if (this.originalQuery) {
      content = content.replace(
        "## Page Context",
        `## Current Task\n${this.originalQuery}\nStay focused on this goal.\n\n## Page Context`,
      );
    }

    if (this.snapshot) {
      content = content.replace(
        "{{title}}",
        sanitizeForPrompt(this.snapshot.title || "Unknown"),
      );
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
      if (
        this.snapshot.overflow &&
        this.snapshot.overflow.total > this.snapshot.overflow.shown
      ) {
        const note = `Note: Showing ${this.snapshot.overflow.shown}/${this.snapshot.overflow.total} elements (${this.snapshot.overflow.collapsedGroups?.join(", ") || "similar elements collapsed"}).`;
        content = content.replace(
          "{{elements}}",
          (elementsList || "No interactive elements found.") + "\n" + note,
        );
      } else {
        content = content.replace(
          "{{elements}}",
          elementsList || "No interactive elements found.",
        );
      }

      // Page content: Readability Markdown or plain text fallback, with dynamic truncation
      const pageContentCharLimits: Record<CompressionLevel, number> = {
        [CompressionLevel.NONE]: 60000,
        [CompressionLevel.LIGHT]: 40000,
        [CompressionLevel.MEDIUM]: 20000,
        [CompressionLevel.HEAVY]: 8000,
      };
      if (this.pageContent) {
        const charLimit = pageContentCharLimits[level];
        let truncated = this.pageContent;
        if (truncated.length > charLimit) {
          truncated =
            truncated.slice(0, charLimit) +
            "\n\n[Content truncated — use scroll_page to see more]";
        }
        content = content.replace("{{pageContent}}", truncated);
      } else {
        content = content.replace(
          "{{pageContent}}",
          "No page content extracted.",
        );
      }

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
          "## Page Content",
          warnings + "\n\n## Page Content",
        );
      }

      // Perception triage: note auto-dismissed nuisance popups so LLM doesn't look for them
      if (this.triagedPopups.length > 0) {
        const note = `[Auto-dismissed: ${this.triagedPopups.join(", ")}]`;
        content = content.replace(
          "## Page Content",
          note + "\n\n## Page Content",
        );
      }

      // Archivist: surface text from persisted captured overlays
      if (this.capturedOverlays.length > 0) {
        const archived = this.capturedOverlays
          .map(
            (t, i) => `[Dismissed Overlay ${i + 1}]: ${sanitizeForPrompt(t)}`,
          )
          .join("\n\n");
        content = content.replace(
          "## Page Content",
          `## Dismissed Overlay Content\nThe following text was extracted from overlays/modals that were automatically dismissed during this session. Review for any important information.\n${archived}\n\n## Page Content`,
        );
      } else if (
        // Fallback for immediate snapshot if persistence hasn't caught up (rare)
        this.snapshot.capturedTexts &&
        this.snapshot.capturedTexts.length > 0
      ) {
        const archived = this.snapshot.capturedTexts
          .map((t, i) => `[Overlay ${i + 1}]: ${sanitizeForPrompt(t)}`)
          .join("\n\n");
        content = content.replace(
          "## Page Content",
          `## Dismissed Overlay Content\nThe following text was extracted from overlays/modals that were automatically dismissed. Review for any important information.\n${archived}\n\n## Page Content`,
        );
      }

      // Valid element IDs — helps LLM avoid hallucinating non-existent IDs
      if (this.snapshot.elements.length > 0) {
        const idList = this.snapshot.elements.map((e) => e.tag).join(",");
        content = content.replace(
          "## Page Interpretation",
          `Valid element IDs: [${idList}]\n\n## Page Interpretation`,
        );
      }

      // Page interpretation from the perception layer (replaces raw visibleContent)
      const interpretation =
        this.pageInterpretation ||
        "No visual interpretation available. Use element list above.";
      content = content.replace("{{pageInterpretation}}", interpretation);
      content = content.replace("{{planStatus}}", this.formatPlanStatus());
    } else {
      content = content.replace("{{title}}", "No page loaded");
      content = content.replace("{{url}}", "about:blank");
      content = content.replace("{{scrollIndicator}}", "");
      content = content.replace("{{elements}}", "");
      content = content.replace("{{pageContent}}", "");
      content = content.replace("{{pageInterpretation}}", "");
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

    // Turn-count override: guarantees compression regardless of context window size
    const historyLen = this.history.length;
    if (historyLen >= COMPRESSION_TRIGGERS.HEAVY_TURN_COUNT)
      return CompressionLevel.HEAVY;
    if (historyLen >= COMPRESSION_TRIGGERS.MEDIUM_TURN_COUNT)
      return CompressionLevel.MEDIUM;
    if (historyLen >= COMPRESSION_TRIGGERS.LIGHT_TURN_COUNT)
      return CompressionLevel.LIGHT;

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
    const perceptionTokens = this.pageInterpretation ? 200 : 0; // Perception output is compact (~150 tokens)
    const pageContentTokens = this.pageContent
      ? Math.ceil(Math.min(this.pageContent.length, 60000) / 4)
      : 0;
    const planTokens = this.planStatus
      ? Math.ceil(this.formatPlanStatus().length / 4)
      : 0;
    const baseTokens = (this.planStatus ? 550 : 420) + planTokens; // ~fixed template overhead (lower without planning section)
    const historyTokens = this.history.reduce(
      (sum, msg) => sum + this.estimateMessageTokens(msg),
      0,
    );

    const totalEstimate =
      baseTokens +
      elemTokens +
      perceptionTokens +
      pageContentTokens +
      historyTokens;
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
        const rawText =
          textLimit === Infinity ? el.text : el.text.slice(0, textLimit);
        return this.formatElementCompactLocal(
          el,
          sanitizeForPrompt(rawText),
          attrFilter,
        );
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
   * Format a single element in compact notation (delegates to module-level function).
   */
  private formatElementCompactLocal(
    el: TaggedElement,
    text: string,
    attrFilter: ((k: string) => boolean) | null,
  ): string {
    const vh = this.snapshot?.scroll?.viewportHeight;
    return formatElementCompact(el, text, attrFilter, vh);
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
        const isReferenceValue = toolName !== null && REFERENCE_VALUE_TOOLS.has(toolName);
        const maxLen = isReferenceValue ? DISCOVERY_MAX : ACTION_MAX;
        const snippetLen = isReferenceValue ? DISCOVERY_SNIPPET : ACTION_SNIPPET;

        if (typeof msg.content === "string" && msg.content.length > maxLen) {
          const firstLine = msg.content.split("\n")[0].slice(0, snippetLen);
          msg.content = firstLine + " [truncated]";
        }
      }
    }
  }

  /**
   * Apply aggressive compression to history based on compression level.
   * Called when crossing turn-count thresholds (30, 60, 100, and every 20 in HEAVY).
   */
  private compressHistoryByLevel(level: CompressionLevel): void {
    if (level === CompressionLevel.NONE) return;

    if (level === CompressionLevel.HEAVY) {
      // Distill everything except last HEAVY_KEEP_RECENT messages
      const keepRecent = COMPRESSION_TRIGGERS.HEAVY_KEEP_RECENT;
      if (this.history.length <= keepRecent + 2) return; // nothing to compress

      // Preserve first user message
      const firstUserIdx = this.history.findIndex((m) => m.role === "user");
      const firstUserMsg =
        firstUserIdx >= 0 ? this.history[firstUserIdx] : null;

      // Summarize old messages
      const oldMessages = this.history.slice(0, -keepRecent);
      const timeline = summarizeHistory(oldMessages, 30);
      const recentMessages = this.history.slice(-keepRecent);

      // Rebuild history
      this.history = [];
      if (firstUserMsg) {
        this.history.push(firstUserMsg);
      }
      if (timeline.length > 0) {
        this.history.push({
          role: "user",
          content: `[COMPRESSED HISTORY — ${timeline.length} actions]\n${timeline.join("\n")}`,
        });
      }
      this.history.push(...recentMessages);

      logger.info("agent", "HEAVY compression applied", {
        timelineEntries: timeline.length,
        newHistoryLength: this.history.length,
      });
      return;
    }

    // LIGHT and MEDIUM: truncate old tool results
    const limit =
      level === CompressionLevel.MEDIUM
        ? COMPRESSION_TRIGGERS.MEDIUM_TOOL_RESULT_LIMIT
        : COMPRESSION_TRIGGERS.LIGHT_TOOL_RESULT_LIMIT;
    const preserveRecent = 4; // keep last 4 tool results verbatim

    let toolResultCount = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === "tool") toolResultCount++;
      if (toolResultCount > preserveRecent) {
        // Truncate all tool results from index 0..i
        for (let j = 0; j <= i; j++) {
          const msg = this.history[j];
          if (msg.role === "tool" && typeof msg.content === "string") {
            if (msg.content.length > limit) {
              msg.content = msg.content.slice(0, limit) + " [compressed]";
            }
          }
        }
        break;
      }
    }

    // MEDIUM: also collapse runs of 3+ identical tool names into a summary
    if (level === CompressionLevel.MEDIUM) {
      this.collapseRepeatedToolRuns(3);
    }

    logger.info("agent", `${level.toUpperCase()} compression applied`, {
      historyLength: this.history.length,
      toolResultLimit: limit,
    });
  }

  /**
   * Collapse runs of N+ identical tool names in history into a single summary message.
   * Preserves the first and last in each run, replaces middle entries.
   */
  private collapseRepeatedToolRuns(minRunLength: number): void {
    // Find runs of assistant tool_calls with the same tool name
    let i = 0;
    while (i < this.history.length) {
      const msg = this.history[i];
      if (
        msg.role !== "assistant" ||
        !msg.tool_calls ||
        msg.tool_calls.length !== 1
      ) {
        i++;
        continue;
      }

      const toolName = msg.tool_calls[0].function.name;
      let runEnd = i;

      // Find consecutive assistant messages calling the same tool
      for (let j = i + 1; j < this.history.length; j++) {
        // Skip tool result messages (they pair with the assistant)
        if (this.history[j].role === "tool") continue;
        const next = this.history[j];
        if (
          next.role === "assistant" &&
          next.tool_calls?.length === 1 &&
          next.tool_calls[0].function.name === toolName
        ) {
          runEnd = j;
        } else {
          break;
        }
      }

      // Count distinct assistant messages in this run
      const runMessages: number[] = [];
      for (let j = i; j <= runEnd; j++) {
        if (
          this.history[j].role === "assistant" &&
          this.history[j].tool_calls
        ) {
          runMessages.push(j);
        }
      }

      if (runMessages.length >= minRunLength) {
        // Keep first and last, collapse middle
        const middleStart = runMessages[1];
        const middleEnd = runMessages[runMessages.length - 2];
        // Find the range including tool results
        const removeStart = middleStart;
        let removeEnd = middleEnd;
        // Extend removeEnd to include the tool result after the last collapsed assistant
        if (
          removeEnd + 1 < this.history.length &&
          this.history[removeEnd + 1].role === "tool"
        ) {
          removeEnd += 1;
        }
        const collapsedCount = runMessages.length - 2;

        // Collect compact results from collapsed tool calls (50 chars each, 200 chars cap)
        const resultSnippets: string[] = [];
        let totalLen = 0;
        for (let k = 1; k < runMessages.length - 1; k++) {
          const assistIdx = runMessages[k];
          const tcId = this.history[assistIdx]?.tool_calls?.[0]?.id;
          if (!tcId) continue;
          // Look for paired tool result right after
          for (
            let r = assistIdx + 1;
            r < this.history.length && r <= assistIdx + 2;
            r++
          ) {
            if (
              this.history[r].role === "tool" &&
              this.history[r].tool_call_id === tcId
            ) {
              const content =
                typeof this.history[r].content === "string"
                  ? (this.history[r].content ?? "").slice(0, 50)
                  : "[non-text]";
              if (totalLen + content.length <= 200) {
                resultSnippets.push(`"${content}"`);
                totalLen += content.length;
              }
              break;
            }
          }
        }

        const resultSuffix =
          resultSnippets.length > 0
            ? ` — results: ${resultSnippets.join(", ")}`
            : "";
        const summaryMsg: LLMMessage = {
          role: "user",
          content: `[${collapsedCount} collapsed ${toolName} calls${resultSuffix}]`,
        };
        this.history.splice(
          removeStart,
          removeEnd - removeStart + 1,
          summaryMsg,
        );
      }

      i = runEnd + 1;
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
    this.triagedPopups = [];
    this.pageInterpretation = null;
    this.pageContent = null;
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

  /**
   * Summarize the trajectory into a compact situation report for escalation.
   * Replaces verbose tool call/result pairs with a structured timeline,
   * dramatically reducing context size while preserving essential signal.
   *
   * After summarization, history contains: original query + distilled summary.
   * The current DOM snapshot is preserved (in system prompt, not history).
   */
  public summarizeTrajectory(originalQuery: string): void {
    const timeline = summarizeHistory(this.history);

    // Replace history with compact context
    this.history = [];
    this.history.push({ role: "user", content: originalQuery });

    if (timeline.length > 0) {
      const report = `ATTEMPT LOG (${timeline.length} actions):\n${timeline.join("\n")}`;
      this.history.push({ role: "user", content: report });
    }

    // Carry plan state into the escalated context
    if (this.planStatus) {
      const planBlock = this.formatPlanStatus();
      if (planBlock) {
        this.history.push({ role: "user", content: planBlock });
      }
    }

    this.saveState().catch(() => {});
    logger.info("agent", "Trajectory summarized for escalation", {
      timelineEntries: timeline.length,
      historyLength: this.history.length,
    });
  }

  /**
   * Rolling distillation: compress old history while keeping recent messages verbatim.
   * Returns true if distillation was applied, false if history is too short.
   */
  public rollingDistill(
    keepRecent: number,
    maxSummaryEntries: number,
  ): boolean {
    if (this.history.length <= keepRecent + 2) return false;

    // Preserve first user message
    const firstUserIdx = this.history.findIndex((m) => m.role === "user");
    const firstUserMsg = firstUserIdx >= 0 ? this.history[firstUserIdx] : null;

    // Summarize old messages (everything except the recent tail)
    const oldMessages = this.history.slice(0, -keepRecent);
    const timeline = summarizeHistory(oldMessages, maxSummaryEntries);
    const recentMessages = this.history.slice(-keepRecent);

    // Rebuild history
    this.history = [];
    if (firstUserMsg) {
      this.history.push(firstUserMsg);
    }
    if (timeline.length > 0) {
      this.history.push({
        role: "user",
        content: `[DISTILLED HISTORY — ${timeline.length} actions]\n${timeline.join("\n")}`,
      });
    }
    this.history.push(...recentMessages);

    this.saveState().catch(() => {});
    logger.info("agent", "Rolling distillation applied", {
      timelineEntries: timeline.length,
      newHistoryLength: this.history.length,
    });
    return true;
  }
}

/**
 * Shared utility: walk message history and extract a compact action→outcome timeline.
 * Used by both `summarizeTrajectory()` and `extractAttemptSummary()`.
 */
export function summarizeHistory(
  messages: LLMMessage[],
  maxEntries = 20,
): string[] {
  const entries: string[] = [];
  let turnNum = 0;

  // Walk forward to produce a chronological timeline
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      // Skip noise tools
      if (["wait"].includes(toolName)) continue;

      let argSnippet = "";
      try {
        const args = JSON.parse(tc.function.arguments);
        const parts: string[] = [];
        if (args.id != null) parts.push(`[${args.id}]`);
        if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
        if (args.url) parts.push(String(args.url).slice(0, 40));
        if (args.direction) parts.push(args.direction);
        if (args.summary) parts.push(`"${String(args.summary).slice(0, 30)}"`);
        if (args.reason) parts.push(`"${String(args.reason).slice(0, 30)}"`);
        argSnippet = parts.join(" ");
      } catch {
        /* */
      }

      // Find the corresponding tool result
      let outcome = "no result";
      let isFailure = false;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "tool" && messages[j].tool_call_id === tc.id) {
          const content =
            typeof messages[j].content === "string"
              ? (messages[j].content ?? "")
              : "";
          isFailure =
            content.startsWith("Error:") ||
            content.includes("Click intercepted") ||
            content.includes("No element with tag") ||
            content.includes("does not appear to be");
          outcome = content.split("\n")[0].slice(0, isFailure ? 160 : 80);
          break;
        }
      }

      turnNum++;
      entries.push(
        `${isFailure ? "\u26A0 " : ""}T${turnNum}: ${toolName} ${argSnippet} → ${outcome}`,
      );
      if (entries.length >= maxEntries) return entries;
    }
  }

  return entries;
}

/** Alias for backward compatibility */
export const summarizeCausalChain = summarizeHistory;
