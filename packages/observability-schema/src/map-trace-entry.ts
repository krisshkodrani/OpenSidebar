/**
 * Deterministic projection of a recorded agent turn (`TraceEntry`) into the
 * canonical OTel-GenAI span tree (RFC LP-7, Stage B0). Pure: same input always
 * yields the same spans/ids, so the Stage B1 backfill is idempotent. The
 * run/session spans come from the run-event mapper (server-side, Stage B1); here
 * we emit the turn and its children and reference the deterministic parent ids.
 */

import type { TraceEntry } from "@shared-types";

import { spanId } from "./hash";
import {
  GenAiAttr,
  type ObsBlobRef,
  type ObsSpan,
  type ObsSpanStatus,
} from "./spans";

export function traceEntryToSpans(entry: TraceEntry): ObsSpan[] {
  const traceId = entry.correlationId ?? entry.runId ?? entry.sessionId;
  const sessionSpanId = spanId(entry.sessionId);
  const turnSpanId =
    entry.turnId ?? spanId(entry.sessionId, "turn", entry.turnNumber);
  const start = entry.timestamp;
  const spans: ObsSpan[] = [];

  // agent.turn — parent of this turn's child spans.
  spans.push({
    traceId,
    spanId: turnSpanId,
    parentSpanId: sessionSpanId,
    name: "agent.turn",
    kind: "agent.turn",
    startTimeUnixMs: start,
    attributes: {
      "os.session_id": entry.sessionId,
      "os.turn_number": entry.turnNumber,
      "os.url": entry.snapshot.url,
      "os.title": entry.snapshot.title,
      "os.element_count": entry.snapshot.elementCount,
      "os.model_tier": entry.llmRequest.modelTier ?? "executor",
      "os.stagnant_turns": entry.progressState.stagnantTurns,
    },
    events: entry.events.map((event, index) => ({
      name: (event as unknown as { type?: string }).type ?? `event_${index}`,
      timeUnixMs: start,
    })),
    blobs: [
      {
        ref: `dom:${spanId(entry.sessionId, entry.turnNumber, "dom")}`,
        kind: "dom_snapshot",
      },
    ],
  });

  // gen_ai.chat — the LLM call for this turn.
  const usage = entry.llmResponse.usage;
  const chatAttrs: ObsSpan["attributes"] = {
    [GenAiAttr.operationName]: "chat",
    [GenAiAttr.system]: entry.llmResponse.actualProviderId ?? "unknown",
    [GenAiAttr.requestModel]: entry.llmRequest.model,
    [GenAiAttr.responseFinishReasons]: entry.llmResponse.finishReason,
  };
  if (entry.llmResponse.actualModel) {
    chatAttrs[GenAiAttr.responseModel] = entry.llmResponse.actualModel;
  }
  if (usage) {
    chatAttrs[GenAiAttr.usageInputTokens] = usage.prompt_tokens;
    chatAttrs[GenAiAttr.usageOutputTokens] = usage.completion_tokens;
    chatAttrs[GenAiAttr.usageTotalTokens] = usage.total_tokens;
    if (typeof usage.cost === "number") chatAttrs["os.cost_usd"] = usage.cost;
  }
  spans.push({
    traceId,
    spanId: spanId(turnSpanId, "chat"),
    parentSpanId: turnSpanId,
    name: `gen_ai.chat ${entry.llmRequest.model}`,
    kind: "gen_ai.chat",
    startTimeUnixMs: start,
    endTimeUnixMs: start + entry.llmResponse.durationMs,
    attributes: chatAttrs,
  });

  // execute_tool — one span per tool execution.
  entry.toolExecutions.forEach((tool, index) => {
    const status: ObsSpanStatus = tool.success
      ? { code: "ok" }
      : { code: "error", message: tool.error ?? "tool failed" };
    spans.push({
      traceId,
      spanId: tool.executionId ?? spanId(turnSpanId, "tool", tool.toolCallId || index),
      parentSpanId: turnSpanId,
      name: `execute_tool ${tool.toolName}`,
      kind: "execute_tool",
      startTimeUnixMs: start,
      endTimeUnixMs: start + tool.durationMs,
      attributes: {
        "os.tool.name": tool.toolName,
        "os.tool.success": tool.success,
        "os.tool.risk": tool.riskLevel,
      },
      status,
    });
  });

  // gen_ai.perception — optional vision interpretation.
  const perception = entry.perception;
  if (perception) {
    const blobs: ObsBlobRef[] = [];
    if (perception.screenshotPath || perception.screenshotDataUrl) {
      blobs.push({
        ref: `shot:${spanId(entry.sessionId, entry.turnNumber, "shot")}`,
        kind: "screenshot",
      });
    }
    const attrs: ObsSpan["attributes"] = {
      [GenAiAttr.operationName]: "perception",
      [GenAiAttr.requestModel]: perception.model,
      "os.perception.cached": perception.cached,
    };
    if (perception.mode) attrs["os.perception.mode"] = perception.mode;
    spans.push({
      traceId,
      spanId: spanId(turnSpanId, "perception"),
      parentSpanId: turnSpanId,
      name: "gen_ai.perception",
      kind: "gen_ai.perception",
      startTimeUnixMs: start,
      endTimeUnixMs: start + perception.durationMs,
      attributes: attrs,
      blobs: blobs.length > 0 ? blobs : undefined,
    });
  }

  return spans;
}
