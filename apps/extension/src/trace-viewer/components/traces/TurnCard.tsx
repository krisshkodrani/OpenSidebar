import React from "react";
import type { TraceEntry } from "../../../types/traces";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import CollapsibleSection from "../CollapsibleSection";
import TurnEventsSection from "./TurnEventsSection";
import TurnLLMInputSection from "./TurnLLMInputSection";
import TurnLLMOutputSection from "./TurnLLMOutputSection";
import TurnToolResultsSection from "./TurnToolResultsSection";
import TurnSnapshotSection from "./TurnSnapshotSection";
import TurnProgressState from "./TurnProgressState";
import {
  shortModel,
  formatDuration,
  formatTokens,
  formatCost,
} from "../../utils";

interface TurnCardProps {
  entry: TraceEntry;
  index: number;
  sessionId: string;
}

export default function TurnCard({ entry, index, sessionId }: TurnCardProps) {
  const turnNum = entry.turnNumber ?? index + 1;
  const model = entry.llmRequest?.model ?? "";
  const llmResponse = entry.llmResponse;
  const duration = llmResponse?.durationMs ?? null;
  const usage = llmResponse?.usage ?? null;
  const content = llmResponse?.content ?? null;
  const toolCalls = llmResponse?.toolCalls ?? [];
  const toolExecutions = entry.toolExecutions ?? [];
  const events = entry.events ?? [];
  const snapshot = entry.snapshot ?? null;
  const progressState = entry.progressState;
  const llmRequest = entry.llmRequest;
  const messages = llmRequest?.messages ?? [];
  const contextMetrics = llmRequest?.contextMetrics;
  const compressionLevel = llmRequest?.compressionLevel;
  const modelTier = llmRequest?.modelTier;
  const actualProviderId = llmResponse?.actualProviderId;

  // Generate decision summary from tool calls
  const decisionSummary = generateDecisionSummary(toolCalls, toolExecutions);

  return (
    <div className="bg-trace-panel border border-trace-accent/[0.15] rounded-lg mb-3 overflow-hidden transition-colors hover:border-trace-border">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-trace-accent/[0.08] border-b border-trace-accent/[0.12] flex-wrap">
        <span className="text-[13px] font-bold text-trace-accent-light shrink-0">
          Turn {turnNum}
        </span>
        {model && (
          <Badge
            variant={
              model === "manual"
                ? "manual"
                : model === "recording"
                  ? "recording"
                  : "model"
            }
          >
            {shortModel(model)}
            {modelTier &&
            !model.startsWith("manual") &&
            !model.startsWith("recording")
              ? ` (${modelTier})`
              : ""}
          </Badge>
        )}
        {actualProviderId &&
          model &&
          !model.startsWith("manual") &&
          !model.startsWith("recording") && (
            <span className="text-[9px] text-state-warning">
              via {actualProviderId}
            </span>
          )}
        {compressionLevel && compressionLevel !== "NONE" && (
          <Tooltip content="Context compression level applied to reduce token usage">
            <span className="text-[10px] text-trace-muted cursor-help">
              compress: {compressionLevel}
            </span>
          </Tooltip>
        )}
        <div className="flex items-center gap-2 ml-auto text-[11px] text-trace-muted shrink-0">
          {duration != null && (
            <Tooltip content="LLM response time">
              <span className="cursor-help">{formatDuration(duration)}</span>
            </Tooltip>
          )}
          {usage?.total_tokens && (
            <Tooltip content="Total tokens used (prompt + completion)">
              <span className="font-mono cursor-help">
                {formatTokens(usage.total_tokens)} tok
              </span>
            </Tooltip>
          )}
          {usage?.cost && (
            <Tooltip content="Estimated API cost">
              <span className="font-mono cursor-help">
                {formatCost(usage.cost)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Decision Summary */}
      {decisionSummary && (
        <div className="px-3.5 py-2 bg-trace-accent/[0.04] border-b border-trace-accent/[0.08]">
          <div className="text-[12px] text-trace-text">
            <span className="text-trace-accent font-medium">💭</span>{" "}
            {decisionSummary}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="p-3">
        <TurnEventsSection events={events} />

        <CollapsibleSection
          label={
            <span className="text-[11px]">
              🧠 Context{" "}
              {contextMetrics && (
                <span className="text-trace-muted">
                  ({Math.round((contextMetrics.utilization || 0) * 100)}%)
                </span>
              )}
            </span>
          }
          className="mb-2.5"
        >
          <TurnLLMInputSection
            messages={messages}
            contextMetrics={contextMetrics}
            turnNumber={turnNum}
          />
        </CollapsibleSection>

        <CollapsibleSection
          label={
            <span className="text-[11px]">
              💭 Thinking & Output
              {toolCalls.length > 0 && (
                <span className="text-trace-muted">
                  {" "}
                  ({toolCalls.length} tool call{toolCalls.length > 1 ? "s" : ""}
                  )
                </span>
              )}
            </span>
          }
          className="mb-2.5"
        >
          <TurnLLMOutputSection content={content} toolCalls={toolCalls} />
        </CollapsibleSection>

        <CollapsibleSection
          label={
            <span className="text-[11px]">
              🔧 Results
              {toolExecutions.length > 0 && (
                <span className="text-trace-muted">
                  {" "}
                  ({toolExecutions.length})
                </span>
              )}
            </span>
          }
          className="mb-2.5"
        >
          <TurnToolResultsSection toolExecutions={toolExecutions} />
        </CollapsibleSection>

        <CollapsibleSection
          label={<span className="text-[11px]">👁 Perception & Snapshot</span>}
          className="mb-2.5"
        >
          <TurnSnapshotSection
            snapshot={snapshot}
            perception={entry.perception}
            sessionId={sessionId}
            turnNumber={turnNum}
          />
        </CollapsibleSection>

        {progressState && <TurnProgressState progressState={progressState} />}
      </div>
    </div>
  );
}

function generateDecisionSummary(
  toolCalls: TraceEntry["llmResponse"]["toolCalls"],
  toolExecutions: TraceEntry["toolExecutions"],
): string | null {
  if (toolCalls.length === 0) return null;

  const calls = toolCalls.slice(0, 2); // Show first 2 calls
  const summaries = calls.map((tc) => {
    const name = tc.function?.name || "unknown";
    const exec = toolExecutions.find((te) => te.toolCallId === tc.id);
    const success = exec?.success;

    let action = "";
    switch (name) {
      case "click_element":
        action = "clicked";
        break;
      case "type_text":
        action = "typed";
        break;
      case "read_page":
        action = "read";
        break;
      case "navigate":
        action = "navigated";
        break;
      case "done":
        action = "completed";
        break;
      case "update_notes":
        action = "updated notes";
        break;
      default:
        action = `used ${name}`;
    }

    return `${action}${success === false ? " (failed)" : ""}`;
  });

  if (toolCalls.length > 2) {
    summaries.push(`+${toolCalls.length - 2} more`);
  }

  return `Decided to ${summaries.join(", ")}`;
}
