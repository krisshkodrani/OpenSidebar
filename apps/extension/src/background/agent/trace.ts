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
  PartialProgressHandoff,
} from "../../types";
import { TokenUsage } from "../llm/types";
import { LLMMessage } from "../llm/types";
import { logger } from "../../utils";
import { redactTracePayload } from "../../utils/trace-protection";
import { attachActualPromptTokens } from "./context-economy";

const TRACE_SERVER_URL = "http://127.0.0.1:7589";
const FLUSH_TIMEOUT_MS = 2000;
const FINAL_FLUSH_TIMEOUT_MS = 5000;
const FINAL_PENDING_DRAIN_ATTEMPTS = 2;
const FINAL_PENDING_DRAIN_DELAY_MS = 250;
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
  private sensitiveTraceLiterals = new Set<string>();

  // Current turn being recorded
  private currentTurn: Partial<TraceEntry> | null = null;
  private turnToolExecutions: TraceToolExecution[] = [];
  private turnEvents: TraceEvent[] = [];
  private sessionEvents: TraceEvent[] = [];

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
    const redactedSnapshot = this.redactSensitiveTraceValue(snapshot);
    const redactedElements = this.redactSensitiveTraceValue(elements);
    this.turnToolExecutions = [];
    this.turnEvents = [];
    this.currentTurn = {
      sessionId: this.sessionId,
      turnNumber,
      timestamp: Date.now(),
      snapshot: redactedSnapshot,
      elements: redactedElements,
      pageState: {
        preDecision: {
          ...redactedSnapshot,
          domSnapshot: redactedElements,
        },
      },
      llmRequest: {
        model,
        ...(modelTier ? { modelTier } : {}),
        messageCount,
        toolCount,
        compressionLevel,
        ...(rawMessages
          ? { messages: this.redactSensitiveTraceValue(rawMessages) }
          : {}),
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
      content: this.redactSensitiveTraceValue(content),
      toolCalls: this.redactSensitiveTraceValue(toolCalls),
      finishReason,
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            cost: usage.cost,
            cached_tokens: usage.cached_tokens,
            cacheTelemetry: usage.cacheTelemetry,
          }
        : null,
      durationMs,
      ...(actualProviderId ? { actualProviderId } : {}),
      ...(actualModel ? { actualModel } : {}),
    };
    const promptSections =
      this.currentTurn.llmRequest?.contextMetrics?.promptSections;
    if (usage && promptSections) {
      this.currentTurn.llmRequest!.contextMetrics!.promptSections =
        attachActualPromptTokens(promptSections, usage.prompt_tokens);
    }
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
    if (toolName === ToolName.GET_PROFILE_FIELDS) {
      this.rememberProfileToolResultLiterals(result);
    }
    this.turnToolExecutions.push({
      toolCallId,
      toolName,
      args: this.redactSensitiveTraceValue(args),
      result: this.redactSensitiveTraceValue(result),
      success,
      durationMs,
      riskLevel,
      ...(error ? { error } : {}),
    });
  }

  private rememberProfileToolResultLiterals(result: string): void {
    for (const line of result.split(/\r?\n/)) {
      const match = /^-\s+[^:]+:\s*(.+)$/.exec(line);
      const rawValue = match?.[1]?.trim();
      if (!rawValue || rawValue === "null") continue;
      this.addSensitiveTraceLiteral(rawValue);
      for (const part of rawValue.split(",")) {
        const trimmedPart = part.trim();
        this.addSensitiveTraceLiteral(trimmedPart);
        for (const token of trimmedPart.split(/\s+/)) {
          this.addSensitiveTraceLiteral(token);
        }
      }
    }
  }

  private addSensitiveTraceLiteral(value: string): void {
    const normalized = value.trim();
    if (normalized.length < 3) return;
    this.sensitiveTraceLiterals.add(normalized);
  }

  private redactSensitiveTraceString(value: string): string {
    let redacted = value;
    for (const literal of this.sensitiveTraceLiterals) {
      redacted = redacted.split(literal).join("[REDACTED_PROFILE_VALUE]");
    }
    return redacted;
  }

  private redactSensitiveTraceValue<T>(value: T): T {
    if (typeof value === "string") {
      return this.redactSensitiveTraceString(value) as T;
    }
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.redactSensitiveTraceValue(item)) as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = this.redactSensitiveTraceValue(entryValue);
    }
    return out as T;
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
    const event = {
      type,
      timestamp: Date.now(),
      data: this.redactSensitiveTraceValue(data),
    } as TraceEvent;
    if (this.currentTurn) {
      this.turnEvents.push(event);
    } else {
      this.sessionEvents.push(event);
    }
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
    const pageStateRef = this.currentTurn.postToolSnapshot
      ? "postTool"
      : "preDecision";
    const enrichedPanoramicShots =
      sessionId && typeof turnNumber === "number" && panoramicShots?.length
        ? panoramicShots.map((shot, index) => ({
            screenshotId: `${sessionId}:turn:${turnNumber}:panorama:${index}`,
            sessionId,
            turnNumber,
            ...shot,
          }))
        : panoramicShots;
    const pageState = this.currentTurn.pageState;
    const capture = pageState?.[pageStateRef];
    const redactedElementSummary = this.redactSensitiveTraceValue(elementSummary);
    if (capture) {
      if (redactedElementSummary) {
        capture.domDistillation = redactedElementSummary;
      }
      const screenshots = [...(capture.screenshots ?? [])];
      if (screenshotDataUrl) {
        screenshots.push({
          screenshotId:
            sessionId && typeof turnNumber === "number"
              ? `${sessionId}:turn:${turnNumber}:${pageStateRef}:viewport`
              : undefined,
          sessionId,
          turnNumber,
          kind: "viewport",
          dataUrl: screenshotDataUrl,
          scrollY: capture.scrollY,
          label: "viewport",
          status: perception.screenshotStatus,
          source: perception.source,
        });
      }
      for (const shot of enrichedPanoramicShots ?? []) {
        screenshots.push({
          screenshotId: shot.screenshotId,
          sessionId: shot.sessionId,
          turnNumber: shot.turnNumber,
          kind: "panorama",
          dataUrl: shot.dataUrl,
          scrollY: shot.scrollY,
          label: shot.label,
          status: perception.screenshotStatus,
          source: perception.source,
        });
      }
      if (screenshots.length > 0) {
        capture.screenshots = screenshots;
      }
    }
    this.currentTurn.perception = {
      interpretation: this.redactSensitiveTraceValue(
        perception.interpretation,
      ),
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
      ...(redactedElementSummary
        ? { elementSummary: redactedElementSummary }
        : {}),
      ...(enrichedPanoramicShots?.length
        ? { panoramicShots: enrichedPanoramicShots }
        : {}),
      pageStateRef,
    };
  }

  /** Record DOM state after tool execution (what perception was based on) */
  recordPostToolSnapshot(snapshot: {
    url: string;
    title: string;
    elementCount: number;
    visibleContentLength?: number;
    pageContentLength?: number;
    scrollY: number;
    elements?: TaggedElement[];
  }): void {
    if (!this.currentTurn) return;
    const { elements, ...snapshotMeta } = snapshot;
    const redactedSnapshotMeta = this.redactSensitiveTraceValue(snapshotMeta);
    const redactedElements = elements
      ? this.redactSensitiveTraceValue(elements)
      : undefined;
    this.currentTurn.postToolSnapshot = redactedSnapshotMeta;
    this.currentTurn.pageState = {
      preDecision:
        this.currentTurn.pageState?.preDecision ?? {
          ...this.currentTurn.snapshot!,
          domSnapshot: this.currentTurn.elements,
        },
      postTool: {
        ...redactedSnapshotMeta,
        ...(redactedElements ? { domSnapshot: redactedElements } : {}),
      },
    };
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
      ...(this.currentTurn.pageState
        ? { pageState: this.currentTurn.pageState }
        : {}),
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
    partialHandoff?: PartialProgressHandoff | null,
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
    const sessionEvents = this.sessionEvents.map((event, index) => ({
      eventId: `${this.sessionId}:session:event:${index}`,
      sessionId: this.sessionId,
      ...event,
    }));

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
      ...(sessionEvents.length > 0 ? { events: sessionEvents } : {}),
      ...(partialHandoff ? { partialHandoff } : {}),
    };

    await this.flush("/traces/session", session);
    await this.drainPending({
      attempts: FINAL_PENDING_DRAIN_ATTEMPTS,
      delayMs: FINAL_PENDING_DRAIN_DELAY_MS,
      timeoutMs: FINAL_FLUSH_TIMEOUT_MS,
    });
  }

  /** Drain pending queue items (best-effort, stop on first failure per attempt) */
  private async drainPending(
    options: {
      attempts?: number;
      delayMs?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<void> {
    if (typeof __DEV__ !== "undefined" && !__DEV__) return;
    const attempts = Math.max(1, options.attempts ?? 1);
    const delayMs = Math.max(0, options.delayMs ?? 0);
    const timeoutMs = Math.max(1, options.timeoutMs ?? FLUSH_TIMEOUT_MS);

    for (
      let attempt = 0;
      attempt < attempts && this.pendingQueue.length > 0;
      attempt += 1
    ) {
      while (this.pendingQueue.length > 0) {
        const item = this.pendingQueue[0];
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
          break; // Server still down or busy — retry only if another attempt remains.
        }
      }

      if (
        this.pendingQueue.length > 0 &&
        attempt < attempts - 1 &&
        delayMs > 0
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /** POST to trace server with retry queue for resilience.
   * Compiled out of production builds — the shipped extension must never
   * call localhost (dev observability only). */
  private async flush(path: string, data: unknown): Promise<void> {
    if (typeof __DEV__ !== "undefined" && !__DEV__) return;
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
