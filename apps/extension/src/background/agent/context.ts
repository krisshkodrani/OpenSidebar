import { chromePersistencePort } from "../environment/chrome";
import { LLMMessage } from "../llm/types";
import { DomSnapshot, PageSkeletonNode, TaggedElement } from "../../types";
import { logger } from "../../utils";
import { AGENT_LIMITS, COMPRESSION_TRIGGERS } from "./constants";
import { sanitizeForPrompt } from "../security";
import { getPromptTemplate } from "../../prompts";
import {
  formatElementCompact,
  summarizeHistory,
  deduplicateInvisibleElements,
  compressRepetitiveContent,
} from "./context-formatting";
import {
  EXECUTOR_PERSONA,
  LastActionOutcome,
  PLANNER_PERSONA,
  REFERENCE_VALUE_TOOLS,
  CompressionLevel,
} from "./context-types";
import type {
  ContextMetrics,
  PlanStatus,
  PlanStatusGate,
} from "./context-types";
import type { CompressedHistory } from "./checkpoint-types";

// Re-export submodules for barrel compatibility
export * from "./context-types";
export * from "./context-formatting";

// --- System prompt template ---
// IMPORTANT: Block ordering is designed for LLM prefix caching.
// Block 1 (static rules) MUST come first so the prefix is stable across turns.
// Do NOT move persona or dynamic content above the static rules.
const SYSTEM_PROMPT_TEMPLATE = getPromptTemplate("agent.system");

/** Whitelist of action-relevant DOM attributes for NONE/LIGHT compression levels. */
const ACTION_RELEVANT_ATTRS = new Set([
  "type",
  "href",
  "placeholder",
  "value",
  "aria-label",
  "role",
  "name",
  "action",
  "method",
  "target",
  "alt",
  "title",
  "min",
  "max",
  "pattern",
  "required",
  "checked",
  "selected",
  "disabled",
  "readonly",
  "multiple",
  "accept",
  "label",
  "description",
]);

/** Format skeleton nodes into indented hierarchy for the agent system prompt. */
function formatPageSkeleton(skeleton: PageSkeletonNode[]): string {
  return skeleton
    .map((n) => {
      const indent = "  ".repeat(Math.min(n.depth, 4));
      return `${indent}${n.tagName}: "${n.text}"`;
    })
    .join("\n");
}

/**
 * If 3+ form controls are visible, return a hint telling the LLM
 * to batch independent field actions in a single response.
 */
function buildFormBatchHint(elements: TaggedElement[]): string | null {
  const formControlCount = elements.filter((el) => {
    const tagName = el.tagName.toLowerCase();
    const role = el.role?.toLowerCase();
    return (
      ["input", "textarea", "select"].includes(tagName) ||
      role === "textbox" ||
      role === "combobox" ||
      role === "searchbox" ||
      role === "checkbox" ||
      role === "radio"
    );
  }).length;

  if (formControlCount < 3) return null;

  return (
    "\n\n> **Batch hint:** This page has " +
    formControlCount +
    " form controls. " +
    "When independent fields are already mapped, call multiple type_text, select_option, and set_checkbox actions in the same response; they will execute within one turn. " +
    "Fill all visible requested fields at once. Do not click Next or Submit unless the user or the current plan step explicitly asks for it."
  );
}

export class ContextManager {
  private history: LLMMessage[] = [];
  private snapshot: DomSnapshot | null = null;
  private maxHistory = 20;
  private maxContextTokens: number;
  private planStatus: PlanStatus | null = null;
  private storageKey: string;
  private modelTier: "executor" | "planner" = "executor";
  /** Whether an optional Writer specialist is configured (enables compose_text steering). */
  private writerAvailable = false;
  private originalQuery: string | null = null;
  private pageInterpretation: string | null = null;
  /** Screenshot data URL for unified VL executor mode */
  private screenshotDataUrl: string | null = null;
  /** Magnified inspect_region crop staged for the executor's next prompt (LP-13). */
  private regionZoomShot: { dataUrl: string; label: string } | null = null;
  private pageContent: string | null = null;
  private isFirstTurn = true;
  private contradictionDetails: string | null = null;
  private turnCount = 0;
  private turnMax = 0;
  private startTimeMs = 0;
  private workingNotes = "";
  private lastActionOutcome: LastActionOutcome | null = null;

  public setModelTier(tier: "executor" | "planner"): void {
    this.modelTier = tier;
  }

  /** Enable compose_text steering when a dedicated Writer specialist is configured. */
  public setWriterAvailable(available: boolean): void {
    this.writerAvailable = available;
  }

  /** Pin the user's original query so it appears in every system prompt. */
  public setOriginalQuery(query: string): void {
    this.originalQuery = query;
  }

  /** Set the page interpretation from the perception layer. */
  public setPageInterpretation(interpretation: string | null): void {
    this.pageInterpretation = interpretation;
  }

  /** Set screenshot for unified VL executor mode (screenshot sent directly to executor). */
  public setScreenshotForExecutor(dataUrl: string | null): void {
    this.screenshotDataUrl = dataUrl;
  }

  /**
   * Stage (or clear) an inspect_region crop for the executor's next prompt.
   * Lives outside history like the screenshot: it survives intra-turn LLM
   * retries but never crosses the turn (cleared on perception refresh).
   */
  public setRegionZoomForExecutor(
    zoom: { dataUrl: string; label: string } | null,
  ): void {
    this.regionZoomShot = zoom;
  }

  /** Mark that the first turn is complete (grounding check only fires on turn 1). */
  public setFirstTurnDone(): void {
    this.isFirstTurn = false;
  }

  public getIsFirstTurn(): boolean {
    return this.isFirstTurn;
  }

  /** Store a detected instruction-vs-page contradiction for the grounding check. */
  public setContradiction(details: string | null): void {
    this.contradictionDetails = details;
  }

  /** Set time-awareness fields for the turn budget indicator. */
  public setTimeContext(
    turnCount: number,
    maxTurns: number,
    startTimeMs: number,
  ): void {
    this.turnCount = turnCount;
    this.turnMax = maxTurns;
    this.startTimeMs = startTimeMs;
  }

  /**
   * Return the current turn-budget urgency level.
   * Used by the agent loop to emit trace events when the level transitions.
   */
  public getBudgetUrgencyLevel(): "normal" | "low" | "critical" {
    if (this.turnMax <= 0) return "normal";
    const remaining = Math.max(0, this.turnMax - this.turnCount);
    if (remaining <= AGENT_LIMITS.CRITICAL_BUDGET_TURNS) return "critical";
    if (remaining <= AGENT_LIMITS.LOW_BUDGET_TURNS) return "low";
    return "normal";
  }

  /** Store the normalized outcome of the most recent DOM-affecting action. */
  public setLastActionOutcome(outcome: LastActionOutcome | null): void {
    this.lastActionOutcome = outcome;
  }

  /** Append a working note (ring-buffer, max 500 chars). */
  public appendWorkingNote(note: string): void {
    const trimmed = note.slice(0, 500);
    if (this.workingNotes) {
      this.workingNotes += "\n" + trimmed;
    } else {
      this.workingNotes = trimmed;
    }
    // Cap total at 500 chars
    if (this.workingNotes.length > 500) {
      this.workingNotes = this.workingNotes.slice(-500);
    }
  }

  /** Get the current working notes string. */
  public getWorkingNotes(): string {
    return this.workingNotes;
  }

  /** Replace working notes entirely (used for checkpoint restore). */
  public setWorkingNotes(notes: string): void {
    this.workingNotes = (notes || "").slice(-500);
  }

  /** Get the most recent action outcome. */
  public getLastActionOutcome(): LastActionOutcome | null {
    return this.lastActionOutcome;
  }

  // ---------------------------------------------------------------------------
  // Turn checkpoint export / restore
  // ---------------------------------------------------------------------------

  /**
   * Export compressed history for durable turn checkpoint.
   * Keeps the most recent `recentWindow` messages verbatim and summarizes
   * older messages into one-line entries via `summarizeHistory()`.
   */
  public exportForCheckpoint(recentWindow = 8): CompressedHistory {
    const recent = this.history.slice(-recentWindow);
    const older = this.history.slice(0, Math.max(0, this.history.length - recentWindow));
    const olderSummaries = summarizeHistory(older, 30);
    return {
      recentMessages: recent,
      olderSummaries,
      originalCount: this.history.length,
    };
  }

  /**
   * Restore history from a durable turn checkpoint.
   * Injects older summaries as a compact system message, then appends the
   * recent messages verbatim. This gives the LLM enough context to continue
   * without re-executing prior turns.
   */
  public restoreFromCheckpointHistory(
    cp: CompressedHistory,
    isFirstTurn: boolean,
  ): void {
    this.history = [];
    if (cp.olderSummaries.length > 0) {
      this.history.push({
        role: "system",
        content: `Prior turns (compressed, ${cp.originalCount - cp.recentMessages.length} messages):\n${cp.olderSummaries.join("\n")}`,
      });
    }
    this.history.push(...cp.recentMessages);
    this.isFirstTurn = isFirstTurn;
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
      status: "pending" | "running" | "completed" | "failed" | "skipped";
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
      const result = s.result ? ` → ${s.result.slice(0, 500)}` : "";
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

    let block = `## Plan [${currentIndex + 1}/${total}] "${currentDesc}"\n`;
    if (doneList) {
      block += `Done: ${doneList}\n`;
      block += `Do NOT revisit completed step URLs.\n`;
    }
    const remainingSteps = Math.max(total - currentIndex - 1, 0);
    if (remainingSteps > 0) {
      block += `Remaining after this step: ${remainingSteps}\n`;
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

    // VL executor mode: inject screenshot as a user message before recent history
    if (this.screenshotDataUrl) {
      const isFirstTurnOrUrlChange =
        this.isFirstTurn ||
        (this.snapshot?.url &&
          this.history.length > 0 &&
          !this.history.some(
            (m) =>
              typeof m.content === "string" &&
              m.content.includes(this.snapshot!.url),
          ));
      finalMessages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: this.screenshotDataUrl,
              detail: isFirstTurnOrUrlChange ? "high" : "low",
            },
          },
          { type: "text", text: "Current page screenshot." },
        ],
      });
    }

    // LP-13: magnified inspect_region crop — always high detail (a zoom at
    // low detail would defeat its purpose).
    if (this.regionZoomShot) {
      finalMessages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: this.regionZoomShot.dataUrl, detail: "high" },
          },
          {
            type: "text",
            text: `Magnified region ${this.regionZoomShot.label} from inspect_region. Read the fine text from this zoomed image; do not derive click coordinates from it.`,
          },
        ],
      });
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

    // Persona: executor vs planner model framing (in static prefix for caching)
    const personaBody = this.modelTier === "planner" ? PLANNER_PERSONA : EXECUTOR_PERSONA;
    const writerSteer = this.writerAvailable
      ? "\n\nA specialist Writer is available. For any free-text answer or prose — " +
        "job-application questions, essays, cover letters, message/email/comment bodies, " +
        "or any 'describe/explain/why' field — you MUST delegate via compose_text(id, instructions) " +
        "instead of writing it yourself with type_text. Type short structured values " +
        "(names, emails, dates, numbers, single options) directly. Never retype a field the Writer already filled."
      : "";
    content = content.replace(
      "{{persona}}",
      `## Persona\n${personaBody}${writerSteer}`,
    );

    // Remove demo catalog placeholder (demos removed)
    content = content.replace("{{demoCatalog}}", "");

    // Cache breakpoint marker: stripped from output, signals end of static prefix
    content = content.replace("{{cacheBreakpoint}}", "");

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

    // Remove demonstrations placeholder (demos removed)
    content = content.replace("{{demonstrations}}", "");

    // Inject working notes (if any)
    if (this.workingNotes) {
      content = content.replace(
        "{{workingNotes}}",
        `## Working Notes\n${this.workingNotes}\n`,
      );
    } else {
      content = content.replace("{{workingNotes}}", "");
    }

    // Pinned goal: keeps original query visible in every system prompt
    if (this.originalQuery) {
      content = content.replace(
        "## Page Context",
        `## Current Task\n${this.originalQuery}\nStay focused on this goal.\n\n## Page Context`,
      );
    }

    // Grounding check: first-turn only prompt injection
    if (this.isFirstTurn) {
      let groundingBlock = "## Grounding Check — First-Turn Protocol\n";
      if (this.contradictionDetails) {
        groundingBlock +=
          `⚠ CONTRADICTION DETECTED: ${this.contradictionDetails}\n` +
          "You MUST call clarify() to resolve this mismatch before taking any other action. Do NOT proceed with the instruction as given.\n\n";
      }
      groundingBlock +=
        "The current page snapshot (elements, content, scroll position) is already provided above — do NOT call read_page redundantly.\n" +
        "Observe the page state from the Visible Elements, Page Content, and Page Interpretation sections above.\n" +
        "Check Page Interpretation BLOCKERS for MISMATCH entries — if present, the page does not match your task.\n" +
        "Verify the page state matches your task before acting. Then proceed directly with the appropriate action tool.\n";
      content = content.replace(
        "## Page Context",
        `${groundingBlock}\n## Page Context`,
      );
    }

    if (this.snapshot) {
      content = content.replace(
        "{{title}}",
        sanitizeForPrompt(this.snapshot.title || "Unknown"),
      );
      content = content.replace("{{url}}", this.snapshot.url || "Unknown");

      // Language context — helps LLM ground element references in the correct language
      if (this.snapshot.lang) {
        content = content.replace(
          "{{langHint}}",
          `Language: ${this.snapshot.lang}${this.snapshot.dir === "rtl" ? " (RTL)" : ""}`,
        );
      } else {
        content = content.replace("{{langHint}}", "");
      }

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

      // Deduplicate invisible-text elements before formatting
      const level = this.getCompressionLevel();
      const { visible: visibleElements, groups: invisibleGroups } =
        deduplicateInvisibleElements(this.snapshot.elements);

      // Format elements with progressive compression
      const elementsList = this.formatElementsWithCompression(
        visibleElements,
        level,
      );
      const groupSuffix =
        invisibleGroups.length > 0 ? "\n" + invisibleGroups.join("\n") : "";

      // Page skeleton: prepend structural nodes at NONE/LIGHT compression only
      let skeletonBlock = "";
      if (
        this.snapshot.skeleton &&
        this.snapshot.skeleton.length > 0 &&
        (level === CompressionLevel.NONE || level === CompressionLevel.LIGHT)
      ) {
        skeletonBlock =
          "Page Structure:\n" +
          formatPageSkeleton(this.snapshot.skeleton) +
          "\n\n";
      }

      if (
        this.snapshot.overflow &&
        this.snapshot.overflow.total > this.snapshot.overflow.shown
      ) {
        const note = `Note: Showing ${this.snapshot.overflow.shown}/${this.snapshot.overflow.total} elements (${this.snapshot.overflow.collapsedGroups?.join(", ") || "similar elements collapsed"}).`;
        content = content.replace(
          "{{elements}}",
          skeletonBlock +
            (elementsList || "No interactive elements found.") +
            groupSuffix +
            "\n" +
            note,
        );
      } else {
        content = content.replace(
          "{{elements}}",
          skeletonBlock +
            (elementsList || "No interactive elements found.") +
            groupSuffix,
        );
      }

      // Batch hint for multi-field forms
      const batchHint = buildFormBatchHint(visibleElements);
      if (batchHint) {
        content = content.replace(
          "{{pageContent}}",
          batchHint + "\n\n{{pageContent}}",
        );
      }

      // Page content: Readability Markdown or plain text fallback, with dynamic truncation
      const pageContentCharLimits: Record<CompressionLevel, number> = {
        [CompressionLevel.NONE]: 30000,
        [CompressionLevel.LIGHT]: 20000,
        [CompressionLevel.MEDIUM]: 12000,
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
        if (!this.isFirstTurn) {
          truncated = compressRepetitiveContent(truncated);
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

      // Page interpretation: perception text, VL instructions, or fallback
      let interpretation: string;
      if (this.pageInterpretation) {
        interpretation = this.pageInterpretation;
      } else if (this.screenshotDataUrl) {
        // VL executor mode: screenshot is injected as image — give short instructions
        interpretation =
          "A screenshot of the current page is included above. Before acting:\n" +
          "1. ORIENT: What page is this? What state is it in?\n" +
          "2. VERIFY: Did your last action have the intended effect?\n" +
          "3. BLOCKERS: Any overlays, modals, errors, or loading states?\n" +
          "4. VISUAL-ONLY: Any prices, images, or text not in the element list?\n" +
          "Ground all actions in the [N] element tags from Visible Elements.";
      } else {
        interpretation =
          "No visual interpretation available. Use element list above.";
      }
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

    // Turn budget indicator (independent of snapshot)
    if (this.turnMax > 0 && this.startTimeMs > 0) {
      const elapsed = Math.round((Date.now() - this.startTimeMs) / 1000);
      const remaining = Math.max(0, this.turnMax - this.turnCount);
      const positionLine = `Turn ${this.turnCount}/${this.turnMax} | Elapsed: ${elapsed}s`;

      let budgetBlock: string;
      if (remaining <= AGENT_LIMITS.CRITICAL_BUDGET_TURNS) {
        budgetBlock =
          `\u{1F534} BUDGET CRITICAL — ${remaining} turn${remaining === 1 ? "" : "s"} remaining.\n` +
          `Call done() now if any progress was made, or escalate() to hand off. ` +
          `Do not start new actions.\n${positionLine}`;
      } else if (remaining <= AGENT_LIMITS.LOW_BUDGET_TURNS) {
        budgetBlock =
          `⚠️ LOW BUDGET — ${remaining} turns remaining.\n` +
          `Prioritize: complete the current step and call done(), or call escalate() if blocked. ` +
          `Avoid starting new sub-tasks or navigations.\n${positionLine}`;
      } else {
        budgetBlock = `${positionLine} | Budget: ${remaining} turns left`;
      }
      content = content.replace("{{turnBudget}}", budgetBlock);
    } else {
      content = content.replace("{{turnBudget}}", "");
    }

    content = content.replace(
      "{{lastActionOutcome}}",
      this.formatLastActionOutcome(),
    );

    return {
      role: "system",
      content: content,
    };
  }

  private formatLastActionOutcome(): string {
    if (!this.lastActionOutcome) return "No recent DOM-affecting action recorded.";

    const outcome = this.lastActionOutcome;
    const roundedDelta = Math.round(outcome.deltaPercent * 100);
    const effectSummary =
      roundedDelta === 0 && !outcome.urlChanged
        ? "No observable page change."
        : "Observable page change detected.";

    const signals = [
      `${roundedDelta}% DOM delta`,
      outcome.urlChanged ? "URL changed" : "same URL",
      `+${outcome.elementsAdded}`,
      `-${outcome.elementsRemoved}`,
    ].join(" | ");

    return `Tool: ${outcome.toolName}\nResult: ${effectSummary}\nSignals: ${signals}`;
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

  /** Numeric ordering for CompressionLevel — used by maxCompressionLevel(). */
  private static readonly COMPRESSION_ORDER: Record<CompressionLevel, number> =
    {
      [CompressionLevel.NONE]: 0,
      [CompressionLevel.LIGHT]: 1,
      [CompressionLevel.MEDIUM]: 2,
      [CompressionLevel.HEAVY]: 3,
    };

  /** Return the higher (more aggressive) of two compression levels. */
  private static maxCompressionLevel(
    a: CompressionLevel,
    b: CompressionLevel,
  ): CompressionLevel {
    return ContextManager.COMPRESSION_ORDER[a] >=
      ContextManager.COMPRESSION_ORDER[b]
      ? a
      : b;
  }

  /**
   * Compute the compression level for this turn.
   *
   * Two independent signals are computed and the higher (more aggressive)
   * level wins:
   *   - Turn-count level: a hard floor based on history length — guarantees
   *     compression grows as the conversation ages, regardless of page size.
   *   - Utilization level: token-estimate based — catches large pages early
   *     (e.g. a 90 KB page on turn 3 reaches 70% utilisation → LIGHT).
   *
   * Uses a lightweight estimate to avoid circular dependency with constructSystemMessage().
   */
  public getCompressionLevel(): CompressionLevel {
    if (!this.snapshot) return CompressionLevel.NONE;

    // Turn-count level: floor based on conversation length
    const historyLen = this.history.length;
    let turnLevel: CompressionLevel;
    if (historyLen >= COMPRESSION_TRIGGERS.HEAVY_TURN_COUNT) {
      turnLevel = CompressionLevel.HEAVY;
    } else if (historyLen >= COMPRESSION_TRIGGERS.MEDIUM_TURN_COUNT) {
      turnLevel = CompressionLevel.MEDIUM;
    } else if (historyLen >= COMPRESSION_TRIGGERS.LIGHT_TURN_COUNT) {
      turnLevel = CompressionLevel.LIGHT;
    } else {
      turnLevel = CompressionLevel.NONE;
    }

    // Utilization level: estimate tokens from elements + viewport text without building the full message
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
    const perceptionTokens = this.pageInterpretation ? 250 : 0; // Perception output (~200 tokens + prior observations)
    const pageContentTokens = this.pageContent
      ? Math.ceil(Math.min(this.pageContent.length, 30000) / 4)
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

    let utilizationLevel: CompressionLevel;
    if (utilization < 0.5) {
      utilizationLevel = CompressionLevel.NONE;
    } else if (utilization < 0.7) {
      utilizationLevel = CompressionLevel.LIGHT;
    } else if (utilization < 0.85) {
      utilizationLevel = CompressionLevel.MEDIUM;
    } else {
      utilizationLevel = CompressionLevel.HEAVY;
    }

    // Return whichever signal demands more compression
    return ContextManager.maxCompressionLevel(turnLevel, utilizationLevel);
  }

  /** Maximum items shown per group before collapsing the rest into a summary. */
  private static readonly GROUP_COLLAPSE_THRESHOLD = 100;

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
    } else if (level === CompressionLevel.NONE && processed.length > 200) {
      // Hard cap at 200 elements at NONE — token savings from compact format offset the budget
      processed = this.selectRelevantElements(elements, 200);
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
          : level === CompressionLevel.LIGHT
            ? (k) => ACTION_RELEVANT_ATTRS.has(k)
            : null;

    // Categorize elements into semantic groups
    const groups = this.groupElementsByCategory(processed);
    const sections: string[] = [];

    for (const { label, items } of groups) {
      if (items.length === 0) continue;

      const formatted = items.map((el) => {
        const isTruncated =
          textLimit !== Infinity && el.text.length > textLimit;
        let rawText =
          textLimit === Infinity ? el.text : el.text.slice(0, textLimit);
        if (
          isTruncated &&
          (el.tagName === "textarea" || el.role === "textbox")
        ) {
          rawText += " [preview truncated; use read_element for exact value]";
        } else if (isTruncated) {
          rawText += " [truncated]";
        }
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
        const isReferenceValue =
          toolName !== null && REFERENCE_VALUE_TOOLS.has(toolName);
        const maxLen = isReferenceValue ? DISCOVERY_MAX : ACTION_MAX;
        const snippetLen = isReferenceValue
          ? DISCOVERY_SNIPPET
          : ACTION_SNIPPET;

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
      // Carry plan state through HEAVY compression (plan persistence)
      if (this.planStatus) {
        const planBlock = this.formatPlanStatus();
        if (planBlock) {
          this.history.push({ role: "user", content: planBlock });
        }
      }
      this.history.push(...recentMessages);

      logger.info("agent", "HEAVY compression applied", {
        timelineEntries: timeline.length,
        newHistoryLength: this.history.length,
        planPreserved: !!this.planStatus,
      });
      return;
    }

    // LIGHT and MEDIUM: observation masking on old tool results
    // Keep actions visible (agent remembers what it did), mask verbose output
    const preserveRecent = level === CompressionLevel.MEDIUM ? 3 : 4;

    let toolResultCount = 0;
    let turnNum = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === "tool") toolResultCount++;
      if (toolResultCount > preserveRecent) {
        // Mask all tool results from index 0..i with one-liner summaries
        for (let j = 0; j <= i; j++) {
          const msg = this.history[j];
          if (msg.role === "tool" && typeof msg.content === "string") {
            turnNum++;
            const toolName = this.findToolNameForResult(msg.tool_call_id);
            const firstLine = msg.content.split("\n")[0].slice(0, 100);
            const label = toolName ? `${toolName} → ${firstLine}` : firstLine;
            msg.content = `[T${turnNum}: ${label}]`;
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
      preserveRecent,
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
      const data = await chromePersistencePort.session.get(this.storageKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque persisted blob
      const saved = data[this.storageKey] as any;
      if (saved) {
        this.history = saved.history || [];
        this.planStatus = saved.planStatus || null;
        this.capturedOverlays = saved.capturedOverlays || [];
        this.lastActionOutcome = saved.lastActionOutcome || null;
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
      await chromePersistencePort.session.set({
        [this.storageKey]: {
          history: this.history,
          planStatus: this.planStatus,
          capturedOverlays: this.capturedOverlays,
          lastActionOutcome: this.lastActionOutcome,
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
    this.isFirstTurn = true;
    this.contradictionDetails = null;
    this.lastActionOutcome = null;
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
    // Carry plan state through rolling distillation (plan persistence)
    if (this.planStatus) {
      const planBlock = this.formatPlanStatus();
      if (planBlock) {
        this.history.push({ role: "user", content: planBlock });
      }
    }
    this.history.push(...recentMessages);

    this.saveState().catch(() => {});
    logger.info("agent", "Rolling distillation applied", {
      timelineEntries: timeline.length,
      newHistoryLength: this.history.length,
      planPreserved: !!this.planStatus,
    });
    return true;
  }
}

// summarizeHistory and summarizeCausalChain are re-exported from ./context-formatting
