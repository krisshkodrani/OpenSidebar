/**
 * RecordingSession — bridges header-button recordings (GoldenAction[])
 * through TraceRecorder so they are persisted, viewable in trace viewer,
 * and convertible to eval cases.
 *
 * Each GoldenAction is written as a trace turn via TraceRecorder.
 */

import type {
  GoldenAction,
  ToolName,
  RiskLevel,
  SessionMetrics,
} from "../types";
import { TraceRecorder } from "./agent/trace";
import { actionToToolCall } from "./golden/builder";
import { logger } from "../utils";

export class RecordingSession {
  readonly sessionId: string;
  private recorder: TraceRecorder;
  private turnCount = 0;
  private startTime: number;
  private name: string;

  constructor(name: string, startUrl: string, workspaceId?: string) {
    this.sessionId = crypto.randomUUID();
    this.startTime = Date.now();
    this.name = name;
    this.recorder = new TraceRecorder(this.sessionId);
    this.recorder.setSessionInfo(name, startUrl);
    if (workspaceId) this.recorder.setWorkspaceId(workspaceId);
  }

  /** Record a single GoldenAction as a trace turn */
  async recordAction(goldenAction: GoldenAction): Promise<void> {
    const { action, tagId, snapshot } = goldenAction;

    // Annotations → record as event, not a full turn
    if (action.type === "annotate") {
      // Attach to current turn if one is open, otherwise create a stub turn
      this.turnCount++;
      this.recorder.startTurn(
        this.turnCount,
        {
          url: action.url,
          title: snapshot.title,
          elementCount: snapshot.elements.length,
          visibleContentLength: 0,
          scrollY: snapshot.scroll.y,
        },
        [],
        0,
        0,
        "recording",
        "NONE",
      );
      this.recorder.recordEvent("annotation", { text: action.value ?? "" });
      this.recorder.recordLLMResponse(
        action.value ?? null,
        [],
        "annotation",
        null,
        0,
      );
      await this.recorder.endTurn();
      return;
    }

    const toolCall = actionToToolCall(action, tagId);
    if (!toolCall) {
      logger.debug("recording", "Skipping unmappable action", {
        type: action.type,
      });
      return;
    }

    this.turnCount++;
    const toolCallId = `rec-tc-${this.turnCount}`;

    // Start turn with snapshot context
    this.recorder.startTurn(
      this.turnCount,
      {
        url: snapshot.url,
        title: snapshot.title,
        elementCount: snapshot.elements.length,
        visibleContentLength: 0,
        scrollY: snapshot.scroll.y,
      },
      snapshot.elements,
      0,
      0,
      "recording",
      "NONE",
    );

    // Record the "LLM response" (the tool call the user performed)
    this.recorder.recordLLMResponse(
      null,
      [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: toolCall.toolName,
            arguments: JSON.stringify(toolCall.args),
          },
        },
      ],
      "stop",
      null,
      0,
    );

    // Record tool execution (user actions always succeed)
    this.recorder.recordToolExecution(
      toolCallId,
      toolCall.toolName as ToolName,
      toolCall.args,
      "OK",
      true,
      0,
      "low" as RiskLevel,
    );

    await this.recorder.endTurn();
  }

  /** Finalize the session and flush metadata */
  async finalize(
    name?: string,
    goal?: string,
  ): Promise<{ sessionId: string; turnCount: number; durationMs: number }> {
    const finalName = name || this.name;
    const durationMs = Date.now() - this.startTime;
    const summary = goal
      ? `Recording: ${finalName} — ${goal}`
      : `Recording: ${finalName}`;

    const metrics: SessionMetrics = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalLlmTimeMs: 0,
      totalSessionTimeMs: durationMs,
      llmCallCount: 0,
      totalCachedTokens: 0,
      modelBreakdown: {
        recording: { promptTokens: 0, completionTokens: 0, cost: 0, calls: this.turnCount },
      },
    };

    await this.recorder.finalize(
      "completed",
      summary,
      this.turnCount,
      null,
      metrics,
    );

    return {
      sessionId: this.sessionId,
      turnCount: this.turnCount,
      durationMs,
    };
  }
}
