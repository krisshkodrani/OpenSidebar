import {
  TaggedElement,
  ToolCall,
  ToolName,
  RiskLevel,
  SessionMetrics,
  TraceEntry,
  TraceToolExecution,
  TraceEvent,
  TraceEventPayloadByType,
  TraceFailureInfo,
  TraceSkillToolMetrics,
  TraceSession,
  TraceLLMMessage,
  TraceContextMetrics,
  TracePanoramicShot,
  TracePerceptionFallbackReason,
  TracePerceptionFreshnessReason,
  TracePerceptionMode,
  TracePerceptionScreenshotStatus,
  TracePerceptionSource,
} from "../../types";
import { TokenUsage } from "../llm/types";
import { LLMMessage } from "../llm/types";
import { logger } from "../../utils";
import { redactTracePayload } from "../../utils/trace-protection";

const TRACE_SERVER_URL = "http://127.0.0.1:7589";
const FLUSH_TIMEOUT_MS = 2000;
const MAX_PENDING = 50;
const TRACE_SCHEMA_VERSION = "2026-02-19" as const;
const TRACE_PRODUCER = "background.agent.trace-recorder" as const;

/**
 * Records full-fidelity execution data for a single agent session.
 * Each turn is flushed as JSONL to the trace server (fire-and-forget).
 */
export class TraceRecorder {
  readonly sessionId: string;
  private startTime: number;
  private query = "";
  private startUrl = "";
  private workspaceId: string | null = null;
  private runId: string | null = null;
  private correlationId: string;
  private parentRunId: string | null = null;

  // Current turn being recorded
  private currentTurn: Partial<TraceEntry> | null = null;
  private turnToolExecutions: TraceToolExecution[] = [];
  private turnEvents: TraceEvent[] = [];

  // Retry queue for failed flushes
  private pendingQueue: Array<{ path: string; data: string }> = [];
  private skillToolMetricsState: {
    skillId: string;
    rankingApplications: number;
    totalSelections: number;
    preferredSelections: number;
    neutralSelections: number;
    discouragedSelections: number;
  } | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startTime = Date.now();
    this.correlationId = sessionId;
  }

  /** Set session-level metadata (called once at start) */
  setSessionInfo(query: string, startUrl: string): void {
    this.query = query;
    this.startUrl = startUrl;
  }

  /** Set workspace ID for trace correlation */
  setWorkspaceId(id: string | null): void {
    this.workspaceId = id;
  }

  /** Set orchestrator correlation context when running as part of a run */
  setCorrelationContext(context: {
    runId?: string | null;
    correlationId?: string | null;
    parentRunId?: string | null;
  }): void {
    this.runId = context.runId ?? null;
    this.parentRunId = context.parentRunId ?? null;
    if (context.correlationId && context.correlationId.length > 0) {
      this.correlationId = context.correlationId;
    } else if (this.runId) {
      this.correlationId = this.runId;
    }
  }

  /**
   * Convert LLMMessage[] to TraceLLMMessage[] for trace recording.
   * Flattens ContentPart[] to string, replaces image_url parts with "[image]".
   */
  static toTraceMessages(messages: LLMMessage[]): TraceLLMMessage[] {
    return messages.map((msg) => {
      let content: string | null;
      if (Array.isArray(msg.content)) {
        const parts: string[] = [];
        for (const part of msg.content) {
          if (part.type === "text") parts.push(part.text);
          else if (part.type === "image_url") parts.push("[image]");
        }
        content = parts.length > 0 ? parts.join("") : null;
      } else {
        content = msg.content;
      }
      const result: TraceLLMMessage = { role: msg.role, content };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        result.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }
      if (msg.tool_call_id) {
        result.tool_call_id = msg.tool_call_id;
      }
      return result;
    });
  }

  /** Begin recording a new turn */
  startTurn(
    turnNumber: number,
    snapshot: {
      url: string;
      title: string;
      elementCount: number;
      visibleContentLength: number;
      pageContentLength?: number;
      scrollY: number;
    },
    elements: TaggedElement[],
    messageCount: number,
    toolCount: number,
    model: string,
    compressionLevel: string,
    rawMessages?: TraceLLMMessage[],
    contextMetrics?: TraceContextMetrics,
    modelTier?: "executor" | "planner",
  ): void {
    this.turnToolExecutions = [];
    this.turnEvents = [];
    this.currentTurn = {
      sessionId: this.sessionId,
      turnNumber,
      timestamp: Date.now(),
      snapshot,
      elements,
      llmRequest: {
        model,
        ...(modelTier ? { modelTier } : {}),
        messageCount,
        toolCount,
        compressionLevel,
        ...(rawMessages ? { messages: rawMessages } : {}),
        ...(contextMetrics ? { contextMetrics } : {}),
      },
    };
  }

  /** Record the LLM response for this turn */
  recordLLMResponse(
    content: string | null,
    toolCalls: ToolCall[],
    finishReason: string,
    usage: TokenUsage | null,
    durationMs: number,
    actualProviderId?: string,
    actualModel?: string,
  ): void {
    if (!this.currentTurn) return;
    this.currentTurn.llmResponse = {
      content,
      toolCalls,
      finishReason,
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cost: usage.cost,
          }
        : null,
      durationMs,
      ...(actualProviderId ? { actualProviderId } : {}),
      ...(actualModel ? { actualModel } : {}),
    };
  }

  /** Record a single tool execution */
  recordToolExecution(
    toolCallId: string,
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    success: boolean,
    durationMs: number,
    riskLevel: RiskLevel,
    error?: string,
  ): void {
    this.turnToolExecutions.push({
      toolCallId,
      toolName,
      args,
      result,
      success,
      durationMs,
      riskLevel,
      ...(error ? { error } : {}),
    });
  }

  /** Record a notable event (escalation, hint, done_rejected, etc.) */
  recordEvent<T extends keyof TraceEventPayloadByType>(
    type: T,
    data: TraceEventPayloadByType[T],
  ): void;
  recordEvent<T extends string>(
    type: T extends keyof TraceEventPayloadByType ? never : T,
    data: Record<string, unknown>,
  ): void;
  recordEvent(type: string, data: Record<string, unknown>): void {
    this.updateSkillToolMetrics(type, data);
    this.turnEvents.push({
      type,
      timestamp: Date.now(),
      data,
    } as TraceEvent);
  }

  private updateSkillToolMetrics(
    type: string,
    data: Record<string, unknown>,
  ): void {
    if (
      type !== "skill_tool_ranking_applied" &&
      type !== "skill_tool_selected"
    ) {
      return;
    }
    const skillId = typeof data.skillId === "string" ? data.skillId : null;
    if (!skillId) return;

    if (
      !this.skillToolMetricsState ||
      this.skillToolMetricsState.skillId !== skillId
    ) {
      this.skillToolMetricsState = {
        skillId,
        rankingApplications: 0,
        totalSelections: 0,
        preferredSelections: 0,
        neutralSelections: 0,
        discouragedSelections: 0,
      };
    }

    if (type === "skill_tool_ranking_applied") {
      this.skillToolMetricsState.rankingApplications += 1;
      return;
    }

    const preference =
      typeof data.preference === "string" ? data.preference : null;
    this.skillToolMetricsState.totalSelections += 1;
    if (preference === "preferred") {
      this.skillToolMetricsState.preferredSelections += 1;
    } else if (preference === "discouraged") {
      this.skillToolMetricsState.discouragedSelections += 1;
    } else {
      this.skillToolMetricsState.neutralSelections += 1;
    }
  }

  private buildSkillToolMetrics(): TraceSkillToolMetrics | undefined {
    if (!this.skillToolMetricsState) return undefined;
    const totalSelections = this.skillToolMetricsState.totalSelections;
    return {
      skillId: this.skillToolMetricsState.skillId,
      rankingApplications: this.skillToolMetricsState.rankingApplications,
      totalSelections,
      preferredSelections: this.skillToolMetricsState.preferredSelections,
      neutralSelections: this.skillToolMetricsState.neutralSelections,
      discouragedSelections: this.skillToolMetricsState.discouragedSelections,
      preferredSelectionRate:
        totalSelections > 0
          ? this.skillToolMetricsState.preferredSelections / totalSelections
          : 0,
      discouragedSelectionRate:
        totalSelections > 0
          ? this.skillToolMetricsState.discouragedSelections / totalSelections
          : 0,
    };
  }

  /** Record perception data (vision model interpretation) for the current turn */
  async recordPerception(
    perception: {
      interpretation: string;
      model: string;
      providerId?: string;
      durationMs: number;
      cached: boolean;
      mode?: TracePerceptionMode;
      source?: TracePerceptionSource;
      freshnessReason?: TracePerceptionFreshnessReason;
      fallbackReason?: TracePerceptionFallbackReason;
      screenshotStatus?: TracePerceptionScreenshotStatus;
    },
    screenshotDataUrl?: string,
    elementSummary?: string,
    panoramicShots?: TracePanoramicShot[],
  ): Promise<void> {
    if (!this.currentTurn) return;
    const sessionId = this.currentTurn.sessionId;
    const turnNumber = this.currentTurn.turnNumber;
    const enrichedPanoramicShots =
      sessionId && typeof turnNumber === "number" && panoramicShots?.length
        ? panoramicShots.map((shot, index) => ({
            screenshotId: `${sessionId}:turn:${turnNumber}:panorama:${index}`,
            sessionId,
            turnNumber,
            ...shot,
          }))
        : panoramicShots;
    this.currentTurn.perception = {
      interpretation: perception.interpretation,
      model: perception.model,
      providerId: perception.providerId,
      durationMs: perception.durationMs,
      cached: perception.cached,
      ...(perception.mode ? { mode: perception.mode } : {}),
      ...(perception.source ? { source: perception.source } : {}),
      ...(perception.freshnessReason
        ? { freshnessReason: perception.freshnessReason }
        : {}),
      ...(perception.fallbackReason
        ? { fallbackReason: perception.fallbackReason }
        : {}),
      ...(perception.screenshotStatus
        ? { screenshotStatus: perception.screenshotStatus }
        : {}),
      ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
      ...(elementSummary ? { elementSummary } : {}),
      ...(enrichedPanoramicShots?.length
        ? { panoramicShots: enrichedPanoramicShots }
        : {}),
    };
  }

  /** Record DOM state after tool execution (what perception was based on) */
  recordPostToolSnapshot(snapshot: {
    url: string;
    title: string;
    elementCount: number;
    scrollY: number;
  }): void {
    if (!this.currentTurn) return;
    this.currentTurn.postToolSnapshot = snapshot;
  }

  /** Record progress tracker state */
  recordProgress(stagnantTurns: number, signal: string | null): void {
    if (!this.currentTurn) return;
    this.currentTurn.progressState = { stagnantTurns, signal };
  }

  /** Finalize and flush the current turn to the trace server */
  async endTurn(): Promise<void> {
    if (!this.currentTurn) return;

    const sessionId = this.currentTurn.sessionId!;
    const turnNumber = this.currentTurn.turnNumber!;
    const turnId = `${sessionId}:turn:${turnNumber}`;
    const toolExecutions = this.turnToolExecutions.map((tool, index) => ({
      executionId: `${turnId}:tool:${tool.toolCallId || index}`,
      turnId,
      sessionId,
      turnNumber,
      ...tool,
    }));
    const events = this.turnEvents.map((event, index) => ({
      eventId: `${turnId}:event:${index}`,
      turnId,
      sessionId,
      turnNumber,
      ...event,
    }));
    const entry: TraceEntry = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceKind: "agent.turn",
      recordedAt: new Date().toISOString(),
      producer: TRACE_PRODUCER,
      ...(this.runId ? { runId: this.runId } : {}),
      correlationId: this.correlationId,
      ...(this.parentRunId ? { parentRunId: this.parentRunId } : {}),
      turnId,
      sessionId,
      turnNumber,
      timestamp: this.currentTurn.timestamp!,
      workspaceId: this.workspaceId,
      snapshot: this.currentTurn.snapshot!,
      ...(this.currentTurn.postToolSnapshot
        ? { postToolSnapshot: this.currentTurn.postToolSnapshot }
        : {}),
      elements: this.currentTurn.elements!,
      llmRequest: this.currentTurn.llmRequest!,
      llmResponse: this.currentTurn.llmResponse ?? {
        content: null,
        toolCalls: [],
        finishReason: "unknown",
        usage: null,
        durationMs: 0,
      },
      toolExecutions,
      events,
      progressState: this.currentTurn.progressState ?? {
        stagnantTurns: 0,
        signal: null,
      },
      ...(this.currentTurn.perception
        ? { perception: this.currentTurn.perception }
        : {}),
    };

    this.currentTurn = null;
    await this.flush("/traces", entry);
  }

  /** Set difficulty assessment and resolved runtime limits for session trace */
  setDifficultyInfo(info: {
    difficulty: string;
    resolvedLimits: Record<string, number>;
    plannerOverrides: Record<string, number> | null;
  }): void {
    this.difficultyInfo = info;
  }
  private difficultyInfo: {
    difficulty: string;
    resolvedLimits: Record<string, number>;
    plannerOverrides: Record<string, number> | null;
  } | null = null;

  /** Store the full plan decomposition for session trace */
  setPlanDecomposition(decomposition: TraceSession["planDecomposition"]): void {
    this.planDecomposition = decomposition;
  }
  private planDecomposition: TraceSession["planDecomposition"] = undefined;

  /** Finalize the session and flush session metadata */
  async finalize(
    outcome: TraceSession["outcome"],
    summary: string,
    turnCount: number,
    failure: TraceFailureInfo | null,
    metrics: SessionMetrics | null,
  ): Promise<void> {
    // Flush any pending turn
    if (this.currentTurn) {
      await this.endTurn();
    }

    const models =
      metrics && metrics.modelBreakdown
        ? Object.keys(metrics.modelBreakdown)
        : undefined;
    const skillToolMetrics = this.buildSkillToolMetrics();

    const session: TraceSession = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceKind: "agent.session",
      recordedAt: new Date().toISOString(),
      producer: TRACE_PRODUCER,
      ...(this.runId ? { runId: this.runId } : {}),
      correlationId: this.correlationId,
      ...(this.parentRunId ? { parentRunId: this.parentRunId } : {}),
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: Date.now(),
      query: this.query,
      startUrl: this.startUrl,
      outcome,
      failureCategory:
        failure?.category ?? (outcome === "completed" ? "none" : "unknown"),
      failureCode:
        failure?.code ?? (outcome === "completed" ? "none" : "unknown_failure"),
      ...(failure?.detail ? { failureDetail: failure.detail } : {}),
      turnCount,
      summary,
      metrics,
      workspaceId: this.workspaceId,
      ...(models && models.length > 0 ? { models } : {}),
      ...(this.difficultyInfo
        ? {
            difficultyAssessment: this.difficultyInfo.difficulty,
            resolvedLimits: this.difficultyInfo.resolvedLimits,
            plannerLimitOverrides: this.difficultyInfo.plannerOverrides,
          }
        : {}),
      ...(this.planDecomposition
        ? { planDecomposition: this.planDecomposition }
        : {}),
      ...(skillToolMetrics ? { skillToolMetrics } : {}),
    };

    await this.flush("/traces/session", session);
  }

  /** Drain pending queue items (best-effort, stop on first failure) */
  private async drainPending(): Promise<void> {
    while (this.pendingQueue.length > 0) {
      const item = this.pendingQueue[0];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
        const response = await fetch(`${TRACE_SERVER_URL}${item.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: item.data,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.pendingQueue.shift(); // Success — remove from queue
      } catch {
        break; // Server still down — stop draining, items stay queued
      }
    }
  }

  /** POST to trace server with retry queue for resilience */
  private async flush(path: string, data: unknown): Promise<void> {
    // Drain any previously queued items first
    await this.drainPending();

    const serialized = JSON.stringify(
      redactTracePayload(data, { mode: "runtime" }),
    );
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
      const response = await fetch(`${TRACE_SERVER_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch {
      // Queue for retry on next flush
      this.pendingQueue.push({ path, data: serialized });
      if (this.pendingQueue.length > MAX_PENDING) {
        this.pendingQueue.shift(); // Drop oldest
      }
      logger.debug(
        "trace",
        "Trace flush queued for retry (server not running?)",
        {
          path,
          pending: this.pendingQueue.length,
        },
      );
    }
  }
}
