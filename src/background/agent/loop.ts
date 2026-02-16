import {
  AgentStatus,
  AgentLoopState,
  AgentStep,
  MessageSource,
  RuntimeMessage,
  RiskLevel,
  SessionMetrics,
  SubtaskResult,
  SubtaskSummary,
  ToolCall,
  ToolName,
} from "../../types";
import { logger } from "../../utils";
import { LLMClient, stripThinkTags } from "../llm";
import {
  toolRegistry,
  setVisionUsageCallback,
  setScreenshotCaptureCallback,
} from "../tools";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS } from "../tools/metadata";
import { REACT_TOOL_NAMES } from "../tools/react";
import { classifyRisk, sanitizeUrl } from "../security";
import { waitForDomReady } from "../tab-ready";
import { workspaceManager } from "../workspaces/manager";
import { ContextManager } from "./context";
import { ProgressTracker } from "./progress";
import { recoverToolCallsFromText } from "./tool-recovery";
import { DomSnapshot } from "../../types";
import { CompletionResponse, LLMMessage, TokenUsage } from "../llm/types";
import { formatStepLabel } from "./step-labels";
import { PlanGuardian } from "./guardian";
import { TraceRecorder } from "./trace";
import { AgentMiddleware } from "./middleware";
import {
  AGENT_LIMITS,
  BATCH_LIMITS,
  TOOL_FAILURE_THRESHOLDS,
  BROADCAST_INTERVALS,
  LLM_CONFIG,
  STRING_LIMITS,
  TIMING,
  ESCALATION_LIMITS,
  ORIENTATION,
  REDUNDANT_ACTION,
  STEP_WATCHDOG,
  STUCK_THRESHOLDS,
} from "./constants";

const APPROVAL_TIMEOUT_MS = 30000;
const MAX_SESSION_MS = 20 * 60 * 1000;

/** Tools that cannot appear inside a batch_execute step. */
const BATCH_BLOCKED_TOOLS = new Set<string>([
  ToolName.NAVIGATE, ToolName.DONE, ToolName.ESCALATE,
  ToolName.BATCH_EXECUTE,
  ToolName.TAKE_SCREENSHOT, ToolName.CREATE_TAB,
  ToolName.CLOSE_TAB, ToolName.SWITCH_TAB,
  ToolName.CREATE_WINDOW, ToolName.EXECUTE_JS,
]);

/** Format correction when LLM emits text instead of tool calls. */
const TEXT_ONLY_CORRECTION = `You responded with text but no tool call. Either:
- Call a tool to advance the task (read_page, click, type_text, scroll_page, etc.)
- If the user asked a question and you already know the answer, call done({"summary": "your answer"})
- If you need to see the page first, call read_page or take_screenshot`;

/** Nudge injected when escalating to the smart model — orients it on the situation. */
const ESCALATION_NUDGE = `You are now the upgraded model, brought in because the previous model got stuck.
Review the conversation history and current page state. Then:
1. Identify what was attempted and why it failed.
2. Formulate a different strategy — do not repeat what already failed.
3. Call the appropriate tool to advance the task.
If the page state is unclear, start with read_page or take_screenshot.`;

/** Nudge injected when de-escalating back to the fast model. */
const DEESCALATION_NUDGE = `The smarter model made progress and you're back in control.
Review the recent history to understand what was accomplished. Continue from where it left off.
Follow the Think step: 1) What do I see? 2) What tool advances the task? 3) What should change?`;

/** Nudge injected when BRAINS→HANDS handoff completes (orientation phase ends). */
const HANDOFF_NUDGE = `Orientation complete — you are now executing the plan.
The smarter model has analyzed the page and started the task. Your job: execute the remaining steps efficiently.
Follow the plan. Complete the current subtask before moving to the next. If stuck, call escalate().`;

/** Message injected during a strategy pivot — tells the agent what NOT to retry. */
const PIVOT_MESSAGE = (attemptSummary: string) =>
  `STRATEGY PIVOT — Your previous approach is not working. Start fresh.

What was attempted:
${attemptSummary}

Instructions:
1. Do not repeat completed actions or retry failed ones.
2. Re-read the user's task above.
3. Look at the current page state with fresh eyes (use read_page or take_screenshot).
4. Think from first principles: what is a COMPLETELY DIFFERENT way to accomplish this?
5. If the task seems impossible on this page, navigate elsewhere or call done() explaining why.`;

/** Tracks a recent successful tool call for redundant action detection */
interface RecentAction {
  tool: string;
  args: string; // First 100 chars of JSON args
  result: string; // First 60 chars of result
}

/** Filler prefix patterns — text-only responses that start with these are low-information */
const FILLER_PREFIXES = [
  "i'm ready",
  "we need to",
  "the task",
  "i will now",
  "i'll",
  "we have",
  "i'm now",
  "the next step",
];

/**
 * Classify a text-only LLM response as filler (low-information narration)
 * vs. genuine reasoning that may contain useful analysis.
 */
function isFillerText(text: string): boolean {
  const trimmed = text.trim();
  // Short text with no tool call is definitionally filler in an agent context
  if (trimmed.length < 60) return true;
  // Filler prefix pattern
  const lower = trimmed.toLowerCase();
  if (FILLER_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  // High non-alphanumeric ratio (catches "We have..............." patterns)
  const alphanumCount = trimmed.replace(/[^a-zA-Z0-9]/g, "").length;
  if (alphanumCount / trimmed.length < 0.6) return true;
  return false;
}

/**
 * Build a compact summary of what the agent tried before a strategy pivot.
 * Includes both successes and failures so the next model knows what was
 * already accomplished vs what went wrong.
 */
function extractAttemptSummary(messages: LLMMessage[]): string {
  const successes: string[] = [];
  const failures: string[] = [];

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
            const parts: string[] = [];
            if (args.id != null) parts.push(`[${args.id}]`);
            if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
            if (args.url) parts.push(String(args.url).slice(0, 40));
            if (args.direction) parts.push(args.direction);
            if (args.summary)
              parts.push(`"${String(args.summary).slice(0, 30)}"`);
            argSnippet = parts.join(" ");
          } catch {
            /* */
          }
          break;
        }
      }
    }

    const key = `${toolName} ${argSnippet}`.trim();

    if (isFail) {
      const errorSnippet = content.split("\n")[0].slice(0, 60);
      // Deduplicate repeated failures
      const existing = failures.find((f) => f.startsWith(`- ${key}`));
      if (!existing) failures.push(`- ${key} — ${errorSnippet}`);
    } else {
      // Skip internal/noise tools for success tracking
      if (["read_page", "wait", "escalate"].includes(toolName))
        continue;
      const resultSnippet = content.split("\n")[0].slice(0, 60);
      successes.push(`- ${key} → ${resultSnippet}`);
    }

    // Cap total entries
    if (successes.length + failures.length >= 15) break;
  }

  const sections: string[] = [];
  if (successes.length > 0) {
    sections.push(`Completed actions (DO NOT redo):\n${successes.join("\n")}`);
  }
  if (failures.length > 0) {
    sections.push(`Failed actions (DO NOT retry):\n${failures.join("\n")}`);
  }
  if (sections.length === 0) {
    return "No specific actions recorded.";
  }
  return sections.join("\n\n").slice(0, 800);
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
  private static approvalWaiters = new Map<string, (approved: boolean) => void>();

  public static resolveApproval(approvalId: string, approved: boolean): boolean {
    const waiter = AgentLoop.approvalWaiters.get(approvalId);
    if (!waiter) return false;
    AgentLoop.approvalWaiters.delete(approvalId);
    waiter(approved);
    return true;
  }

  private llm: LLMClient;
  private context: ContextManager;
  private baseContextTokens: number; // Original context window size for de-escalation restore
  private isRunning = false;
  private abortController: AbortController | null = null;
  private statusHandler: (status: AgentStatus, detail: string) => void;
  private messageHandler: (text: string, toolCalls: ToolCall[]) => void;
  private stepHandler: (step: AgentStep, update: boolean) => void;
  private maxTurns: number;
  private showElementTags: boolean;
  private showSessionMetrics: boolean;
  private preferredModelTier: "fast" | "smart" | "default";
  private executionContract:
    | {
        role: string;
        modelTier: "fast" | "smart";
        allowedTools: ToolName[];
      }
    | null;
  private disabledTools: Set<ToolName>;
  private suppressUiBroadcast: boolean;
  private disableInternalPlanning: boolean;
  private bypassApprovals: boolean;
  private approvalTimeoutMs: number;
  private onMemoryAdd:
    | ((item: {
        content: string;
        category: string;
        sourceUrl: string;
        createdAt: number;
      }) => void)
    | null;
  private middleware: AgentMiddleware;

  /** Workspace ID for session isolation */
  public readonly workspaceId: string | null;
  public readonly workerId: string | null;
  public readonly taskIdRef: string | null;
  public readonly nodeId: string | null;

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
  /** Turns spent on the current plan step */
  private turnsOnCurrentStep = 0;
  /** Last plan index — used to detect step transitions */
  private lastPlanIndex = 0;

  /** Task planning state */
  private taskId: string | null = null;
  private planSubtasks: SubtaskSummary[] = [];
  private taskStartTime = 0;
  private urlHistory: string[] = [];

  /** Trace recorder for session capture */
  private traceRecorder: TraceRecorder | null = null;

  /** Tab IDs where we've registered vision/screenshot callbacks (for cleanup) */
  private registeredCallbackTabIds = new Set<number>();

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
      totalCachedTokens: 0,
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
      if (response.usage.cached_tokens) {
        this.metrics.totalCachedTokens += response.usage.cached_tokens;
        logger.debug("agent", "Cache hit", {
          cached: response.usage.cached_tokens,
          prompt: response.usage.prompt_tokens,
          pct: Math.round(
            (response.usage.cached_tokens / response.usage.prompt_tokens) * 100,
          ),
        });
      }
    }
    this.metrics.totalLlmTimeMs += llmMs;
    this.metrics.llmCallCount += 1;

    const model = response.actualModel ?? this.llm.getCurrentModel();
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
    callbacks: {
      onStatusUpdate: (status: AgentStatus, detail: string) => void;
      onMessage: (text: string, toolCalls: ToolCall[]) => void;
      onStep?: (step: AgentStep, update: boolean) => void;
    },
    options?: {
      maxContextTokens?: number;
      maxTurns?: number;
      showElementTags?: boolean;
      showSessionMetrics?: boolean;
      preferredModelTier?: "fast" | "smart";
      executionContract?: {
        role: string;
        modelTier: "fast" | "smart";
        allowedTools: ToolName[];
      };
      disabledTools?: Set<ToolName>;
      workspaceId?: string | null;
      workerId?: string | null;
      taskId?: string | null;
      nodeId?: string | null;
      suppressUiBroadcast?: boolean;
      disableInternalPlanning?: boolean;
      bypassApprovals?: boolean;
      approvalTimeoutMs?: number;
      onMemoryAdd?: (item: {
        content: string;
        category: string;
        sourceUrl: string;
        createdAt: number;
      }) => void;
    },
  ) {
    this.showSessionMetrics = options?.showSessionMetrics ?? false;
    this.preferredModelTier = options?.preferredModelTier ?? "default";
    this.executionContract = options?.executionContract ?? null;
    this.disabledTools = options?.disabledTools ?? new Set<ToolName>();
    // React toolkit gated by default — enabled when React is detected on the page
    for (const tool of REACT_TOOL_NAMES) {
      this.disabledTools.add(tool);
    }
    // Screenshots restricted to tier 1 (smart model) — too expensive for fast tier
    this.disabledTools.add(ToolName.TAKE_SCREENSHOT);
    this.workspaceId = options?.workspaceId ?? null;
    this.workerId = options?.workerId ?? null;
    this.taskIdRef = options?.taskId ?? null;
    this.nodeId = options?.nodeId ?? null;
    this.suppressUiBroadcast = options?.suppressUiBroadcast ?? false;
    this.disableInternalPlanning = options?.disableInternalPlanning ?? false;
    this.bypassApprovals = options?.bypassApprovals ?? false;
    this.approvalTimeoutMs = options?.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS;
    this.onMemoryAdd = options?.onMemoryAdd ?? null;
    this.middleware = new AgentMiddleware({
      disabledTools: this.disabledTools,
      bypassApprovals: this.bypassApprovals,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
      maxSessionMs: MAX_SESSION_MS,
    });
    this.llm = new LLMClient(openRouterApiKey, groqApiKey, cerebrasApiKey);
    if (this.preferredModelTier === "smart") {
      this.llm.switchToSmart();
    } else if (this.preferredModelTier === "fast") {
      this.llm.switchToFast();
    }
    logger.debug("policy", "Initial model tier selected", {
      preferredModelTier: this.preferredModelTier,
      model: this.llm.getCurrentModel(),
      provider: this.llm.getCurrentProvider(),
      workspaceId: this.workspaceId,
      workerId: this.workerId,
    });
    this.llm.setFailoverCallback((from, to) => {
      const names: Record<string, string> = {
        cerebras: "Cerebras",
        groq: "Groq",
        openrouter: "OpenRouter",
      };
      this.stepHandler(
        {
          id: crypto.randomUUID(),
          type: "info",
          label: `Rate limited on ${names[from] ?? from} — switched to ${names[to] ?? to}`,
          status: "done",
          timestamp: Date.now(),
        },
        false,
      );
    });
    this.guardian = new PlanGuardian(openRouterApiKey, cerebrasApiKey);
    this.baseContextTokens = options?.maxContextTokens ?? 32000;
    this.context = new ContextManager(
      this.baseContextTokens,
      this.workspaceId,
      this.workerId,
    );
    this.statusHandler = callbacks.onStatusUpdate;
    this.messageHandler = callbacks.onMessage;
    this.stepHandler = callbacks.onStep ?? (() => {});
    this.maxTurns = options?.maxTurns ?? AGENT_LIMITS.MAX_TURNS_DEFAULT;
    this.showElementTags = options?.showElementTags ?? false;
  }

  /**
   * Send a message to the side panel, automatically injecting workspaceId,
   * requestId, and source. Fire-and-forget (errors are silenced).
   */
  private broadcast(
    msg: Omit<RuntimeMessage, "requestId" | "source" | "workspaceId">,
  ): void {
    if (this.suppressUiBroadcast) return;
    chrome.runtime
      .sendMessage({
        ...msg,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId: this.workspaceId,
        } as RuntimeMessage)
        .catch(() => {});
  }

  private async requestApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    context: string,
  ): Promise<boolean> {
    const approvalId = crypto.randomUUID();
    this.statusHandler(AgentStatus.ACTING, "Waiting for approval...");
    const approvalStep: AgentStep = {
      id: crypto.randomUUID(),
      type: "info",
      label: `Approval requested: ${context}`,
      status: "running",
      timestamp: Date.now(),
    };
    this.stepHandler(approvalStep, false);
    logger.info("policy", "Approval request created", {
      approvalId,
      turn: this.turnCount,
      toolName,
      context,
      timeoutMs: this.approvalTimeoutMs,
      bypassApprovals: this.bypassApprovals,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
    });
    this.traceRecorder?.recordEvent("approval", {
      approvalId,
      stage: "requested",
      turn: this.turnCount,
      toolName,
      context,
      timeoutMs: this.approvalTimeoutMs,
      bypassApprovals: this.bypassApprovals,
    });

    const approvalPromise = new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (approved: boolean, outcome: "approved" | "rejected" | "timeout" | "dispatch_failed") => {
        if (settled) return;
        settled = true;
        AgentLoop.approvalWaiters.delete(approvalId);
        const stepStatus = approved ? "done" : "error";
        const errorMessage =
          outcome === "timeout"
            ? "Approval timed out."
            : outcome === "dispatch_failed"
              ? "Approval request dispatch failed."
              : outcome === "rejected"
                ? "Approval rejected by user."
                : undefined;
        this.stepHandler(
          {
            ...approvalStep,
            label: approved
              ? `Approval granted: ${context}`
              : `Approval denied: ${context}`,
            status: stepStatus,
            durationMs: Date.now() - approvalStep.timestamp,
            errorMessage,
          },
          true,
        );
        logger.info("policy", "Approval decision settled", {
          approvalId,
          turn: this.turnCount,
          toolName,
          outcome,
          approved,
          workspaceId: this.workspaceId,
          workerId: this.workerId,
        });
        this.traceRecorder?.recordEvent("approval", {
          approvalId,
          stage: "settled",
          turn: this.turnCount,
          toolName,
          outcome,
          approved,
        });
        resolve(approved);
      };

      const timer = setTimeout(() => {
        settle(false, "timeout");
      }, this.approvalTimeoutMs);

      AgentLoop.approvalWaiters.set(approvalId, (approved: boolean) => {
        clearTimeout(timer);
        settle(approved, approved ? "approved" : "rejected");
      });

      // Register waiter before emitting the request to avoid missing
      // synchronous approval responses from tests or fast UI handlers.
      chrome.runtime
        .sendMessage({
          type: "APPROVAL_REQUEST",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId: this.workspaceId,
          payload: {
            approvalId,
            toolName,
            args,
            risk: RiskLevel.HIGH,
            context,
            timeoutMs: this.approvalTimeoutMs,
          },
        } as RuntimeMessage)
        .catch((error: any) => {
          clearTimeout(timer);
          logger.error("policy", "Failed to dispatch approval request", {
            approvalId,
            turn: this.turnCount,
            toolName,
            error: error?.message ?? String(error),
            workspaceId: this.workspaceId,
            workerId: this.workerId,
          });
          settle(false, "dispatch_failed");
        });
    });

    return await approvalPromise;
  }

  private async ensureToolApproval(
    toolName: ToolName,
    args: Record<string, unknown>,
    riskLevel: RiskLevel,
  ): Promise<boolean> {
    if (riskLevel !== RiskLevel.HIGH) return true;
    if (this.bypassApprovals) {
      const bypassContext = formatStepLabel(toolName, args);
      this.stepHandler(
        {
          id: crypto.randomUUID(),
          type: "info",
          label: `Approval bypassed: ${bypassContext}`,
          status: "done",
          timestamp: Date.now(),
        },
        false,
      );
      logger.warn("policy", "Approval bypass applied to high-risk tool", {
        turn: this.turnCount,
        tool: toolName,
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
      this.traceRecorder?.recordEvent("approval", {
        stage: "bypassed",
        turn: this.turnCount,
        toolName,
      });
      return true;
    }
    const context = formatStepLabel(toolName, args);
    const approved = await this.requestApproval(toolName, args, context);
    if (!approved) {
      logger.warn("policy", "High-risk tool denied or timed out", {
        turn: this.turnCount,
        tool: toolName,
        workspaceId: this.workspaceId,
        workerId: this.workerId,
      });
    }
    return approved;
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
    this.turnsOnCurrentStep = 0;
    this.lastPlanIndex = 0;
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
    const allowedTools = this.executionContract?.allowedTools
      ? [...this.executionContract.allowedTools]
      : Object.values(ToolName).filter((tool) => !this.disabledTools.has(tool));
    this.traceRecorder.recordEvent("execution_contract", {
      role: this.executionContract?.role || (this.workerId ? "executor" : "single_agent"),
      modelTier:
        this.executionContract?.modelTier ||
        (this.preferredModelTier === "default"
          ? this.llm.isSmartTier()
            ? "smart"
            : "fast"
          : this.preferredModelTier),
      initialModel: this.llm.getCurrentModel(),
      allowedTools,
      workspaceId: this.workspaceId,
      workerId: this.workerId,
      nodeId: this.nodeId,
    });

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

    // 2. Add User Message
    const userContent = initialUserText;
    this.context.addMessage({
      role: "user",
      content: userContent,
    });

    // --- Guardian: decompose task into plan (task-agnostic) ---
    if (!this.disableInternalPlanning) {
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
              `\n\nExecute step 1 now. Complete each step in order and verify progress before continuing. ` +
              `If the plan fails, revise your approach and continue from the best next step. ` +
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
    this.registeredCallbackTabIds.clear();
    this.registeredCallbackTabIds.add(tabId);
    setVisionUsageCallback((usage, durationMs, model) => {
      this.recordVisionUsage(usage, durationMs, model);
    }, tabId);

    // Register per-tab screenshot capture callback for inline thumbnails
    setScreenshotCaptureCallback((thumbnailUrl) => {
      this.pendingScreenshotUrl = thumbnailUrl;
    }, tabId);

    // Register guardian usage callback for metrics tracking
    this.guardian.setUsageCallback((usage, llmMs, model) => {
      this.recordUsage(
        {
          role: "assistant",
          content: null,
          finish_reason: "stop",
          usage,
          actualModel: model,
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
      // Clean up callbacks for all tabs the agent touched
      for (const tid of this.registeredCallbackTabIds) {
        setVisionUsageCallback(null, tid);
        setScreenshotCaptureCallback(null, tid);
      }
      this.registeredCallbackTabIds.clear();
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

  /** Escalate to smart model when stuck. Distills context, then switches model via smart pool. */
  private escalateModel(): void {
    // Distill verbose history into compact situation report (unless orientation phase — no history yet)
    if (this.turnCount > 1) {
      this.context.distillForEscalation(this.originalQuery);
    }
    this.llm.switchToSmart();
    this.context.setModelTier("smart");
    logger.info("agent", "Escalating to smart model", {
      model: this.llm.getCurrentModel(),
      provider: this.llm.getCurrentProvider(),
    });
  }

  /** Get the tab IDs belonging to this agent's workspace, or null if no workspace. */
  private async getWorkspaceTabIds(): Promise<number[] | null> {
    if (!this.workspaceId || this.workspaceId === "default") return null;
    const ws = await workspaceManager.getWorkspaceById(this.workspaceId);
    return ws?.tabIds ?? null;
  }

  /** De-escalate back to fast model when progress resumes after automatic escalation. */
  private deescalateModel(): void {
    this.llm.switchToFast();
    this.context.setModelTier("fast");
    logger.info("agent", "De-escalating to fast model", {
      model: this.llm.getCurrentModel(),
      provider: this.llm.getCurrentProvider(),
    });
  }

  /**
   * Strategy pivot: prune failing history, inject original query + failure summary,
   * refresh DOM snapshot, and reset progress tracking. Gives the agent a fresh
   * start without changing models.
   */
  private async strategyPivot(tabId: number): Promise<void> {
    // 1. Extract what was tried before clearing
    const attemptSummary = extractAttemptSummary(this.context.getMessages());

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
      content: PIVOT_MESSAGE(attemptSummary),
    });

    // 5. Refresh DOM snapshot for current state
    await this.refreshSnapshotWithRetry(tabId, -1);

    // 6. User-visible feedback
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
      attemptSummaryLen: attemptSummary.length,
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
    // Retry once after DOM readiness probe (replaces fixed 300ms sleep)
    await waitForDomReady(tabId, { timeoutMs: 300, waitForElements: true });
    count = await this.refreshSnapshot(tabId);
    if (count >= 0) return count;
    return prevCount; // Keep existing count if both attempts fail
  }

  /**
   * Capture a screenshot for escalation context.
   * Returns a data URL on success, null on failure (non-critical).
   */
  private async captureEscalationScreenshot(
    tabId: number,
  ): Promise<string | null> {
    try {
      const tab = await chrome.tabs.get(tabId);
      return await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 50, // Lower quality is fine for context
      });
    } catch {
      return null;
    }
  }

  /** Execute a tool call with optional orchestration hooks (e.g. buffered memory). */
  private async executeToolCall(
    toolCall: ToolCall,
    tabId: number,
  ): Promise<string> {
    const toolName = toolCall.function.name as ToolName;
    if (toolName === ToolName.MEMORY_ADD && this.onMemoryAdd) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        return "Error: Invalid memory_add arguments.";
      }

      const content = String(args.content ?? "").trim();
      if (!content) return "Error: memory_add requires non-empty content.";
      const category = String(args.category ?? "general");
      const sourceUrl = this.context.getCurrentUrl() || "unknown";

      this.onMemoryAdd({
        content,
        category,
        sourceUrl,
        createdAt: Date.now(),
      });
      return `Buffered memory entry in category "${category}".`;
    }

    return await toolRegistry.execute(toolCall, tabId, this.abortController!.signal);
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
            `If re-visiting is genuinely needed, revise your plan first.`
          );
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async loop(initialTabId: number): Promise<LoopResult> {
    let tabId = initialTabId;
    let prevElementCount = -1; // Track element count for empty-page retry
    let consecutiveTextOnly = 0;
    let totalTextOnly = 0;
    let doneSummary = "";
    let wasStuck = false; // Track stuck state for "resolved" signal

    // Two-tier escalation: 0=fast, 1=smart (GLM-4.7 with native reasoning)
    // BRAINS→HANDS: start at tier 1 (smart) for orientation, then hand off to tier 0 (fast)
    let escalationTier = 1;
    this.escalateModel(); // Start with BRAINS (smart model)
    let voluntaryEscalation = false; // escalate tool → permanent, no de-escalation
    let orientationPhase = true; // true during initial smart model orientation
    let escalationCycles = 0;
    let cooldownRemaining = 0;
    let smartModelStartTurn = 0; // turn when auto-escalation fired

    // Circuit breaker: consecutive all-fail turns
    let consecutiveAllFailTurns = 0;

    // Circuit breaker: same-tool repeat failure
    const toolFailCounts = new Map<string, number>();

    // Redundant action detection: sliding window of recent successful tool calls
    const recentSuccesses: RecentAction[] = [];

    // React toolkit: enable on first snapshot that detects React
    let reactToolsEnabled = false;

    while (this.isRunning && this.turnCount < this.maxTurns) {
      // Pause gate — block here if user paused the loop
      if (this.pauseGate) await this.pauseGate.promise;
      if (!this.isRunning) break; // Check again after resume (user may have stopped)

      this.turnCount++;
      this.turnsOnCurrentStep++;

      if (
        this.middleware.shouldHaltTurn(
          this.turnCount,
          this.maxTurns,
          this.sessionStartTime,
        )
      ) {
        const haltMessage =
          "Stopped by policy middleware due to session budget limits.";
        logger.warn("policy", "Halting loop turn", {
          turn: this.turnCount,
          workspaceId: this.workspaceId,
          workerId: this.workerId,
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: haltMessage, done: false },
        });
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
        this.statusHandler(AgentStatus.IDLE, "Stopped by middleware policy");
        break;
      }

      // Decrement de-escalation cooldown
      if (cooldownRemaining > 0) cooldownRemaining--;

      // BRAINS→HANDS handoff: smart model has oriented, hand off to fast model
      if (
        orientationPhase &&
        this.turnCount > ORIENTATION.PHASE_TURNS &&
        escalationTier === 1
      ) {
        orientationPhase = false;
        this.deescalateModel();
        escalationTier = 0;
        cooldownRemaining = ESCALATION_LIMITS.COOLDOWN_TURNS;
        this.disabledTools.add(ToolName.TAKE_SCREENSHOT); // Re-lock screenshots at tier 0
        this.context.addMessage({
          role: "user",
          content: HANDOFF_NUDGE,
        });
        this.stepHandler(
          {
            id: crypto.randomUUID(),
            type: "info",
            label: "Handing off to fast model",
            status: "done",
            timestamp: Date.now(),
          },
          false,
        );
        logger.info("agent", "BRAINS→HANDS handoff", {
          turn: this.turnCount,
          orientationTurns: ORIENTATION.PHASE_TURNS,
        });
      }

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

      // React toolkit: enable tools when React is detected on the page
      if (!reactToolsEnabled) {
        const fw = this.context.getSnapshot()?.framework;
        if (fw?.name === "react") {
          reactToolsEnabled = true;
          for (const tool of REACT_TOOL_NAMES) {
            this.disabledTools.delete(tool);
          }
          logger.info("agent", "React detected — toolkit enabled", {
            version: fw.version,
          });
        }
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
        consecutiveTextOnly = 0;
        const firstToolName = response.tool_calls[0].function.name;
        this.statusHandler(AgentStatus.ACTING, `Executing ${firstToolName}...`);

        // Always finalize the stream so the next turn creates a fresh message
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });

        // Execute Tools
        let doneSignaled = false;
        let domModified = false;

        // Determine if we can parallelize: no sequential tools present
        const hasSequentialTool = response.tool_calls.some((tc) =>
          SEQUENTIAL_TOOLS.has(tc.function.name as ToolName),
        );
        const hasHighRiskTool = response.tool_calls.some((tc) => {
          try {
            const parsed = JSON.parse(tc.function.arguments || "{}");
            return (
              classifyRisk(tc.function.name as ToolName, parsed) ===
              RiskLevel.HIGH
            );
          } catch {
            return classifyRisk(tc.function.name as ToolName, {}) === RiskLevel.HIGH;
          }
        });
        const canParallelize =
          !hasSequentialTool && !hasHighRiskTool && response.tool_calls.length > 1;

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

              const preDecision = this.middleware.evaluatePreTool(
                toolName,
                args,
                this.turnCount,
              );

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

              if (!preDecision.allowed) {
                const deniedReason =
                  preDecision.denyReason || `Tool ${toolName} denied by middleware`;
                const toolMs = Date.now() - toolStep.timestamp;
                this.stepHandler(
                  {
                    ...toolStep,
                    status: "error",
                    durationMs: toolMs,
                    errorMessage: deniedReason,
                  },
                  true,
                );
                return {
                  toolCall,
                  result: null,
                  error: deniedReason,
                };
              }

              try {
                const result = await this.executeToolCall(toolCall, tabId);
                const toolMs = Date.now() - toolStep.timestamp;
                this.middleware.evaluatePostTool(
                  toolName,
                  result,
                  null,
                  toolMs,
                  this.turnCount,
                );
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
                  risk: preDecision.riskLevel,
                  mode: "parallel",
                  args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                  result: result.slice(0, STRING_LIMITS.RESULT_LOG),
                  durationMs: toolMs,
                  intention: llmIntention,
                });
                this.traceRecorder?.recordToolExecution(
                  toolCall.id,
                  toolName,
                  args,
                  result,
                  true,
                  toolMs,
                  preDecision.riskLevel,
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
                this.middleware.evaluatePostTool(
                  toolName,
                  null,
                  errorMsg,
                  toolMs,
                  this.turnCount,
                );
                logger.error("tools", `${toolName} FAIL`, {
                  turn: this.turnCount,
                  tool: toolName,
                  risk: preDecision.riskLevel,
                  mode: "parallel",
                  args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                  error: errorMsg,
                  durationMs: toolMs,
                  intention: llmIntention,
                });
                this.traceRecorder?.recordToolExecution(
                  toolCall.id,
                  toolName,
                  args,
                  errorMsg,
                  false,
                  toolMs,
                  preDecision.riskLevel,
                  errorMsg,
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

            const preDecision = this.middleware.evaluatePreTool(
              toolName,
              args,
              this.turnCount,
            );
            if (!preDecision.allowed) {
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error: ${preDecision.denyReason || "Blocked by policy middleware."}`,
              });
              continue;
            }
            if (
              preDecision.approvalMode === "bypassed" &&
              preDecision.riskLevel === RiskLevel.HIGH
            ) {
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: `Approval bypassed: ${formatStepLabel(toolName, args)}`,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
            }
            if (preDecision.requiresApproval) {
              const approved = await this.ensureToolApproval(
                toolName,
                args,
                preDecision.riskLevel,
              );
              if (!approved) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: "Error: Action denied by user approval policy.",
                });
                continue;
              }
            }

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
              if (escalationTier < 1) {
                this.escalateModel();
                escalationTier = 1;
                voluntaryEscalation = true;
                orientationPhase = false; // Cancel BRAINS→HANDS handoff
                this.disabledTools.delete(ToolName.TAKE_SCREENSHOT); // Unlock screenshots
                prevElementCount = await this.refreshSnapshotWithRetry(
                  tabId,
                  prevElementCount,
                );
                this.stepHandler(
                  {
                    id: crypto.randomUUID(),
                    type: "info",
                    label: reason
                      ? `Escalating: "${reason.slice(0, STRING_LIMITS.ESCALATION_REASON)}"`
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
                tier: escalationTier,
              });
              this.traceRecorder?.recordEvent("escalation", {
                reason,
                voluntary: true,
              });
              continue;
            }

            // BATCH_EXECUTE tool — execute pre-planned tool sequence without LLM roundtrips
            if (toolName === ToolName.BATCH_EXECUTE) {
              const rawSteps = (args.steps as Array<{ tool: string; args: Record<string, unknown>; expect?: string }>) || [];
              const verify = (args.verify as string) || "";
              const maxSteps = Math.min(rawSteps.length, BATCH_LIMITS.MAX_STEPS);
              const completedResults: string[] = [];
              let bailReason = "";

              this.stepHandler({
                id: crypto.randomUUID(),
                type: "tool",
                label: `Batch: ${maxSteps} steps`,
                toolName: ToolName.BATCH_EXECUTE,
                status: "running",
                timestamp: Date.now(),
              }, false);

              const batchStartTime = Date.now();

              for (let i = 0; i < maxSteps; i++) {
                if (!this.isRunning) { bailReason = "Agent stopped"; break; }
                const step = rawSteps[i];

                // Validate tool name
                if (BATCH_BLOCKED_TOOLS.has(step.tool)) {
                  bailReason = `Step ${i}: "${step.tool}" is not allowed in batch`;
                  break;
                }
                const stepRisk = classifyRisk(
                  step.tool as ToolName,
                  step.args || {},
                );
                if (stepRisk === RiskLevel.HIGH) {
                  bailReason = `Step ${i}: "${step.tool}" requires explicit user approval and cannot run in batch`;
                  break;
                }

                // Execute via toolRegistry
                const syntheticToolCall: ToolCall = {
                  id: `batch_${toolCall.id}_${i}`,
                  type: "function",
                  function: { name: step.tool as ToolName, arguments: JSON.stringify(step.args) },
                };

                let result: string;
                try {
                  result = await this.executeToolCall(syntheticToolCall, tabId);
                } catch (e: any) {
                  if (e.name === "AbortError") throw e;
                  bailReason = `Step ${i} ("${step.tool}"): ${e.message}`;
                  break;
                }

                // Check for error results
                if (result.startsWith("Error")) {
                  bailReason = `Step ${i} ("${step.tool}"): ${result}`;
                  break;
                }

                // Check expect condition
                if (step.expect && !result.toLowerCase().includes(step.expect.toLowerCase())) {
                  bailReason = `Step ${i} ("${step.tool}"): expected "${step.expect}" not found in result`;
                  break;
                }

                completedResults.push(`[${i}] ${step.tool}: ${result}`);

                // Track DOM modifications
                if (DOM_MODIFYING_TOOLS.has(step.tool as ToolName)) {
                  domModified = true;
                }
              }

              // Build consolidated result
              const header = bailReason
                ? `Batch BAILED after ${completedResults.length}/${maxSteps} steps: ${bailReason}`
                : `Batch OK: ${completedResults.length}/${maxSteps} steps completed`;
              const body = completedResults.join("\n");
              const footer = verify ? `\nVerify: ${verify}` : "";
              const batchResult = `${header}\n${body}${footer}`;

              const batchDurationMs = Date.now() - batchStartTime;

              // Update step
              this.stepHandler({
                id: crypto.randomUUID(),
                type: "tool",
                label: bailReason
                  ? `Batch: ${completedResults.length}/${maxSteps} (bailed)`
                  : `Batch: ${maxSteps} steps OK`,
                toolName: ToolName.BATCH_EXECUTE,
                status: bailReason ? "error" : "done",
                timestamp: Date.now(),
                durationMs: batchDurationMs,
              }, true);

              // Log + trace
              logger.info("tools", "batch_execute", {
                turn: this.turnCount,
                stepsPlanned: maxSteps,
                stepsCompleted: completedResults.length,
                bailed: !!bailReason,
                bailReason: bailReason || undefined,
                durationMs: batchDurationMs,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id, ToolName.BATCH_EXECUTE, args,
                batchResult, !bailReason, batchDurationMs,
                classifyRisk(ToolName.BATCH_EXECUTE, args),
              );

              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: batchResult,
              });
              continue; // Skip normal executor
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

            // LIST_TABS — workspace-scoped
            if (toolName === ToolName.LIST_TABS) {
              const wsTabIds = await this.getWorkspaceTabIds();
              let tabLines: string[];
              if (wsTabIds) {
                // Filter to workspace tabs only
                const tabs: chrome.tabs.Tab[] = [];
                for (const id of wsTabIds) {
                  try {
                    tabs.push(await chrome.tabs.get(id));
                  } catch {
                    // Tab may have been closed externally
                  }
                }
                if (tabs.length === 0) {
                  tabLines = ["No open tabs in this workspace."];
                } else {
                  tabLines = tabs.map(
                    (t) =>
                      `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.id === tabId ? " [current]" : ""}`,
                  );
                }
              } else {
                // No workspace — show all tabs (fallback)
                const allTabs = await chrome.tabs.query({});
                tabLines = allTabs.map(
                  (t: any) =>
                    `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.id === tabId ? " [current]" : ""}`,
                );
              }
              this.context.addMessage({
                role: "tool",
                tool_call_id: toolCall.id,
                content: tabLines.join("\n") || "No open tabs.",
              });
              logger.info("agent", "LIST_TABS", {
                turn: this.turnCount,
                count: tabLines.length,
                workspaceScoped: wsTabIds !== null,
              });
              continue;
            }

            // SWITCH_TAB — workspace-scoped, updates loop tabId
            if (toolName === ToolName.SWITCH_TAB) {
              const targetTabId = args.tabId as number;
              const wsTabIds = await this.getWorkspaceTabIds();

              if (wsTabIds && !wsTabIds.includes(targetTabId)) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Tab ${targetTabId} is not in this workspace. Available tabs: ${wsTabIds.join(", ")}`,
                });
                logger.warn("agent", "switch_tab blocked — outside workspace", {
                  turn: this.turnCount,
                  targetTabId,
                  workspaceTabs: wsTabIds,
                });
                continue;
              }

              try {
                await chrome.tabs.update(targetTabId, { active: true });
                tabId = targetTabId;

                // Register vision/screenshot callbacks on new tab
                this.registeredCallbackTabIds.add(tabId);
                setVisionUsageCallback((usage, durationMs, model) => {
                  this.recordVisionUsage(usage, durationMs, model);
                }, tabId);
                setScreenshotCaptureCallback((thumbnailUrl) => {
                  this.pendingScreenshotUrl = thumbnailUrl;
                }, tabId);

                // Refresh snapshot for new tab
                prevElementCount = await this.refreshSnapshotWithRetry(
                  tabId,
                  prevElementCount,
                );

                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Switched to tab ${targetTabId}. Fresh page snapshot is available.`,
                });
              } catch (e: any) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error switching to tab ${targetTabId}: ${e.message}`,
                });
              }
              logger.info("agent", "SWITCH_TAB", {
                turn: this.turnCount,
                targetTabId,
                newTabId: tabId,
              });
              continue;
            }

            // CLOSE_TAB — workspace-scoped, prevents closing current tab
            if (toolName === ToolName.CLOSE_TAB) {
              const targetTabId = (args.tabId as number) || tabId;

              if (targetTabId === tabId) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Cannot close the current tab (${tabId}). Use switch_tab to move to another tab first.`,
                });
                continue;
              }

              const wsTabIds = await this.getWorkspaceTabIds();
              if (wsTabIds && !wsTabIds.includes(targetTabId)) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: Tab ${targetTabId} is not in this workspace. Available tabs: ${wsTabIds.join(", ")}`,
                });
                logger.warn("agent", "close_tab blocked — outside workspace", {
                  turn: this.turnCount,
                  targetTabId,
                  workspaceTabs: wsTabIds,
                });
                continue;
              }

              try {
                await chrome.tabs.remove(targetTabId);
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Closed tab ${targetTabId}.`,
                });
              } catch (e: any) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error closing tab ${targetTabId}: ${e.message}`,
                });
              }
              logger.info("agent", "CLOSE_TAB", {
                turn: this.turnCount,
                targetTabId,
              });
              continue;
            }

            // CREATE_TAB — workspace-scoped, auto-adds to workspace
            if (toolName === ToolName.CREATE_TAB) {
              const url = args.url as string;
              const urlResult = sanitizeUrl(url);
              if (!urlResult.ok) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error: ${urlResult.error}`,
                });
                continue;
              }

              try {
                const newTab = await chrome.tabs.create({
                  url: urlResult.value,
                });
                if (
                  newTab.id &&
                  this.workspaceId &&
                  this.workspaceId !== "default"
                ) {
                  await workspaceManager.addTabToWorkspace(
                    newTab.id,
                    this.workspaceId,
                  );
                }

                // Register callbacks on new tab
                if (newTab.id) {
                  this.registeredCallbackTabIds.add(newTab.id);
                  setVisionUsageCallback((usage, durationMs, model) => {
                    this.recordVisionUsage(usage, durationMs, model);
                  }, newTab.id);
                  setScreenshotCaptureCallback((thumbnailUrl) => {
                    this.pendingScreenshotUrl = thumbnailUrl;
                  }, newTab.id);
                }

                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Created new tab (ID: ${newTab.id}) with URL: ${urlResult.value}. Use switch_tab to make it the active tab.`,
                });
                logger.info("agent", "CREATE_TAB", {
                  turn: this.turnCount,
                  newTabId: newTab.id,
                  url: urlResult.value,
                  workspaceId: this.workspaceId,
                });
              } catch (e: any) {
                this.context.addMessage({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: `Error creating tab: ${e.message}`,
                });
              }
              continue;
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
              result = await this.executeToolCall(toolCall, tabId);
              const toolMs = Date.now() - toolStep.timestamp;
              this.middleware.evaluatePostTool(
                toolName,
                result,
                null,
                toolMs,
                this.turnCount,
              );
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
                risk: preDecision.riskLevel,
                mode: "sequential",
                args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                result: result.slice(0, STRING_LIMITS.RESULT_LOG),
                durationMs: toolMs,
                intention: llmIntention,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id,
                toolName,
                args,
                result,
                true,
                toolMs,
                preDecision.riskLevel,
              );
            } catch (toolError: any) {
              if (toolError.name === "AbortError") throw toolError;
              const errorMsg = toolError.message || String(toolError);
              const toolMs = Date.now() - toolStep.timestamp;
              this.middleware.evaluatePostTool(
                toolName,
                null,
                errorMsg,
                toolMs,
                this.turnCount,
              );
              logger.error("tools", `${toolName} FAIL`, {
                turn: this.turnCount,
                tool: toolName,
                risk: preDecision.riskLevel,
                mode: "sequential",
                args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
                error: errorMsg,
                durationMs: toolMs,
                intention: llmIntention,
              });
              this.traceRecorder?.recordToolExecution(
                toolCall.id,
                toolName,
                args,
                errorMsg,
                false,
                toolMs,
                preDecision.riskLevel,
                errorMsg,
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

          // C. Redundant successful action detection
          for (const toolCall of response.tool_calls!) {
            const toolName = toolCall.function.name;
            const argsKey = toolCall.function.arguments.slice(0, 100);

            // Find the corresponding tool result
            const toolResult = recentMessages.find(
              (m) => m.role === "tool" && m.tool_call_id === toolCall.id,
            );
            const resultContent =
              typeof toolResult?.content === "string" ? toolResult.content : "";
            const isSuccess =
              !resultContent.startsWith("Error:") &&
              !resultContent.includes("does not appear to be") &&
              !resultContent.includes("No element with tag") &&
              !resultContent.includes("Click intercepted") &&
              !resultContent.includes("REJECTED");

            if (isSuccess) {
              // Push to ring buffer (capped at WINDOW size)
              recentSuccesses.push({
                tool: toolName,
                args: argsKey,
                result: resultContent.slice(0, 60),
              });
              if (recentSuccesses.length > REDUNDANT_ACTION.WINDOW) {
                recentSuccesses.shift();
              }

              // Count repetitions of this tool+args in the window
              const matchCount = recentSuccesses.filter(
                (entry) => entry.tool === toolName && entry.args === argsKey,
              ).length;

              if (matchCount >= REDUNDANT_ACTION.THRESHOLD) {
                logger.warn("agent", "Redundant action detected", {
                  turn: this.turnCount,
                  tool: toolName,
                  count: matchCount,
                });
                this.traceRecorder?.recordEvent("redundant_action", {
                  tool: toolName,
                  count: matchCount,
                });
                this.context.addMessage({
                  role: "user",
                  content: `REDUNDANT ACTION: You have called ${toolName} ${matchCount} times with similar arguments, getting the same result each time. This is not making progress. ACT on the information you already have — use click_element, type_text, or another tool to advance the task. Do NOT call ${toolName} with these arguments again.`,
                });
                // Clear the buffer so the warning doesn't fire every subsequent turn
                recentSuccesses.length = 0;
              } else {
                // D. Tool-name-only redundancy: same tool name with varying args
                const toolNameCount = recentSuccesses.filter(
                  (entry) => entry.tool === toolName,
                ).length;
                if (
                  toolNameCount >= REDUNDANT_ACTION.TOOL_NAME_ONLY_THRESHOLD
                ) {
                  logger.warn("agent", "Tool-name redundancy detected", {
                    turn: this.turnCount,
                    tool: toolName,
                    count: toolNameCount,
                  });
                  this.traceRecorder?.recordEvent("tool_name_redundancy", {
                    tool: toolName,
                    count: toolNameCount,
                  });
                  this.context.addMessage({
                    role: "user",
                    content: `WARNING: You have called ${toolName} ${toolNameCount} times in recent turns (with different arguments each time). If the step is already done, advance to the next one. If your approach isn't working, try take_screenshot or a completely different strategy.`,
                  });
                  recentSuccesses.length = 0;
                }
              }
            }
          }

          // E. Step duration watchdog
          if (
            this.taskId &&
            this.planSubtasks.length > 0 &&
            this.turnsOnCurrentStep > 0
          ) {
            if (
              this.turnsOnCurrentStep >= STEP_WATCHDOG.ESCALATE_TURNS &&
              escalationTier < 1 &&
              cooldownRemaining <= 0
            ) {
              logger.warn("agent", "Step watchdog: force escalation", {
                turn: this.turnCount,
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
                fromTier: escalationTier,
              });
              this.traceRecorder?.recordEvent("step_watchdog_escalate", {
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
              });
              this.escalateModel();
              escalationTier = 1;
              orientationPhase = false;
              this.disabledTools.delete(ToolName.TAKE_SCREENSHOT);
              smartModelStartTurn = this.turnCount;
              await this.strategyPivot(tabId);
              this.progress.resetEscalation();
              this.context.addMessage({
                role: "user",
                content: `STEP WATCHDOG: You spent ${this.turnsOnCurrentStep} turns on step ${this.lastPlanIndex + 1} without advancing. ${ESCALATION_NUDGE}\nEither complete this step and move forward, or revise the plan if the step is impossible.`,
              });
              this.stepHandler(
                {
                  id: crypto.randomUUID(),
                  type: "info",
                  label: `Stuck on step ${this.lastPlanIndex + 1} — escalating to smart model`,
                  status: "done",
                  timestamp: Date.now(),
                },
                false,
              );
            } else if (this.turnsOnCurrentStep === STEP_WATCHDOG.WARN_TURNS) {
              logger.warn("agent", "Step watchdog: warn", {
                turn: this.turnCount,
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
              });
              this.traceRecorder?.recordEvent("step_watchdog_warn", {
                turnsOnStep: this.turnsOnCurrentStep,
                stepIndex: this.lastPlanIndex,
              });
              this.context.addMessage({
                role: "user",
                content: `You have spent ${this.turnsOnCurrentStep} turns on this step. Either the step is ALREADY COMPLETE (advance) or your approach isn't working (try take_screenshot or escalate).`,
              });
            }
          }
        }

        // Force snapshot refresh when tools hit stale element IDs
        // Ensures the LLM's next turn sees fresh IDs without wasting a read_page call
        if (!domModified && !doneSignaled) {
          const recentMsgs = this.context.getMessages();
          for (let i = recentMsgs.length - 1; i >= 0; i--) {
            const msg = recentMsgs[i];
            if (msg.role !== "tool") break;
            if (
              typeof msg.content === "string" &&
              msg.content.includes("No element with tag")
            ) {
              domModified = true;
              logger.info(
                "agent",
                "Stale element ID detected, forcing snapshot refresh",
                {
                  turn: this.turnCount,
                },
              );
              break;
            }
          }
        }

        // Batch snapshot refresh: ONE refresh after all tools complete
        if (domModified && !doneSignaled) {
          try {
            // Wait for DOM to settle instead of fixed 100ms sleep
            // Uses MutationObserver + rAF in content script — responds when idle
            const readiness = await waitForDomReady(tabId, {
              timeoutMs: 150,
              waitForElements: prevElementCount > 0,
            });
            logger.debug("agent", "DOM ready probe", {
              turn: this.turnCount,
              waitedMs: readiness.waitedMs,
              elementCount: readiness.elementCount,
            });

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

            // Retry once if elements dropped to 0 (SPA still rendering)
            if (snap && snap.elements.length === 0 && prevElementCount > 0) {
              logger.info("agent", "Empty snapshot after action, waiting for elements", {
                turn: this.turnCount,
                prevElements: prevElementCount,
              });
              // Use DOM probe with waitForElements — content script watches for element insertion
              await waitForDomReady(tabId, { timeoutMs: 500, waitForElements: true });
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

              // Track URL in history + reset redundant action buffer on navigation
              const currentUrl = snap.url;
              if (currentUrl && !this.urlHistory.includes(currentUrl)) {
                this.urlHistory.push(currentUrl);
                recentSuccesses.length = 0;
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
                        function: {
                          name: ToolName.TAKE_SCREENSHOT,
                          arguments: "{}",
                        },
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
                    logger.warn(
                      "agent",
                      "Auto-screenshot failed (non-critical)",
                      {
                        error: screenshotErr?.message,
                      },
                    );
                  }
                }

                // Broadcast stuck signal to side panel
                this.broadcast({
                  type: "AGENT_STUCK",
                  payload: {
                    signal: "escalate",
                    staleTurns: progressSignal.staleTurns,
                    url: snap.url,
                    message: progressSignal.message,
                  },
                });
                wasStuck = true;

                // Escalate: fast → smart (with screenshot context)
                if (escalationTier === 0 && cooldownRemaining <= 0) {
                  this.escalateModel();
                  escalationTier = 1;
                  orientationPhase = false;
                  this.disabledTools.delete(ToolName.TAKE_SCREENSHOT);
                  smartModelStartTurn = this.turnCount;
                  const escalationScreenshot =
                    await this.captureEscalationScreenshot(tabId);
                  await this.strategyPivot(tabId);
                  this.progress.resetEscalation();
                  if (escalationScreenshot) {
                    this.context.addMessage({
                      role: "user",
                      content: [
                        { type: "text", text: ESCALATION_NUDGE },
                        {
                          type: "image_url",
                          image_url: {
                            url: escalationScreenshot,
                            detail: "low",
                          },
                        },
                      ],
                    });
                  } else {
                    this.context.addMessage({
                      role: "user",
                      content: ESCALATION_NUDGE,
                    });
                  }
                  consecutiveTextOnly = 0;
                  recentSuccesses.length = 0;
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

                // De-escalate if on smart model (automatic, not voluntary), under cycle limit,
                // and the smart model has had enough turns to actually work
                const smartTenure = this.turnCount - smartModelStartTurn;
                if (
                  escalationTier > 0 &&
                  !voluntaryEscalation &&
                  escalationCycles < ESCALATION_LIMITS.MAX_CYCLES &&
                  smartTenure >= ESCALATION_LIMITS.MIN_SMART_TENURE
                ) {
                  this.deescalateModel();
                  this.context.addMessage({
                    role: "user",
                    content: DEESCALATION_NUDGE,
                  });
                  escalationTier = 0;
                  this.disabledTools.add(ToolName.TAKE_SCREENSHOT); // Re-lock screenshots at tier 0
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

        // Soft nudge: turn 1, no plan, substantive text — likely an answer to a question
        if (
          this.turnCount === 1 &&
          !this.taskId &&
          cleanContent &&
          cleanContent.trim().length > 20
        ) {
          consecutiveTextOnly++;
          totalTextOnly++;
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
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          continue;
        }

        // Text-only escalation: 1st → format correction, 2nd → escalate, 3rd → give-up
        const filler = cleanContent ? isFillerText(cleanContent) : true;
        consecutiveTextOnly += filler ? 2 : 1; // Filler fast-tracks
        totalTextOnly++;
        logger.warn("agent", "LLM emitted text instead of tools", {
          turn: this.turnCount,
          consecutiveTextOnly,
          tier: escalationTier,
          filler,
          text: cleanContent?.slice(0, 80),
        });

        // Escalate to next tier on 2nd consecutive text-only
        if (consecutiveTextOnly >= 2 && escalationTier < 1 && cooldownRemaining <= 0) {
          this.escalateModel();
          escalationTier = 1;
          orientationPhase = false;
          this.disabledTools.delete(ToolName.TAKE_SCREENSHOT);
          smartModelStartTurn = this.turnCount;
          await this.strategyPivot(tabId);
          this.progress.resetEscalation();
          this.context.addMessage({
            role: "user",
            content: ESCALATION_NUDGE,
          });
          consecutiveTextOnly = 0;
          recentSuccesses.length = 0;
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
          this.broadcast({
            type: "STREAM_CHUNK",
            payload: { delta: "", done: true },
          });
          continue;
        }

        // Give-up: 3 consecutive text-only at max tier
        if (consecutiveTextOnly >= 3) {
          logger.warn("agent", "Loop ended: consecutive text-only limit", {
            turns: this.turnCount,
            consecutiveTextOnly,
            totalTextOnly,
            tier: escalationTier,
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

        // Smart model turn-based give-up
        const smartTurns = escalationTier > 0
          ? this.turnCount - smartModelStartTurn
          : 0;
        if (
          escalationTier > 0 &&
          smartTurns >= STUCK_THRESHOLDS.GIVE_UP_SMART &&
          totalTextOnly >= 3
        ) {
          logger.warn("agent", "Loop ended: smart model turn limit", {
            turns: this.turnCount,
            smartTurns,
            totalTextOnly,
            tier: escalationTier,
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
        this.context.addMessage({ role: "user", content: TEXT_ONLY_CORRECTION });

        // Trace: flush turn
        await this.traceRecorder?.endTurn();
        this.broadcast({
          type: "STREAM_CHUNK",
          payload: { delta: "", done: true },
        });
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
      for (const tid of this.registeredCallbackTabIds) {
        setVisionUsageCallback(null, tid);
        setScreenshotCaptureCallback(null, tid);
      }
      this.registeredCallbackTabIds.clear();
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
      workerId: this.workerId,
      lastActivityTs: Date.now(),
      pendingToolCall: null,
    };
  }
}
