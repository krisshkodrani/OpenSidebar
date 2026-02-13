import {
  TaggedElement,
  ToolCall,
  ToolName,
  RiskLevel,
  SessionMetrics,
  TraceEntry,
  TraceToolExecution,
  TraceEvent,
  TraceSession,
} from "../../types";
import { TokenUsage } from "../llm/types";
import { logger } from "../../utils";

const TRACE_SERVER_URL = "http://127.0.0.1:7589";
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Records full-fidelity execution data for a single agent session.
 * Each turn is flushed as JSONL to the trace server (fire-and-forget).
 */
export class TraceRecorder {
  readonly sessionId: string;
  private startTime: number;
  private query = "";
  private startUrl = "";

  // Current turn being recorded
  private currentTurn: Partial<TraceEntry> | null = null;
  private turnToolExecutions: TraceToolExecution[] = [];
  private turnEvents: TraceEvent[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startTime = Date.now();
  }

  /** Set session-level metadata (called once at start) */
  setSessionInfo(query: string, startUrl: string): void {
    this.query = query;
    this.startUrl = startUrl;
  }

  /** Begin recording a new turn */
  startTurn(
    turnNumber: number,
    snapshot: {
      url: string;
      title: string;
      elementCount: number;
      viewportTextLength: number;
      scrollY: number;
    },
    elements: TaggedElement[],
    messageCount: number,
    toolCount: number,
    model: string,
    compressionLevel: string,
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
        messageCount,
        toolCount,
        compressionLevel,
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
  recordEvent(
    type: TraceEvent["type"],
    data: Record<string, unknown>,
  ): void {
    this.turnEvents.push({ type, timestamp: Date.now(), data });
  }

  /** Record progress tracker state */
  recordProgress(staleTurns: number, signal: string | null): void {
    if (!this.currentTurn) return;
    this.currentTurn.progressState = { staleTurns, signal };
  }

  /** Finalize and flush the current turn to the trace server */
  async endTurn(): Promise<void> {
    if (!this.currentTurn) return;

    const entry: TraceEntry = {
      sessionId: this.currentTurn.sessionId!,
      turnNumber: this.currentTurn.turnNumber!,
      timestamp: this.currentTurn.timestamp!,
      snapshot: this.currentTurn.snapshot!,
      elements: this.currentTurn.elements!,
      llmRequest: this.currentTurn.llmRequest!,
      llmResponse: this.currentTurn.llmResponse ?? {
        content: null,
        toolCalls: [],
        finishReason: "unknown",
        usage: null,
        durationMs: 0,
      },
      toolExecutions: this.turnToolExecutions,
      events: this.turnEvents,
      progressState: this.currentTurn.progressState ?? {
        staleTurns: 0,
        signal: null,
      },
    };

    this.currentTurn = null;
    await this.flush("/traces", entry);
  }

  /** Finalize the session and flush session metadata */
  async finalize(
    outcome: TraceSession["outcome"],
    summary: string,
    turnCount: number,
    metrics: SessionMetrics | null,
  ): Promise<void> {
    // Flush any pending turn
    if (this.currentTurn) {
      await this.endTurn();
    }

    const session: TraceSession = {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: Date.now(),
      query: this.query,
      startUrl: this.startUrl,
      outcome,
      turnCount,
      summary,
      metrics,
    };

    await this.flush("/traces/session", session);
  }

  /** Fire-and-forget POST to trace server */
  private async flush(path: string, data: unknown): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        FLUSH_TIMEOUT_MS,
      );
      await fetch(`${TRACE_SERVER_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch {
      // Fire-and-forget: silently ignore when trace server is not running
      logger.debug("trace", "Trace flush failed (server not running?)", {
        path,
      });
    }
  }
}
