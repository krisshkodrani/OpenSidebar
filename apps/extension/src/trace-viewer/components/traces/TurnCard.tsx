import React from "react";
import type { TraceEntry } from "../../../types/traces";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
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

      {/* Body */}
      <div className="p-3">
        <TurnEventsSection events={events} />
        <TurnLLMInputSection
          messages={messages}
          contextMetrics={contextMetrics}
          turnNumber={turnNum}
        />
        <TurnLLMOutputSection content={content} toolCalls={toolCalls} />
        <TurnToolResultsSection toolExecutions={toolExecutions} />
        <TurnSnapshotSection
          snapshot={snapshot}
          perception={entry.perception}
          sessionId={sessionId}
          turnNumber={turnNum}
        />
        {progressState && <TurnProgressState progressState={progressState} />}
      </div>
    </div>
  );
}
