import React from "react";
import Badge from "../Badge";
import TurnEventsSection from "./TurnEventsSection";
import TurnLLMInputSection from "./TurnLLMInputSection";
import TurnLLMOutputSection from "./TurnLLMOutputSection";
import TurnToolResultsSection from "./TurnToolResultsSection";
import TurnSnapshotSection from "./TurnSnapshotSection";
import TurnProgressState from "./TurnProgressState";
import { shortModel, formatDuration, formatTokens, formatCost } from "../../utils";

interface TurnCardProps {
  entry: Record<string, unknown>;
  index: number;
}

export default function TurnCard({ entry, index }: TurnCardProps) {
  const turnNum =
    (entry.turnNumber as number) ?? (entry.turn as number) ?? index + 1;
  const model =
    (entry.llmRequest as Record<string, unknown>)?.model as string ??
    (entry.model as string) ??
    "";
  const llmResponse = entry.llmResponse as Record<string, unknown> | undefined;
  const duration =
    (llmResponse?.durationMs as number) ?? (entry.durationMs as number) ?? null;
  const usage =
    (llmResponse?.usage as Record<string, unknown>) ??
    (entry.usage as Record<string, unknown>) ??
    null;
  const content =
    (llmResponse?.content as string) ??
    ((entry.response as Record<string, unknown>)?.content as string) ??
    null;
  const toolCalls =
    (llmResponse?.toolCalls as Array<Record<string, unknown>>) ??
    ((entry.response as Record<string, unknown>)?.tool_calls as Array<Record<string, unknown>>) ??
    [];
  const toolExecutions =
    (entry.toolExecutions as Array<Record<string, unknown>>) ?? [];
  const events = (entry.events as Array<Record<string, unknown>>) ?? [];
  const snapshot = (entry.snapshot as Record<string, unknown>) ?? null;
  const progressState = entry.progressState as Record<string, unknown> | null;
  const llmRequest = entry.llmRequest as Record<string, unknown> | undefined;
  const messages =
    (llmRequest?.messages as Record<string, unknown>[]) ?? [];
  const contextMetrics = llmRequest?.contextMetrics as Record<string, unknown> | undefined;
  const compressionLevel = llmRequest?.compressionLevel as string | undefined;

  return (
    <div className="bg-trace-panel border border-[rgba(15,52,96,0.6)] rounded-lg mb-3 overflow-hidden transition-colors hover:border-trace-border">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[rgba(15,52,96,0.3)] border-b border-[rgba(15,52,96,0.4)] flex-wrap">
        <span className="text-[13px] font-bold text-trace-accent-light shrink-0">
          Turn {turnNum}
        </span>
        {model && <Badge variant="model">{shortModel(model)}</Badge>}
        {compressionLevel && compressionLevel !== "NONE" && (
          <span className="text-[10px] text-trace-muted">
            compress: {compressionLevel}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto text-[11px] text-trace-muted shrink-0">
          {duration != null && <span>{formatDuration(duration)}</span>}
          {usage?.total_tokens && (
            <span className="font-mono">
              {formatTokens(usage.total_tokens as number)} tok
            </span>
          )}
          {usage?.cost && (
            <span className="font-mono">{formatCost(usage.cost as number)}</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-3">
        <TurnEventsSection events={events as Array<{ type: string; data?: Record<string, unknown> }>} />
        <TurnLLMInputSection messages={messages} contextMetrics={contextMetrics as TurnLLMInputSectionCM} />
        <TurnLLMOutputSection
          content={content}
          toolCalls={toolCalls as Array<{ function?: { name?: string; arguments?: string } }>}
        />
        <TurnToolResultsSection
          toolExecutions={toolExecutions as Array<{ toolName?: string; success?: boolean; result?: string; error?: string; durationMs?: number }>}
        />
        <TurnSnapshotSection
          snapshot={snapshot as { url?: string; title?: string; scrollY?: number } | null}
        />
        {progressState && <TurnProgressState progressState={progressState as { staleTurns?: number; signal?: string }} />}
      </div>
    </div>
  );
}

type TurnLLMInputSectionCM = {
  systemTokens?: number;
  historyTokens?: number;
  totalTokens?: number;
  maxTokens?: number;
  utilization?: number;
  droppedMessageCount?: number;
  compressionLevel?: string;
  cachedPrefixLength?: number;
};
