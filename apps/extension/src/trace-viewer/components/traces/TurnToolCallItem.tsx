import React from "react";
import Badge from "../Badge";
import { formatDuration } from "../../utils";

interface TurnToolCallItemProps {
  toolName: string;
  success: boolean | null;
  result: string | null;
  error: string | null;
  durationMs: number | null;
}

export default function TurnToolCallItem({
  toolName,
  success,
  result,
  error,
  durationMs,
}: TurnToolCallItemProps) {
  return (
    <div className="bg-trace-accent/[0.04] border border-trace-accent/[0.12] rounded p-2 mb-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {success != null && (
          <span className="flex items-center gap-1 shrink-0">
            <span
              className={`w-2 h-2 rounded-full ${
                success
                  ? "bg-state-success shadow-[0_0_4px_rgba(21,128,61,0.35)]"
                  : "bg-state-error shadow-[0_0_4px_rgba(220,38,38,0.35)]"
              }`}
              aria-hidden="true"
            />
            <span
              className={`text-[9px] font-bold ${success ? "text-state-success" : "text-state-error"}`}
            >
              {success ? "OK" : "ERR"}
            </span>
          </span>
        )}
        <Badge variant="tool">{toolName}</Badge>
        {durationMs != null && (
          <span className="text-[10px] text-trace-muted font-mono ml-auto">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>
      {result && (
        <div className="text-[11px] text-trace-muted mt-1.5 leading-snug whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto scrollbar-thin">
          {result}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-state-error mt-1 font-mono">
          Error: {error}
        </div>
      )}
    </div>
  );
}
