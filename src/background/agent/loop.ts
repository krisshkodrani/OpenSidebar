import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  MessageSource,
  RuntimeMessage,
  SessionMetrics,
  SubtaskResult,
  SubtaskSummary,
  ToolCall,
  ToolName,
} from "../../types";
import { logger } from "../../utils";
import { LLMClient, MODEL_SMART, stripThinkTags } from "../llm";
import {
  toolRegistry,
  setVisionUsageCallback,
  setScreenshotCaptureCallback,
} from "../tools";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS } from "../tools/metadata";
import { classifyRisk } from "../security";
import { ContextManager } from "./context";
import { ProgressTracker } from "./progress";
import { recoverToolCallsFromText } from "./tool-recovery";
import { DomSnapshot } from "../../types";
import { CompletionResponse, LLMMessage, TokenUsage } from "../llm/types";
import { formatStepLabel } from "./step-labels";
import { PlanGuardian } from "./guardian";
import { TraceRecorder } from "./trace";
import {
  AGENT_LIMITS,
  TOOL_FAILURE_THRESHOLDS,
  BROADCAST_INTERVALS,
  LLM_CONFIG,
  STRING_LIMITS,
  TIMING,
  ESCALATION_LIMITS,
} from "./constants";

/** Nudge injected when LLM emits text instead of tool calls. */
const NUDGE_MESSAGE = `You responded with text but no tool call. Either:
- Call a tool to advance the task (read_page, click, type_text, scroll_page, etc.)
- If the user asked a question and you already know the answer, call done({"summary": "your answer"})
- If you need to see the page first, call read_page or take_screenshot
Follow the Think step: 1) What do I see? 2) What tool advances the task? 3) What should change?`;

/** Nudge injected when escalating to the smart model — orients it on the situation. */
const ESCALATION_NUDGE = `You are now the upgraded model, brought in because the previous model got stuck.
Review the conversation history and current page state. Then:
1. Identify what was attempted and why it failed.
2. Formulate a different strategy — do not repeat what already failed.
3. Call the appropriate tool to advance the task.
If the page state is unclear, start with read_page or take_screenshot.`;

/** Message injected during a strategy pivot — tells the agent what NOT to retry. */
const PIVOT_MESSAGE = (failureSummary: string) =>
  `STRATEGY PIVOT — Your previous approach is not working. Start fresh.

What was attempted (DO NOT retry these approaches):
${failureSummary}

Instructions:
1. Forget the details of previous attempts — they failed.
2. Re-read the user's task above.
3. Look at the current page state with fresh eyes (use read_page or take_screenshot).
4. Think from first principles: what is a COMPLETELY DIFFERENT way to accomplish this?
5. If the task seems impossible on this page, navigate elsewhere or call done() explaining why.`;

/**
 * Extract a compact summary of failed tool attempts from conversation history.
 * Walks backward through messages, collects tool calls + their results,
 * and aggregates repeated failures into a short summary.
 * No LLM call needed — purely programmatic.
 */
function extractFailedAttempts(messages: LLMMessage[]): string {
  const failures = new Map<string, { count: number; error: string }>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;

    const content = typeof msg.content === "string" ? msg.content : "";
    const isFail =
      content.startsWith("Error:") ||
      content.includes("does not appear to be") ||
      content.includes("No element with tag") ||
      content.includes("Click intercepted") ||
      content.includes("REJECTED");

    if (!isFail) continue;

    // Find the corresponding assistant tool_call
    const toolCallId = msg.tool_call_id;
    if (!toolCallId) continue;

    let toolName = "unknown";
    let argSnippet = "";
    for (let j = i - 1; j >= 0; j--) {
      const aMsg = messages[j];
      if (aMsg.role === "assistant" && aMsg.tool_calls) {
        const tc = aMsg.tool_calls.find((c) => c.id === toolCallId);
        if (tc) {
          toolName = tc.function.name;
          try {
            const args = JSON.parse(tc.function.arguments);
            // Build a compact arg summary
            const parts: string[] = [];
            if (args.id != null) parts.push(`[${args.id}]`);
            if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
            if (args.url) parts.push(String(args.url).slice(0, 40));
            if (args.direction) parts.push(args.direction);
            argSnippet = parts.join(" ");
          } catch { /* */ }
          break;
        }
      }
    }

    const key = `${toolName} ${argSnippet}`.trim();
    const errorSnippet = content.split("\n")[0].slice(0, 60);

    if (failures.has(key)) {
      const entry = failures.get(key)!;
      entry.count++;
    } else {
      failures.set(key, { count: 1, error: errorSnippet });
    }

    // Cap at ~10 unique failure types
    if (failures.size >= 10) break;
  }

  if (failures.size === 0) return "- No specific tool failures recorded.";

  const lines: string[] = [];
  for (const [key, { count, error }] of failures) {
    const times = count > 1 ? ` x${count}` : "";
    lines.push(`- ${key}${times} — ${error}`);
  }
  return lines.join("\n").slice(0, 500);
}

/** Result of a completed agent loop run */
export interface LoopResult {
  outcome: "completed" | "stopped" | "max_turns" | "error";
  turnCount: number;
  /** Summary from done() tool, or error message */
  summary: string;
  /** Session token/cost/time metrics */
  metrics?: SessionMetrics;
}

/**
 * AgentLoop - Main orchestrator for the autonomous browser agent
 *
 * Core responsibilities:
 * - Execute the Think → Act → Verify loop
 * - Handle tool execution (parallel/sequential)
 * - Manage plan decomposition via PlanGuardian
 * - Track progress and detect stuck states
 * - Emit status updates to the UI
 *
 * Key features:
 * - Circuit breakers for tool failure handling
 * - Pause/resume capability
 * - Session metrics tracking
 * - Model escalation on stuck
 */
export class AgentLoop {
  private llm: LLMClient;
  private context: ContextManager;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private statusHandler: (status: AgentStatus, detail: string) => void;
  private messageHandler: (text: string, toolCalls: ToolCall[]) => void;
  private stepHandler: (step: AgentStep, update: boolean) => void;
  private maxTurns: number;
  private showElementTags: boolean;
  private confirmPlan: boolean;
  private showSessionMetrics: boolean;
  private disabledTools: Set<ToolName>;

  /** Workspace ID for session isolation */
  public readonly workspaceId: string | null;

  /** Current turn count — exposed via getCurrentTurn() */
  private turnCount = 0;
  /** Original user query that started this loop */
  private originalQuery = "";
  /** Progress tracker — promoted from local to instance for external access */
  private progress = new ProgressTracker();
  /** Pending hint from the user, picked up on the next turn */
  private pendingHint: string | null = null;
  /** Pending screenshot thumbnail from take_screenshot, attached to step on completion */
  private pendingScreenshotUrl: string | null = null;
  /** Promise-based gate for pause/resume */
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null =
    null;

  /** Plan guardian — smart model for decomposition and done validation */
  private guardian: PlanGuardian;
  /** Number of times done() has been rejected by the guardian */
  private doneRejections = 0;

  /** Task planning state */
  private taskId: string | null = null;
  private planSubtasks: SubtaskSummary[] = [];
  private taskStartTime = 0;
  private urlHistory: string[] = [];

  /** Trace recorder for session capture */
  private traceRecorder: TraceRecorder | null = null;

  /** Off-domain navigation detection */
  private startingOrigin: string | null = null;
  private offDomainWarned = false;

  /** Accumulated session metrics */
  private metrics: SessionMetrics = AgentLoop.emptyMetrics();
  private sessionStartTime = 0;

  private static emptyMetrics(): SessionMetrics {
    return {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLlmTimeMs: 0,
      totalSessionTimeMs: 0,
      llmCallCount: 0,
      modelBreakdown: {},
    };
  }

  /** Accumulate usage from an LLM response */
  private recordUsage(response: CompletionResponse, llmMs: number): void {
    if (response.usage) {
      this.metrics.totalPromptTokens += response.usage.prompt_tokens;
      this.metrics.totalCompletionTokens += response.usage.completion_tokens;
      this.metrics.totalTokens += response.usage.total_tokens;
      if (response.usage.cost != null) {
        this.metrics.totalCost += response.usage.cost;
      }
    }
    this.metrics.totalLlmTimeMs += llmMs;
    this.metrics.llmCallCount += 1;

    const model = this.llm.getCurrentModel();
    if (!this.metrics.modelBreakdown[model]) {
      this.metrics.modelBreakdown[model] = {
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        calls: 0,
      };
    }
    const entry = this.metrics.modelBreakdown[model];
    entry.calls += 1;
    if (response.usage) {
      entry.promptTokens += response.usage.prompt_tokens;
      entry.completionTokens += response.usage.completion_tokens;
      if (response.usage.cost != null) {
        entry.cost += response.usage.cost;
      }
    }
  }

  /** Record usage from a vision API call */
  public recordVisionUsage(
    usage: TokenUsage,
    llmMs: number,
    model: string,
  ): void {
    this.metrics.totalPromptTokens += usage.prompt_tokens;
    this.metrics.totalCompletionTokens += usage.completion_tokens;
    this.metrics.totalTokens += usage.total_tokens;
    if (usage.cost != null) {
      this.metrics.totalCost += usage.cost;
    }
    this.metrics.totalLlmTimeMs += llmMs;
    this.metrics.llmCallCount += 1;

    if (!this.metrics.modelBreakdown[model]) {
      this.metrics.modelBreakdown[model] = {
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        calls: 0,
      };
    }
    const entry = this.metrics.modelBreakdown[model];
    entry.calls += 1;
    entry.promptTokens += usage.prompt_tokens;
    entry.completionTokens += usage.completion_tokens;
    if (usage.cost != null) {
      entry.cost += usage.cost;
    }
  }

  /** Get the current accumulated metrics snapshot */
  public getMetrics(): SessionMetrics {
    return {
      ...this.metrics,
      totalSessionTimeMs: Date.now() - this.sessionStartTime,
    };
  }

  /** Broadcast metrics to side panel (throttled) */
  private broadcastMetrics(): void {
    if (!this.showSessionMetrics) return;
    // Throttle: every N turns or on turn 1
    if (
      this.turnCount !== 1 &&
      this.turnCount % BROADCAST_INTERVALS.METRICS !== 0
    )
      return;

    this.metrics.totalSessionTimeMs = Date.now() - this.sessionStartTime;
    this.broadcast({
      type: "SESSION_METRICS",
      payload: { ...this.metrics },
    });
  }

  constructor(
    openRouterApiKey: string,
    groqApiKey: string | undefined,
    cerebrasApiKey: string | undefined,
    useGroqFast: boolean,
    callbacks: {
      onStatusUpdate: (status: AgentStatus, detail: string) => void;
      onMessage: (text: string, toolCalls: ToolCall[]) => void;
      onStep?: (step: AgentStep, update: boolean) => void;
    },
    options?: {
      maxContextTokens?: number;
      maxTurns?: number;
      showElementTags?: boolean;
      confirmPlan?: boolean;
      showSessionMetrics?: boolean;
      disabledTools?: Set<ToolName>;
      workspaceId?: string | null;
    },
  ) {
    this.confirmPlan = options?.confirmPlan ?? false;
    this.showSessionMetrics = options?.showSessionMetrics ?? false;
    this.disabledTools = options?.disabledTools ?? new Set<ToolName>();
    this.workspaceId = options?.workspaceId ?? null;
    this.llm = new LLMClient(openRouterApiKey, groqApiKey, cerebrasApiKey, useGroqFast);
    this.llm.setFailoverCallback((from, to) => {
      const names: Record<string, string> = {
        cerebras: "Cerebras", groq: "Groq", openrouter: "OpenRouter",
      };
      this.stepHandler({
        id: crypto.randomUUID(),
        type: "info",
        label: `Rate limited on ${names[from] ?? from} — switched to ${names[to] ?? to}`,
        status: "done",
        timestamp: Date.now(),
      }, false);
    });
    this.guardian = new PlanGuardian(openRouterApiKey);
    this.context = new ContextManager(options?.maxContextTokens, this.workspaceId);
    this.statusHandler = callbacks.onStatusUpdate;
    this.messageHandler = callbacks.onMessage;
    this.stepHandler = callbacks.onStep ?? (() => { });
    this.maxTurns = options?.maxTurns ?? AGENT_LIMITS.MAX_TURNS_DEFAULT;
    this.showElementTags = options?.showElementTags ?? false;
  }

  /**
   * Send a message to the side panel, automatically injecting workspaceId,
   * requestId, and source. Fire-and-forget (errors are silenced).
   */
  private broadcast(msg: Omit<RuntimeMessage, "requestId" | "source" | "workspaceId">): void {
    chrome.runtime
      .sendMessage({
        ...msg,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: this.workspaceId,
      } as RuntimeMessage)
      .catch(() => { });
  }

  /**
   * Starts the agent loop with a user query
   *
   * @param initialUserText - The user's request/task
   * @param tabId - Chrome tab ID to operate on
   * @param initialSnapshot - Optional initial DOM snapshot
   * @param options - Configuration options (clearHistory)
   * @returns LoopResult with outcome, turn count, summary, and metrics
   */
  public async start(
    initialUserText: string,
    tabId: number,
    initialSnapshot?: DomSnapshot,
    options?: { clearHistory?: boolean },
  ): Promise<LoopResult> {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.turnCount = 0;
    this.originalQuery = initialUserText;
    this.progress.reset();
    this.pendingHint = null;
    this.taskId = null;
    this.planSubtasks = [];
    this.taskStartTime = Date.now();
    this.urlHistory = [];
    this.doneRejections = 0;
    this.startingOrigin = null;
    this.offDomainWarned = false;
    this.metrics = AgentLoop.emptyMetrics();
    this.sessionStartTime = Date.now();
    this.traceRecorder = new TraceRecorder(crypto.randomUUID());
    this.traceRecorder.setSessionInfo(
      initialUserText,
      initialSnapshot?.url || "",
    );
    this.traceRecorder.setWorkspaceId(this.workspaceId);

    // Clear or restore context
    if (options?.clearHistory) {
      this.context.clear();
    } else {
      // Restore context from session storage to handle SW restarts
      await this.context.loadState();
    }

    if (initialSnapshot) {
      this.context.setSnapshot(initialSnapshot);
      // Track starting origin for off-domain navigation detection
      if (initialSnapshot.url) {
        try {
          this.startingOrigin = new URL(initialSnapshot.url).origin;
        } catch {
          /* */
        }
      }
    }

    // 2. Add User Message (with plan prefix when confirmPlan is enabled)
    const userContent = this.confirmPlan
      ? `Before executing, briefly outline your action plan as a numbered list. Then wait for my approval. After I approve, proceed with execution.\n\n${initialUserText}`
      : initialUserText;
    this.context.addMessage({
      role: "user",
      content: userContent,
    });

    // --- Guardian: decompose task into plan (task-agnostic) ---
    if (!this.confirmPlan) {
      try {
        this.stepHandler(
          {
            id: crypto.randomUUID(),
            type: "thinking",
            label: "Analyzing task scope...",
            status: "running",
            timestamp: Date.now(),
          },
          false,
        );

        const decomposition = await this.guardian.decompose(
          initialUserText,
          this.context.getSnapshot()?.title || "",
          this.context.getSnapshot()?.url || "",
          this.abortController!.signal,
        );

        if (decomposition) {
          this.taskId = crypto.randomUUID();
          this.taskStartTime = Date.now();
          this.planSubtasks = decomposition.subtasks.map((desc, i) => ({
            description: desc,
            status: i === 0 ? ("running" as const) : ("pending" as const),
            turnsUsed: 0,
            turnBudget: 0,
          }));

          // Inject plan status into system prompt (visible every turn)
          this.context.setPlanStatus(
            decomposition.subtasks.map((desc, i) => ({
              description: desc,
              status: i === 0 ? "running" : "pending",
            })),
            0,
          );

          this.context.addMessage({
            role: "user",
            content:
              `[Plan Guardian]: This is a multi-step task (${decomposition.subtasks.length} steps). Your plan:\n` +
              decomposition.subtasks
                .map((s, i) => `${i + 1}. ${s}`)
                .join("\n") +
              `\n\nExecute step 1 now. Call update_plan({subtasks, currentIndex, lastResult}) after each step to report progress. ` +
              `If the plan fails, you may REVISE it using update_plan() with a rationale. ` +
              `Do NOT call done() until ALL ${decomposition.subtasks.length} steps are complete.`,
          });

          this.broadcast({
            type: "TASK_PROGRESS",
            payload: {
              taskId: this.taskId,
              subtasks: this.planSubtasks,
              currentIndex: 0,
              totalTurnsUsed: 0,
            },
          });

          this.stepHandler(
            {
              id: crypto.randomUUID(),
              type: "info",
              label: `Plan: ${decomposition.subtasks.length} steps`,
              status: "done",
              timestamp: Date.now(),
            },
            false,
          );
        }
      } catch (err: any) {
        logger.warn("agent", "Guardian decompose error (non-fatal)", {
          error: err?.message,
        });
      }
    }

    this.statusHandler(AgentStatus.THINKING, "Analyzing...");

    // Register per-tab vision usage callback so screenshot tool can report token usage
    setVisionUsageCallback((usage, durationMs, model) => {
      this.recordVisionUsage(usage, durationMs, model);
    }, tabId);

    // Register per-tab screenshot capture callback for inline thumbnails
    setScreenshotCaptureCallback((thumbnailUrl) => {
      this.pendingScreenshotUrl = thumbnailUrl;
    }, tabId);

    // Register guardian usage callback for metrics tracking
    this.guardian.setUsageCallback((usage, llmMs) => {
      this.recordUsage(
        {
          role: "assistant",
          content: null,
          finish_reason: "stop",
          usage,
        } as CompletionResponse,
        llmMs,
      );
    });

    let result: LoopResult = {
      outcome: "completed",
      turnCount: 0,
      summary: "",
      metrics: undefined,
    };
    try {
      result = await this.loop(tabId);
    } catch (error: any) {
      if (error.name === "AbortError") {
        logger.info("agent", "Agent stopped by user");
        this.statusHandler(AgentStatus.IDLE, "Stopped");
        result = {
          outcome: "stopped",
          turnCount: this.turnCount,
          summary: "Stopped by user",
          metrics: this.getMetrics(),
        };
      } else {
        logger.error("agent", "Loop Error", { error });
        const errorMsg = `Agent stopped: ${error.message}. Send a follow-up message to retry.`;
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: errorMsg, done: false },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.ERROR, error.message);
        result = {
          outcome: "error",
          turnCount: this.turnCount,
          summary: error.message,
          metrics: this.getMetrics(),
        };
      }
    } finally {
      setVisionUsageCallback(null, tabId);
      setScreenshotCaptureCallback(null, tabId);
      this.isRunning = false;
      // Finalize trace recording (fire-and-forget)
      if (this.traceRecorder) {
        await this.traceRecorder.finalize(
          result.outcome,
          result.summary,
          result.turnCount,
          result.metrics ?? null,
        );
        this.traceRecorder = null;
      }
    }
    return result;
  }

  public stop() {
    // Resolve pause gate first so the loop can exit cleanly
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
    this.abortController?.abort();
    this.isRunning = false;
  }

  /** Queue a user hint to be picked up on the next turn */
  public injectHint(text: string): void {
    this.pendingHint = text;
  }

  /** Get the current turn number */
  public getCurrentTurn(): number {
    return this.turnCount;
  }

  /** Get the original user query that started this loop */
  public getOriginalQuery(): string {
    return this.originalQuery;
  }

  /** Get the progress tracker instance (for external queries) */
  public getProgressTracker(): ProgressTracker {
    return this.progress;
  }

  /** Pause the agent loop — blocks at the top of the next iteration */
  public pause(): void {
    if (!this.pauseGate) {
      let resolve: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      this.pauseGate = { promise, resolve: resolve! };
      this.statusHandler(AgentStatus.PAUSED, "Paused by user");
    }
  }

  /** Resume a paused agent loop */
  public resume(): void {
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
      this.statusHandler(AgentStatus.THINKING, "Resumed");
    }
  }

  /** Whether the loop is currently paused */
  public isPaused(): boolean {
    return this.pauseGate !== null;
  }

  /** Escalate to smart model when stuck. Switches both model and provider (Groq→OpenRouter). */
  private escalateModel(): void {
    this.llm.switchToSmart();
    this.context.setModelTier("smart");
    logger.info("agent", "Escalating to smart model", { model: MODEL_SMART, provider: "openrouter" });
  }

  /** De-escalate back to fast model when progress resumes after automatic escalation. */
  private deescalateModel(): void {
    this.llm.switchToFast();
    this.context.setModelTier("fast");
    logger.info("agent", "De-escalating to fast model");
  }

  /**
   * Strategy pivot: prune failing history, inject original query + failure summary,
   * refresh DOM snapshot, and reset progress tracking. Gives the agent a fresh
   * start without changing models.
   */
  private async strategyPivot(tabId: number): Promise<void> {
    // 1. Extract what was tried before clearing
    const failureSummary = extractFailedAttempts(this.context.getMessages());

    // 2. Clear history (keeps DOM snapshot)
    this.context.clearHistory();

    // 3. Re-inject original query
    this.context.addMessage({
      role: "user",
      content: this.originalQuery,
    });

    // 4. Inject pivot message with constraints
    this.context.addMessage({
      role: "user",
      content: PIVOT_MESSAGE(failureSummary),
    });

    // 5. Refresh DOM snapshot for current state
    await this.refreshSnapshotWithRetry(tabId, -1);

    // 6. Reset progress tracker so it can fire signals again
    this.progress.resetEscalation();

    // 7. User-visible feedback
    this.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: "Rethinking approach from scratch",
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );

    logger.info("agent", "Strategy pivot executed", {
      turn: this.turnCount,
      failureSummaryLen: failureSummary.length,
    });
    this.traceRecorder?.recordEvent("strategy_pivot", {
      turn: this.turnCount,
    });
  }

  /** Refresh DOM snapshot and update context. Returns element count or -1 on failure. */
  private async refreshSnapshot(tabId: number): Promise<number> {
    try {
      const snapResponse = await chrome.tabs.sendMessage(tabId, {
        type: "DOM_SNAPSHOT_REQUEST",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {
          includeText: true,
          refresh: true,
          showTags: this.showElementTags,
        },
      });
      if (snapResponse?.payload?.snapshot) {
        this.context.setSnapshot(snapResponse.payload.snapshot);
        return snapResponse.payload.snapshot.elements.length;
      }
    } catch {
      /* non-critical */
    }
    return -1;
  }

  /** Refresh snapshot with retry — used after model escalation where fresh context is critical. */
  private async refreshSnapshotWithRetry(
    tabId: number,
    prevCount: number,
  ): Promise<number> {
    let count = await this.refreshSnapshot(tabId);
    if (count >= 0) return count;
    // Retry once after a brief delay
    await new Promise((r) => setTimeout(r, TIMING.SNAPSHOT_RETRY_DELAY));
    count = await this.refreshSnapshot(tabId);
    if (count >= 0) return count;
    return prevCount; // Keep existing count if both attempts fail
  }

  /** Stream a message to side panel and break the loop (for circuit breaker exits) */
  private circuitBreakerExit(message: string): void {
    this.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: message, done: false },
    });
    this.broadcast({
      type: "STREAM_CHUNK",
      payload: { delta: "", done: true },
    });
    this.statusHandler(
      AgentStatus.IDLE,
      "Circuit breaker — send a follow-up to continue",
    );
  }

  /**
   * Check whether a navigate() target URL matches a completed plan step's URL.
   * Compares origin + pathname only (ignores query params and hash).
   * Returns a block message if matched, or null to allow navigation.
   */
  private checkNavigateGuard(targetUrl: string): string | null {
    if (this.planSubtasks.length === 0) return null;

    const completedWithUrls = this.planSubtasks
      .map((s, i) => ({ ...s, index: i }))
      .filter((s) => s.status === "completed" && s.completedAtUrl);

    if (completedWithUrls.length === 0) return null;

    let targetOriginPath: string;
    try {
      const u = new URL(targetUrl);
      targetOriginPath = u.origin + u.pathname;
    } catch {
      return null; // Unparseable URL — let it through
    }

    for (const step of completedWithUrls) {
      try {
        const u = new URL(step.completedAtUrl!);
        const stepOriginPath = u.origin + u.pathname;
        if (targetOriginPath === stepOriginPath) {
          return (
            `BLOCKED: Cannot navigate to "${targetUrl}" — matches completed step ${step.index + 1} ("${step.description}").\n` +
            `Navigating back would undo progress. Continue with the current step.\n` +
            `If re-visiting is genuinely needed, call update_plan() with a revised plan first.`
          );
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async loop(tabId: number): Promise<LoopResult> {
    let prevElementCount = -1; // Track element count for empty-page retry
    let consecutiveNudges = 0;
    let totalNudges = 0;
    let doneSummary = "";
    let wasStuck = false; // Track stuck state for "resolved" signal

    // Escalation/de-escalation state machine
    let onSmartModel = false;
    let voluntaryEscalation = false; // escalate tool → permanent, no de-escalation
    let escalationCycles = 0;
    let cooldownRemaining = 0;
    let pivotDone = false; // has text-only pivot fired?

    // Circuit breaker: consecutive all-fail turns
    let consecutiveAllFailTurns = 0;

    // Circuit breaker: same-tool repeat failure
    const toolFailCounts = new Map<string, number>();

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Pause gate — block here if user paused the loop
      if (this.pauseGate) await this.pauseGate.promise;
      if (!this.isRunning) break; // Check again after resume (user may have stopped)

      this.turnCount++;

      // Decrement de-escalation cooldown
      if (cooldownRemaining > 0) cooldownRemaining--;

      // Inject pending hint from user before LLM call
      if (this.pendingHint) {
        this.traceRecorder?.recordEvent("hint", { text: this.pendingHint });
        this.context.addMessage({
          role: "user",
          content: `[User hint]: ${this.pendingHint}`,
        });
        this.pendingHint = null;
      }

      // Broadcast turn progress to side panel (throttled)
      if (
        this.turnCount === 1 ||
        this.turnCount % BROADCAST_INTERVALS.TURN_PROGRESS === 0
      ) {
        this.broadcast({
          type: "AGENT_TURN",
          payload: {
            turn: this.turnCount,
            maxTurns: this.maxTurns,
            provider: this.llm.getActiveProviderInfo().providerId,
          },
        });
      }

      // 1. LLM Inference (streamed)
      const messages = this.context.getPrompt();
      const tools = toolRegistry.getDefinitions(this.disabledTools);

      // Log context metrics for telemetry (reuse already-computed prompt)
      const metrics = this.context.getPromptMetricsFrom(messages);
      if (prevElementCount < 0) prevElementCount = metrics.elementCount;
      logger.info("agent", "Context metrics", {
        turn: this.turnCount,
        systemTokens: metrics.systemTokens,
        historyTokens: metrics.historyTokens,
        totalTokens: metrics.totalTokens,
        utilization: Math.round(metrics.utilization * 100) + "%",
        elements: metrics.elementCount,
        compression: metrics.compressionLevel,
        toolCount: tools.length,
      });

      // Trace: start turn recording
      if (this.traceRecorder) {
        const snap = this.context.getSnapshot();
        this.traceRecorder.startTurn(
          this.turnCount,
          {
            url: snap?.url || "",
            title: snap?.title || "",
            elementCount: metrics.elementCount,
            viewportTextLength: snap?.viewportText?.length || 0,
            scrollY: snap?.scroll?.y || 0,
          },
          snap?.elements || [],
          metrics.systemTokens + metrics.historyTokens,
          tools.length,
          this.llm.getCurrentModel(),
          metrics.compressionLevel,
        );
      }

      const thinkingStepId = crypto.randomUUID();
      const thinkingStep: AgentStep = {
        id: thinkingStepId,
        type: "thinking",
        label: this.turnCount === 1 ? "Planning approach" : "Thinking...",
        status: "running",
        timestamp: Date.now(),
      };
      this.stepHandler(thinkingStep, false);

      // Always stream deltas to side panel
      const onTextDelta = (delta: string) => {
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta, done: false },
        });
      };

      const llmStart = Date.now();
      let response: CompletionResponse;
      try {
        response = await this.llm.completeStream(
          {
            messages,
            tools,
            max_tokens: LLM_CONFIG.MAX_TOKENS,
            stop: ["Observation:"], // ReAct pattern stop token just in case
            signal: this.abortController!.signal,
          },
          onTextDelta,
        );
      } catch (llmError: any) {
        if (llmError.name === "AbortError") throw llmError;
        if ((llmError as any).status === 402) {
          const msg = llmError.message;
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: msg, done: false },
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          this.statusHandler(AgentStatus.ERROR, "Insufficient credits");
          break;
        }
        throw llmError;
      }
      const llmMs = Date.now() - llmStart;

      // Accumulate token usage and broadcast metrics
      this.recordUsage(response, llmMs);
      this.broadcastMetrics();

      // Trace: record LLM response
      if (this.traceRecorder) {
        this.traceRecorder.recordLLMResponse(
          response.content,
          response.tool_calls || [],
          response.finish_reason,
          response.usage ?? null,
          llmMs,
        );
      }

      // Derive clean content (no <think> blocks) for logging and logic,
      // but keep raw content (with think blocks) in history for M2.5 reasoning chain continuity.
      const rawContent = response.content;
      const cleanContent = rawContent
        ? stripThinkTags(rawContent) || null
        : null;

      // Log LLM response summary for debugging
      const toolSummary =
        response.tool_calls?.map((tc) => {
          let argSnippet = "";
          try {
            argSnippet = tc.function.arguments.slice(
              0,
              STRING_LIMITS.TOOL_CALL_SNIPPET,
            );
          } catch {
            /* */
          }
          return `${tc.function.name}(${argSnippet})`;
        }) ?? [];
      logger.info("agent", "LLM response", {
        turn: this.turnCount,
        llmMs,
        url: this.context.getCurrentUrl(),
        text: cleanContent?.slice(0, STRING_LIMITS.REASONING_LOG) || null,
        toolCalls: toolSummary,
        toolCount: toolSummary.length,
      });

      // Full reasoning at DEBUG level (untruncated for performance analysis)
      if (cleanContent) {
        logger.debug("agent", "LLM reasoning (full)", {
          turn: this.turnCount,
          text: cleanContent,
        });
      }

      // Recover tool calls from text output (models sometimes emit JSON as text)
      if (
        (!response.tool_calls || response.tool_calls.length === 0) &&
        cleanContent
      ) {
        const recovered = recoverToolCallsFromText(cleanContent);
        if (recovered && recovered.length > 0) {
          logger.info("agent", "Recovered tool calls from text", {
            turn: this.turnCount,
            count: recovered.length,
            tools: recovered.map((tc) => tc.function.name),
          });
          response.tool_calls = recovered;
        }
      }

      const llmIntention =
        cleanContent?.slice(0, STRING_LIMITS.REASONING_LOG) || null;

      // 2. Add Assistant Message to History
      this.context.addMessage({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls
          ? response.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }))
          : undefined,
      });

      // Mark thinking step as done
      this.stepHandler(
        {
          ...thinkingStep,
          status: "done",
          durationMs: Date.now() - thinkingStep.timestamp,
        },
        true,
      );

      // 3. Handle Response
      if (response.tool_calls && response.tool_calls.length > 0) {
        // ACTION REQUIRED
        consecutiveNudges = 0;
        const firstToolName = response.tool_calls[0].function.name;
        this.statusHandler(AgentStatus.ACTING, `Executing ${firstToolName}...`);

        // Thought text already delivered via STREAM_CHUNK deltas
        // Signal stream end so sidepanel finalizes the message
        if (response.content) {
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
        }

        // Execute Tools
        let doneSignaled = false;
        let domModified = false;

        // Determine if we can parallelize: no sequential tools present
        const hasSequentialTool = response.tool_calls.some((tc) =>
          SEQUENTIAL_TOOLS.has(tc.function.name as ToolName),
        );
        const canParallelize =
          !hasSequentialTool && response.tool_calls.length > 1;

        if (canParallelize) {
          // PARALLEL EXECUTION
          const results = await Promise.all(
            response.tool_calls.map(async (toolCall) => {
              const toolName = toolCall.function.name as ToolName;
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch {
                // Registry will handle parse error on execute
              }

              const riskLevel = classifyRisk(toolName, args);

              const toolStep: AgentStep = {
                id: crypto.randomUUID(),
                type: "tool",
                label: formatStepLabel(toolName, args),
                detail: JSON.stringify(args),
                toolName,
                status: "running",
                timestamp: Date.now(),
              };
              this.stepHandler(toolStep, false);

              try {
                const result = await toolRegistry.execute(
                  toolCall,
                  tabId,
                  this.abortController!.signal,
                );
                const toolMs = Date.now() - toolStep.timestamp;
                this.stepHandler(
                  {
                    ...toolStep,
                    status: "done",
                    durationMs: toolMs,
                  },
                  true,
                );
                logger.info("tools", `${toolName} OK`, {
                  turn: this.turnCount,
                  tool: toolName,
                  risk: riskLevel,
                  mode: "parallel",
                  args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                  result: result.slice(0, STRING_LIMITS.RESULT_LOG),
                  durationMs: toolMs,
                  intention: llmIntention,
                });
                this.traceRecorder?.recordToolExecution(
                  toolCall.id, toolName, args, result, true, toolMs, riskLevel,
                );

                if (
                  DOM_MODIFYING_TOOLS.has(toolName) &&
                  !result.includes("Click intercepted")
                ) {
                  domModified = true;
                }

                return { toolCall, result, error: null };
              } catch (toolError: any) {
                if (toolError.name === "AbortError") throw toolError;
                const errorMsg = toolError.message || String(toolError);
                const toolMs = Date.now() - toolStep.timestamp;
                logger.error("tools", `${toolName} FAIL`, {
                  turn: this.turnCount,
                  tool: toolName,
                  risk: riskLevel,
                  mode: "parallel",
                  args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                  error: errorMsg,
                  durationMs: toolMs,
                  intention: llmIntention,
                });
                this.traceRecorder?.recordToolExecution(
                  toolCall.id, toolName, args, errorMsg, false, toolMs, riskLevel, errorMsg,
                );
                this.stepHandler(
                  {
                    ...toolStep,
                    status: "error",
                    durationMs: Date.now() - toolStep.timestamp,
                    errorMessage: errorMsg,
                  },
                  true,
                );
                return { toolCall, result: null, error: errorMsg };
              }
            }),
          );

          // Add all results to context
          for (const { toolCall, result, error } of results) {
            this.context.addMessage({
              role: "tool",
              tool_call_id: toolCall.id,
              content: error ? `Error: ${error}` : result!,
            });
          }
        } else {
          // SEQUENTIAL EXECUTION (has sequential tools or single tool)
          for (const toolCall of response.tool_calls) {
            if (!this.isRunning) break;

            // Parse args for risk classification and done detection
            const toolName = toolCall.function.name as ToolName;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch {
              // Registry will handle parse error on execute
            }

            // Risk classification (informational, non-blocking)
            const riskLevel = classifyRisk(toolName, args);

            // DONE tool — guardian-validated exit
            if (toolName === ToolName.DONE) {
              const summary = (args.summary as string) || "Task completed.";

              // Guardian validation: only when a plan exists
              if (this.taskId && this.planSubtasks.length > 0) {
                let shouldReject = false;
                let rejectReason = "";

                try {
                  this.stepHandler(
                    {
                      id: crypto.randomUUID(),
                      type: "thinking",
                      label: "Verifying completion...",
                      status: "running",
                      timestamp: Date.now(),
                    },
                    false,
                  );

                  const validation = await this.guardian.validateDone(
                    this.originalQuery,
                    this.planSubtasks,
                    summary,
                    this.context.getSnapshot()?.title || "",
                    this.context.getSnapshot()?.url || "",
                    this.abortController!.signal,
                  );

                  if (!validation.approved) {
                    shouldReject = true;
                    rejectReason =
                      validation.reason || "Task is not yet complete.";
                  }
                } catch (_err: any) {
                  // Guardian call failed — structural fallback
                  const completedCount = this.planSubtasks.filter(
                    (s) => s.status === "completed",
                  ).length;
                  if (completedCount < this.planSubtasks.length) {
                    shouldReject = true;
                    rejectReason = `Guardian unavailable. ${completedCount}/${this.planSubtasks.length} subtasks completed. Continue.`;
                  }
                }

                if (shouldReject) {
                  this.doneRejections++;
                  logger.warn("agent", "DONE rejected", {
                    turn: this.turnCount,
                    rejections: this.doneRejections,
                    reason: rejectReason.slice(
                      0,
                      STRING_LIMITS.REJECTION_REASON,
                    ),
                  });
                  this.traceRecorder?.recordEvent("done_rejected", {
                    rejections: this.doneRejections,
                    reason: rejectReason,
                  });

                  if (this.doneRejections >= AGENT_LIMITS.MAX_DONE_REJECTIONS) {
                    logger.warn("agent", "DONE forced after max rejections", {
                      turn: this.turnCount,
                      rejections: this.doneRejections,
                    });
                    // Fall through to normal done handling
                  } else {
                    this.context.addMessage({
                      role: "tool",
                      tool_call_id: toolCall.id,
                      content: `done() REJECTED: ${rejectReason}\n\nContinue working. Do NOT call done() until all steps are complete.`,
                    });
                    this.stepHandler(
                      {
                        id: crypto.randomUUID(),
                        type: "info",
                        label: `Not done yet (${this.doneRejections}/${AGENT_LIMITS.MAX_DONE_REJECTIONS})`,
                        status: "done",
                        timestamp: Date.now(),
                      },
                      false,
                    );
                    continue; // Resume executor loop
                  }
                }
              }

              // --- Normal done handling ---
              this.context.clearPlanStatus();
              logger.info("agent", "DONE called", {
                turn: this.turnCount,
                url: this.context.getCurrentUrl(),
                summary: summary.slice(0, STRING_LIMITS.SUMMARY_LOG),
              });
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: summary,
              });
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: "Task complete",
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
              this.statusHandler(AgentStatus.IDLE, "Done");
              this.messageHandler(summary, []);
              doneSummary = summary;
              doneSignaled = true;

              // Broadcast task completion if plan was active
              if (this.taskId && this.planSubtasks.length > 0) {
                const subtaskResults: SubtaskResult[] = this.planSubtasks.map(
                  (st) => ({
                    description: st.description,
                    status:
                      st.status === "failed"
                        ? ("failed" as const)
                        : st.status === "skipped"
                          ? ("skipped" as const)
                          : ("completed" as const),
                    turnsUsed: st.turnsUsed,
                    result: st.result || "",
                  }),
                );

                this.broadcast({
                  type: "TASK_COMPLETION",
                  payload: {
                    taskId: this.taskId,
                    status: subtaskResults.every(
                      (sr) => sr.status === "completed",
                    )
                      ? "completed"
                      : "partial",
                    totalTurnsUsed: this.turnCount,
                    totalTimeMs: Date.now() - this.taskStartTime,
                    summary,
                    subtaskResults,
                    urlHistory: this.urlHistory,
                  },
                });
              }

              // Broadcast final metrics
              if (this.showSessionMetrics) {
                this.metrics.totalSessionTimeMs =
                  Date.now() - this.sessionStartTime;
                this.broadcast({
                  type: "SESSION_METRICS",
                  payload: { ...this.metrics },
                });
              }

              break;
            }

            // ESCALATE tool — voluntary model upgrade (permanent, no de-escalation)
            if (toolName === ToolName.ESCALATE) {
              const reason = (args.reason as string) || "";
              if (!onSmartModel) {
                this.escalateModel();
                onSmartModel = true;
                voluntaryEscalation = true;
                prevElementCount = await this.refreshSnapshotWithRetry(
                  tabId,
                  prevElementCount,
                );
                this.stepHandler(
                  {
                    id: crypto.randomUUID(),
                    type: "info",
                    label: reason
                      ? `Escalating: "${reason.slice(0, 60)}"`
                      : "Escalating to smarter model",
                    status: "done",
                    timestamp: Date.now(),
                  },
                  false,
                );
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: ESCALATION_NUDGE,
                });
              } else {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Already using the most capable model (${this.llm.getCurrentModel()}). Escalation won't help further. Try a fundamentally different approach:\n- Use take_screenshot to see the visual layout\n- Use read_page to list all interactive elements\n- Try a completely different interaction strategy`,
                });
              }
              logger.info("agent", "ESCALATE called", {
                turn: this.turnCount,
                reason,
                wasAlreadyEscalated: onSmartModel && reason === "",
              });
              this.traceRecorder?.recordEvent("escalation", { reason, voluntary: true });
              continue;
            }

            // UPDATE_PLAN tool — task decomposition and progress tracking
            if (toolName === ToolName.UPDATE_PLAN) {
              const subtaskDescs = (args.subtasks as string[]) || [];
              const currentIndex = (args.currentIndex as number) || 0;
              const lastResult = args.lastResult as string | undefined;

              if (!this.taskId) {
                this.taskId = crypto.randomUUID();
                this.taskStartTime = Date.now();
              }

              this.planSubtasks = subtaskDescs.map((desc, i) => {
                // Preserve existing completedAtUrl for previously-completed steps
                const existing = this.planSubtasks[i];
                const isJustCompleted = i === currentIndex - 1;
                return {
                  description: desc,
                  status:
                    i < currentIndex
                      ? ("completed" as const)
                      : i === currentIndex
                        ? ("running" as const)
                        : ("pending" as const),
                  turnsUsed: 0,
                  turnBudget: 0,
                  result: isJustCompleted && lastResult ? lastResult : undefined,
                  completedAtUrl: isJustCompleted
                    ? this.context.getCurrentUrl() || undefined
                    : existing?.completedAtUrl,
                };
              });

              // Update plan status in system prompt (visible every turn)
              this.context.setPlanStatus(
                subtaskDescs.map((desc, i) => ({
                  description: desc,
                  status:
                    i < currentIndex
                      ? "done"
                      : i === currentIndex
                        ? "running"
                        : "pending",
                  completedAtUrl: this.planSubtasks[i]?.completedAtUrl,
                })),
                currentIndex,
              );

              this.broadcast({
                type: "TASK_PROGRESS",
                payload: {
                  taskId: this.taskId,
                  subtasks: this.planSubtasks,
                  currentIndex,
                  totalTurnsUsed: this.turnCount,
                },
              });

              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: lastResult
                    ? `Step ${currentIndex + 1}/${subtaskDescs.length}: "${subtaskDescs[currentIndex]?.slice(0, 40) || "done"}"`
                    : `Plan: ${subtaskDescs.length} steps`,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );

              // Directive response: tell the agent exactly what to do next
              let planResponse: string;
              if (currentIndex >= subtaskDescs.length) {
                planResponse = lastResult
                  ? `Step ${subtaskDescs.length} complete: "${lastResult}"\n\nAll ${subtaskDescs.length} steps are done. Call done() now with a summary of everything accomplished.`
                  : `All ${subtaskDescs.length} steps are done. Call done() now with a summary of everything accomplished.`;
              } else {
                const prevStepNote = lastResult
                  ? `Step ${currentIndex} complete: "${lastResult}"\n\n`
                  : "";
                planResponse = `${prevStepNote}NOW EXECUTE Step ${currentIndex + 1} of ${subtaskDescs.length}: "${subtaskDescs[currentIndex]}"\nFocus on this step only. Call update_plan() when done.`;
              }

              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: planResponse,
              });

              logger.info("agent", "UPDATE_PLAN", {
                turn: this.turnCount,
                taskId: this.taskId,
                subtaskCount: subtaskDescs.length,
                currentIndex,
                lastResult: lastResult?.slice(0, 100),
              });
              this.traceRecorder?.recordEvent("plan_update", {
                subtaskCount: subtaskDescs.length,
                currentIndex,
              });
              continue;
            }

            // WAIT tool — re-orientation mechanism
            if (toolName === ToolName.WAIT) {
              const seconds = Math.min(
                Math.max((args.seconds as number) || 2, 1),
                10,
              );
              const reason = (args.reason as string) || "";

              await new Promise((resolve) =>
                setTimeout(resolve, seconds * 1000),
              );

              // Refresh DOM snapshot for fresh context
              prevElementCount = await this.refreshSnapshotWithRetry(
                tabId,
                prevElementCount,
              );

              // Build re-orientation response
              const snapshot = this.context.getSnapshot();
              const parts: string[] = [
                `--- RE-ORIENTATION (waited ${seconds}s) ---`,
              ];
              if (reason) parts.push(`Reason: ${reason}`);
              parts.push(`\nOriginal task: "${this.originalQuery}"`);

              if (this.planSubtasks.length > 0) {
                const planLines = this.planSubtasks.map((s, i) => {
                  const marker =
                    s.status === "completed"
                      ? "[done]"
                      : s.status === "running"
                        ? "[NOW]"
                        : "[pending]";
                  return `  ${i + 1}. ${marker} ${s.description}`;
                });
                parts.push(`\nPlan progress:\n${planLines.join("\n")}`);
              }

              parts.push(
                `\nCurrent page: "${snapshot?.title || "unknown"}" — ${snapshot?.url || "unknown"}`,
              );
              parts.push(`Turn: ${this.turnCount} / ${this.maxTurns}`);
              parts.push(
                `\nReview the above → observe the page → decide your next action.`,
              );

              const reorientation = parts.join("\n");

              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: reorientation,
              });

              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "tool",
                  label: formatStepLabel(toolName, args),
                  toolName,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );

              logger.info("agent", "WAIT_REORIENT", {
                turn: this.turnCount,
                seconds,
                reason: reason.slice(0, 100),
              });
              this.traceRecorder?.recordEvent("wait_reorient", {
                seconds,
                reason,
              });
              continue;
            }

            // NAVIGATE guard — block navigation to completed step URLs
            if (toolName === ToolName.NAVIGATE && args.url) {
              const blockMessage = this.checkNavigateGuard(args.url as string);
              if (blockMessage) {
                logger.warn("agent", "Navigate blocked by guard", {
                  turn: this.turnCount,
                  targetUrl: (args.url as string).slice(0, 120),
                });
                this.traceRecorder?.recordEvent("navigate_blocked", {
                  targetUrl: args.url,
                });
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: blockMessage,
                });
                this.stepHandler(
                  {
                    id: crypto.randomUUID(),
                    type: "info",
                    label: "Navigate blocked — would undo progress",
                    status: "done",
                    timestamp: Date.now(),
                  },
                  false,
                );
                continue;
              }
            }

            const toolStepId = crypto.randomUUID();
            const toolStep: AgentStep = {
              id: toolStepId,
              type: "tool",
              label: formatStepLabel(toolName, args),
              detail: JSON.stringify(args),
              toolName,
              status: "running",
              timestamp: Date.now(),
            };
            this.stepHandler(toolStep, false);

            let result: string;
            try {
              result = await toolRegistry.execute(
                toolCall,
                tabId,
                this.abortController!.signal,
              );
              const toolMs = Date.now() - toolStep.timestamp;
              const screenshotUrl = this.pendingScreenshotUrl;
              this.pendingScreenshotUrl = null;
              this.stepHandler(
                {
                  ...toolStep,
                  status: "done",
                  durationMs: toolMs,
                  ...(screenshotUrl ? { screenshotUrl } : {}),
                },
                true,
              );
              logger.info("tools", `${toolName} OK`, {
                turn: this.turnCount,
                tool: toolName,
                risk: riskLevel,
                mode: "sequential",
                args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                result: result.slice(0, STRING_LIMITS.RESULT_LOG),
                durationMs: toolMs,
                intention: llmIntention,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id, toolName, args, result, true, toolMs, riskLevel,
              );
            } catch (toolError: any) {
              if (toolError.name === "AbortError") throw toolError;
              const errorMsg = toolError.message || String(toolError);
              const toolMs = Date.now() - toolStep.timestamp;
              logger.error("tools", `${toolName} FAIL`, {
                turn: this.turnCount,
                tool: toolName,
                risk: riskLevel,
                mode: "sequential",
                args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                error: errorMsg,
                durationMs: toolMs,
                intention: llmIntention,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id, toolName, args, errorMsg, false, toolMs, riskLevel, errorMsg,
              );
              this.stepHandler(
                {
                  ...toolStep,
                  status: "error",
                  durationMs: toolMs,
                  errorMessage: errorMsg,
                },
                true,
              );
              // Add error to conversation history so the LLM can recover
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${errorMsg}`,
              });
              continue;
            }

            if (
              DOM_MODIFYING_TOOLS.has(toolName) &&
              !result.includes("Click intercepted")
            ) {
              domModified = true;
            }

            // Add Tool Result to History
            this.context.addMessage({
              role: "tool",
              content: result,
              tool_call_id: toolCall.id,
            });
          }
        }

        // --- Circuit Breaker: track tool failures ---
        if (!doneSignaled) {
          // Count successes/failures from this turn's tool results
          let turnSuccesses = 0;
          let turnFailures = 0;
          const recentMessages = this.context.getMessages();
          // Look at the tool results we just added (they're the most recent messages)
          for (let i = recentMessages.length - 1; i >= 0; i--) {
            const msg = recentMessages[i];
            if (msg.role !== "tool") break;
            const content = typeof msg.content === "string" ? msg.content : "";
            if (
              content.startsWith("Error:") ||
              content.includes("does not appear to be") ||
              content.includes("No element with tag") ||
              content.includes("Click intercepted")
            ) {
              turnFailures++;
            } else {
              turnSuccesses++;
            }
          }

          // A. Consecutive all-fail turns
          if (turnFailures > 0 && turnSuccesses === 0) {
            consecutiveAllFailTurns++;
          } else {
            consecutiveAllFailTurns = 0;
          }

          if (
            consecutiveAllFailTurns >= AGENT_LIMITS.MAX_CONSECUTIVE_ALL_FAIL
          ) {
            logger.warn(
              "agent",
              "Circuit breaker: consecutive all-fail turns",
              {
                turn: this.turnCount,
                consecutiveAllFailTurns,
              },
            );
            this.traceRecorder?.recordEvent("circuit_breaker", {
              reason: "consecutive_all_fail",
              consecutiveAllFailTurns,
            });
            this.circuitBreakerExit(
              `All tool calls have failed for ${consecutiveAllFailTurns} consecutive turns. The agent cannot make progress. Send a follow-up with different instructions.`,
            );
            return {
              outcome: "error" as const,
              turnCount: this.turnCount,
              summary: "Circuit breaker: consecutive tool failures",
              metrics: this.getMetrics(),
            };
          }

          // B. Same-tool repeat failure tracking
          for (const toolCall of response.tool_calls!) {
            const toolName = toolCall.function.name;
            const argsKey = toolCall.function.arguments.slice(0, 100);
            const failKey = `${toolName}:${argsKey}`;

            // Find the corresponding tool result
            const toolResult = recentMessages.find(
              (m) => m.role === "tool" && m.tool_call_id === toolCall.id,
            );
            const resultContent =
              typeof toolResult?.content === "string" ? toolResult.content : "";
            const isFail =
              resultContent.startsWith("Error:") ||
              resultContent.includes("does not appear to be") ||
              resultContent.includes("No element with tag") ||
              resultContent.includes("Click intercepted");

            if (isFail) {
              const count = (toolFailCounts.get(failKey) || 0) + 1;
              toolFailCounts.set(failKey, count);

              if (count >= TOOL_FAILURE_THRESHOLDS.EXIT) {
                logger.warn(
                  "agent",
                  "Circuit breaker: same-tool repeat failure",
                  {
                    turn: this.turnCount,
                    tool: toolName,
                    count,
                  },
                );
                this.traceRecorder?.recordEvent("circuit_breaker", {
                  reason: "same_tool_repeat",
                  tool: toolName,
                  count,
                });
                this.circuitBreakerExit(
                  `The same tool call (${toolName}) has failed ${count} times with the same arguments. The agent is stuck in a loop. Send a follow-up with different instructions.`,
                );
                return {
                  outcome: "error" as const,
                  turnCount: this.turnCount,
                  summary: "Circuit breaker: repeated tool failure",
                  metrics: this.getMetrics(),
                };
              }

              if (count === TOOL_FAILURE_THRESHOLDS.WARN) {
                logger.warn(
                  "agent",
                  "Circuit breaker warning: tool repeating failures",
                  {
                    turn: this.turnCount,
                    tool: toolName,
                    count,
                  },
                );
                this.context.addMessage({
                  role: "user",
                  content: `WARNING: ${toolName} has failed ${count} times with similar arguments. Stop repeating this approach. Try a fundamentally different strategy — use a different tool, different element, or scroll/navigate to find an alternative path.`,
                });
              }
            } else {
              // Reset on success for this tool+args combo
              toolFailCounts.delete(failKey);
            }
          }
        }

        // Batch snapshot refresh: ONE refresh after all tools complete
        if (domModified && !doneSignaled) {
          try {
            await new Promise((resolve) => setTimeout(resolve, 100)); // SPA wait
            let snapResponse = await chrome.tabs.sendMessage(tabId, {
              type: "DOM_SNAPSHOT_REQUEST",
              requestId: crypto.randomUUID(),
              source: MessageSource.BACKGROUND,
              payload: {
                includeText: true,
                refresh: true,
                showTags: this.showElementTags,
              },
            });
            let snap = snapResponse?.payload?.snapshot;

            // Retry if elements dropped to 0 (SPA hasn't rendered yet)
            if (snap && snap.elements.length === 0 && prevElementCount > 0) {
              const retryDelays = [300, 500];
              for (const delay of retryDelays) {
                logger.info("agent", "Empty snapshot after action, retrying", {
                  turn: this.turnCount,
                  delay,
                  prevElements: prevElementCount,
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
                snapResponse = await chrome.tabs.sendMessage(tabId, {
                  type: "DOM_SNAPSHOT_REQUEST",
                  requestId: crypto.randomUUID(),
                  source: MessageSource.BACKGROUND,
                  payload: {
                    includeText: true,
                    refresh: true,
                    showTags: this.showElementTags,
                  },
                });
                snap = snapResponse?.payload?.snapshot;
                if (snap && snap.elements.length > 0) break;
              }
            }

            if (snap) {
              logger.info("agent", "Snapshot refreshed", {
                turn: this.turnCount,
                title: snap.title?.slice(0, 60),
                url: snap.url?.slice(0, 100),
                elements: snap.elements.length,
                durationMs: snapResponse.payload.durationMs,
              });
              prevElementCount = snap.elements.length;
              this.context.setSnapshot(snap);

              // Track URL in history
              const currentUrl = snap.url;
              if (currentUrl && !this.urlHistory.includes(currentUrl)) {
                this.urlHistory.push(currentUrl);
              }

              // Off-domain navigation detection
              if (this.startingOrigin && snap.url) {
                try {
                  const currentOrigin = new URL(snap.url).origin;
                  if (currentOrigin !== this.startingOrigin) {
                    if (!this.offDomainWarned) {
                      this.offDomainWarned = true;
                      logger.warn("agent", "Off-domain navigation detected", {
                        turn: this.turnCount,
                        startingOrigin: this.startingOrigin,
                        currentUrl: snap.url,
                      });
                      this.context.addMessage({
                        role: "user",
                        content: `WARNING: You navigated away from the original page (${this.startingOrigin}). If the task should be completed on the original page, navigate back immediately. Do not search for answers on other sites — solve the task using the tools available on the original page.`,
                      });
                    }
                  } else {
                    this.offDomainWarned = false; // Reset when back on original domain
                  }
                } catch {
                  /* invalid URL, skip */
                }
              }

              // Progress tracking: detect stuck loops
              const progressSignal = this.progress.onSnapshotRefresh(snap);
              if (progressSignal) {
                this.traceRecorder?.recordProgress(
                  progressSignal.staleTurns,
                  progressSignal.type,
                );
                this.traceRecorder?.recordEvent("stuck_signal", {
                  type: progressSignal.type,
                  staleTurns: progressSignal.staleTurns,
                });
                logger.warn("agent", "Progress stuck detected", {
                  turn: this.turnCount,
                  type: progressSignal.type,
                  staleTurns: progressSignal.staleTurns,
                  url: snap.url,
                });

                // Auto-screenshot: give the LLM visual context when stuck
                if (!this.disabledTools.has(ToolName.TAKE_SCREENSHOT)) {
                  try {
                    const screenshotResult = await toolRegistry.execute(
                      {
                        id: `auto_screenshot_${this.turnCount}`,
                        type: "function",
                        function: { name: ToolName.TAKE_SCREENSHOT, arguments: "{}" },
                      },
                      tabId,
                      this.abortController!.signal,
                    );
                    this.context.addMessage({
                      role: "user",
                      content: `[Auto-screenshot — you are stuck]\n${screenshotResult}`,
                    });
                    logger.info("agent", "Auto-screenshot injected on stuck", {
                      turn: this.turnCount,
                      staleTurns: progressSignal.staleTurns,
                    });
                  } catch (screenshotErr: any) {
                    logger.warn("agent", "Auto-screenshot failed (non-critical)", {
                      error: screenshotErr?.message,
                    });
                  }
                }

                // Broadcast stuck signal to side panel
                this.broadcast({
                  type: "AGENT_STUCK",
                  payload: {
                    signal: progressSignal.type as "nudge" | "pivot" | "escalate",
                    staleTurns: progressSignal.staleTurns,
                    url: snap.url,
                    message: progressSignal.message,
                  },
                });
                wasStuck = true;

                if (progressSignal.type === "pivot") {
                  // Strategy pivot: clear failing history, fresh start on same model
                  await this.strategyPivot(tabId);
                  consecutiveNudges = 0;
                } else if (progressSignal.type === "escalate" && !onSmartModel && cooldownRemaining <= 0) {
                  // Escalation + pivot: switch to smart model AND clear context
                  this.escalateModel();
                  onSmartModel = true;
                  await this.strategyPivot(tabId);
                  consecutiveNudges = 0;
                  this.stepHandler(
                    {
                      id: crypto.randomUUID(),
                      type: "info",
                      label: "Stuck — switching to smarter model",
                      status: "done",
                      timestamp: Date.now(),
                    },
                    false,
                  );
                } else {
                  // Nudge: just inject the message (no context clearing)
                  this.context.addMessage({
                    role: "user",
                    content: progressSignal.message,
                  });
                }
              } else if (wasStuck) {
                // Agent recovered — broadcast resolved signal
                this.broadcast({
                  type: "AGENT_STUCK",
                  payload: {
                    signal: "resolved",
                    staleTurns: 0,
                    url: snap.url,
                    message: "Agent is making progress again.",
                  },
                });
                wasStuck = false;

                // De-escalate if on smart model (automatic, not voluntary) and under cycle limit
                if (onSmartModel && !voluntaryEscalation && escalationCycles < ESCALATION_LIMITS.MAX_CYCLES) {
                  this.deescalateModel();
                  onSmartModel = false;
                  escalationCycles++;
                  cooldownRemaining = ESCALATION_LIMITS.COOLDOWN_TURNS;
                  this.progress.resetEscalation();

                  this.stepHandler(
                    {
                      id: crypto.randomUUID(),
                      type: "info",
                      label: "Progress made — switching back to fast model",
                      status: "done",
                      timestamp: Date.now(),
                    },
                    false,
                  );
                }
              }
            }
          } catch {
            // Non-critical: snapshot refresh failed, continue with stale data
          }
        }

        if (doneSignaled) {
          await this.traceRecorder?.endTurn();
          break;
        }
      } else {
        // TEXT RESPONSE — no tool calls

        // Plan confirmation: on turn 1 with confirmPlan, pause for user approval
        if (this.confirmPlan && this.turnCount === 1 && response.content) {
          // Finalize stream so the plan text appears as a complete message
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });

          logger.info("agent", "Plan ready — pausing for user approval");
          this.statusHandler(
            AgentStatus.PAUSED,
            "Plan ready — waiting for approval",
          );

          // Block until user approves (RESUME_AGENT) or injects a hint
          if (!this.pauseGate) {
            let resolve: () => void;
            const promise = new Promise<void>((r) => {
              resolve = r;
            });
            this.pauseGate = { promise, resolve: resolve! };
          }
          await this.pauseGate.promise;
          this.pauseGate = null;
          if (!this.isRunning) break;

          this.statusHandler(AgentStatus.THINKING, "Executing plan...");
          continue; // Continue the loop — user approved
        }

        // Soft nudge: turn 1, no plan, substantive text — likely an answer to a question
        if (
          this.turnCount === 1 &&
          !this.taskId &&
          cleanContent &&
          cleanContent.trim().length > 20
        ) {
          consecutiveNudges++;
          totalNudges++;
          logger.info(
            "agent",
            "Soft nudge: turn 1 text response, suggesting done()",
            {
              turn: this.turnCount,
              textLen: cleanContent.trim().length,
            },
          );
          this.context.addMessage({
            role: "user",
            content: `If that was your answer to the user's question, wrap it in done({"summary": "..."}) to deliver it. If you need to act on the page, call the appropriate tool.`,
          });
          continue;
        }

        // Unified nudge→pivot→escalate+pivot→give-up for text-only responses
        consecutiveNudges++;
        totalNudges++;
        logger.warn("agent", "LLM emitted text instead of tools, nudging", {
          turn: this.turnCount,
          consecutiveNudges,
          pivotDone,
          onSmartModel,
          text: cleanContent?.slice(0, 80),
        });

        // Pivot gate: 2 text-only nudges → try fresh context on same model
        if (consecutiveNudges >= 2 && !pivotDone) {
          await this.strategyPivot(tabId);
          pivotDone = true;
          consecutiveNudges = 0;
          continue;
        }

        // Escalation + pivot gate: 2 more text-only after pivot → escalate + pivot
        if (consecutiveNudges >= 2 && !onSmartModel && cooldownRemaining <= 0) {
          this.escalateModel();
          onSmartModel = true;
          await this.strategyPivot(tabId);
          consecutiveNudges = 0;

          // User-visible feedback
          this.stepHandler(
            {
              id: crypto.randomUUID(),
              type: "info",
              label: "Switching to smarter model",
              status: "done",
              timestamp: Date.now(),
            },
            false,
          );
          this.statusHandler(AgentStatus.THINKING, "Escalating model...");
          continue;
        }

        // Give-up gate: 3 consecutive nudges after escalate+pivot
        if (consecutiveNudges >= 3) {
          logger.warn("agent", "Loop ended: consecutive nudge limit", {
            turns: this.turnCount,
            consecutiveNudges,
            totalNudges,
            onSmartModel,
          });
          const stuckMsg =
            cleanContent || "The agent appears stuck and cannot continue.";
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: stuckMsg, done: false },
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          this.statusHandler(
            AgentStatus.IDLE,
            "Stuck — send a follow-up to continue",
          );
          await this.traceRecorder?.endTurn();
          break;
        }

        // Ratio-based give-up: if >40% of turns are text-only after 10+ turns post-escalation
        if (
          onSmartModel &&
          this.turnCount >= 10 &&
          totalNudges / this.turnCount > 0.4
        ) {
          logger.warn("agent", "Loop ended: excessive nudge ratio", {
            turns: this.turnCount,
            totalNudges,
            ratio: (totalNudges / this.turnCount).toFixed(2),
          });
          const stuckMsg =
            "The agent is struggling to make progress. Send a follow-up with more specific instructions.";
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: stuckMsg, done: false },
          });
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          this.statusHandler(
            AgentStatus.IDLE,
            "Stuck — send a follow-up to continue",
          );
          await this.traceRecorder?.endTurn();
          break;
        }

        // Regular nudge: refresh snapshot + inject message
        const count = await this.refreshSnapshot(tabId);
        if (count >= 0) prevElementCount = count;
        this.context.addMessage({ role: "user", content: NUDGE_MESSAGE });

        // Trace: flush turn
        await this.traceRecorder?.endTurn();
        continue;
      }

      // Trace: flush turn at end of each iteration
      await this.traceRecorder?.endTurn();
    }

    if (this.turnCount >= this.maxTurns) {
      logger.warn("agent", "Loop ended: max turns reached", {
        turns: this.turnCount,
        maxTurns: this.maxTurns,
      });
      const limitMsg = `Reached turn limit (${this.turnCount}/${this.maxTurns}). You can increase the limit in Settings or send a follow-up message to continue.`;
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: limitMsg, done: false },
      });
      this.broadcast({
        type: "STREAM_CHUNK",
        payload: { delta: "", done: true },
      });
      this.statusHandler(
        AgentStatus.IDLE,
        `Turn limit (${this.turnCount}/${this.maxTurns})`,
      );
      return {
        outcome: "max_turns" as const,
        turnCount: this.turnCount,
        summary: limitMsg,
        metrics: this.getMetrics(),
      };
    }

    return {
      outcome: "completed" as const,
      turnCount: this.turnCount,
      summary: doneSummary,
      metrics: this.getMetrics(),
    };
  }

  /**
   * Resume the agent loop from a saved state (after navigation).
   * Called by the navigation bridge when webNavigation.onCompleted fires.
   */
  public async resumeFromNavigation(
    savedState: AgentLoopState,
    newSnapshot?: DomSnapshot,
  ) {
    if (this.isRunning) {
      this.stop();
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    // Restore context from saved state
    this.context.restoreFromState(savedState.messages);

    if (newSnapshot) {
      this.context.setSnapshot(newSnapshot);
    }

    this.statusHandler(AgentStatus.THINKING, "Resuming after navigation...");

    // Register per-tab callbacks so screenshot/vision tools work after navigation
    const tabId = savedState.activeTabId;
    setVisionUsageCallback((usage, durationMs, model) => {
      this.recordVisionUsage(usage, durationMs, model);
    }, tabId);
    setScreenshotCaptureCallback((thumbnailUrl) => {
      this.pendingScreenshotUrl = thumbnailUrl;
    }, tabId);

    try {
      await this.loop(tabId);
    } catch (error: any) {
      if (error.name === "AbortError") {
        logger.info("agent", "Agent stopped by user");
        this.statusHandler(AgentStatus.IDLE, "Stopped");
      } else {
        logger.error("agent", "Loop Error", { error });
        const errorMsg = `Agent stopped: ${error.message}. Send a follow-up message to retry.`;
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: errorMsg, done: false },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.ERROR, error.message);
      }
    } finally {
      setVisionUsageCallback(null, tabId);
      setScreenshotCaptureCallback(null, tabId);
      this.isRunning = false;
    }
  }

  /**
   * Get current loop state for saving before navigation.
   */
  public getState(tabId: number): AgentLoopState {
    // Cast LLMMessage[] to ChatMessage[] - they are compatible at runtime
    const messages =
      this.context.getMessages() as unknown as import("../../types").ChatMessage[];
    return {
      status: AgentStatus.WAITING_FOR_PAGE_LOAD,
      messages,
      originalQuery: this.originalQuery,
      turnCount: this.turnCount,
      maxTurns: this.maxTurns,
      activeTabId: tabId,
      workspaceId: this.workspaceId,
      lastActivityTs: Date.now(),
      pendingToolCall: null,
    };
  }
}
