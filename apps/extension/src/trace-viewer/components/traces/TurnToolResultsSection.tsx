import React from "react";
import type { TraceToolExecution } from "../../../types/traces";
import TurnToolCallItem from "./TurnToolCallItem";

export default function TurnToolResultsSection({
  toolExecutions,
}: {
  toolExecutions: TraceToolExecution[];
}) {
  if (toolExecutions.length === 0) return null;
  return (
    <div className="mb-2.5">
      <div className="text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1.5">
        Tool Results ({toolExecutions.length})
      </div>
      {toolExecutions.map((te, i) => (
        <TurnToolCallItem
          key={i}
          toolName={te.toolName || ""}
          success={te.success ?? null}
          result={te.result ?? null}
          error={te.error ?? null}
          durationMs={te.durationMs ?? null}
        />
      ))}
    </div>
  );
}
