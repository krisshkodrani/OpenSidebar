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
    <div className="bg-[rgba(26,26,46,0.4)] border border-[rgba(15,52,96,0.3)] rounded-[5px] p-2 mb-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {success != null && (
          <span className="flex items-center gap-1 shrink-0">
            <span
              className={`w-2 h-2 rounded-full ${
                success
                  ? "bg-[#2ecc71] shadow-[0_0_4px_rgba(46,204,113,0.4)]"
                  : "bg-[#e74c3c] shadow-[0_0_4px_rgba(231,76,60,0.4)]"
              }`}
              aria-hidden="true"
            />
            <span className={`text-[9px] font-bold ${success ? "text-[#2ecc71]" : "text-[#e74c3c]"}`}>
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
        <div className="text-[11px] text-[#a0a0c8] mt-1.5 leading-snug whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto scrollbar-thin">
          {result}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-[#e74c3c] mt-1 font-mono">
          Error: {error}
        </div>
      )}
    </div>
  );
}
